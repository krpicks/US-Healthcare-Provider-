import { beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../events';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { buildValidNpi } from '../../../rules';
import { settingsService } from '../../../services';
import { tenantService } from '../../../tenancy';
import {
  ROSTER_CSV_TEMPLATE,
  providerOpsService,
} from '../providerOpsService';

describe('M22 Provider Management Operations', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const actor = { name: 'Taylor Brooks', role: 'EnrollmentAnalyst' as const };

  beforeEach(async () => {
    settingsService.reset();
    tenantService.resetForTests();
    providerOpsService.resetForTests();
    eventBus.clearHistory();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('validates bulk roster CSV/JSON for NPI Luhn, duplicate NPIs, and NUCC taxonomy and commits valid rows', async () => {
    const validNpi = buildValidNpi('188112233');
    const csv = [
      'npi,given,family,taxonomyCode,specialty,organizationName,city,state,phone',
      `${validNpi},Clara,Bennett,207Q00000X,Family Medicine,Capital Valley Medical Group,Albany,NY,518-555-0181`,
      '1234567890,Bad,Npi,207Q00000X,Family Medicine,Capital Valley Medical Group,Albany,NY,518-555-0182',
      `${validNpi},Dup,Row,BADTAX,Family Medicine,Capital Valley Medical Group,Albany,NY,518-555-0183`,
    ].join('\n');

    const validations = providerOpsService.validateRosterRows(csv, 'csv');
    expect(validations).toHaveLength(3);
    expect(validations[0].valid).toBe(true);
    expect(validations[1].valid).toBe(false);
    expect(validations[1].errors[0]).toMatch(/Luhn/i);
    expect(validations[2].valid).toBe(false);
    expect(validations[2].errors.some((e) => /Duplicate NPI/i.test(e))).toBe(true);
    expect(validations[2].errors.some((e) => /Taxonomy/i.test(e))).toBe(true);

    const summary = await providerOpsService.commitRoster(ctx, validations, actor);
    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(2);

    // Template CSV itself validates cleanly
    const tplValidations = providerOpsService.validateRosterRows(ROSTER_CSV_TEMPLATE, 'csv');
    expect(tplValidations.every((v) => v.valid)).toBe(true);
  });

  it('blocks overlapping affiliation dates for the same practitioner and organization', () => {
    expect(() =>
      providerOpsService.addAffiliation(ctx.tenantId, {
        practitionerId: 'prac-a-1',
        practitionerName: 'Dr. Elena Vargas',
        organizationId: 'org-a-capital-health',
        organizationName: 'Capital Valley Medical Group',
        locationName: 'Albany State St Clinic',
        role: 'Attending',
        specialty: 'Family Medicine',
        billingAuthority: true,
        startDate: '2026-06-01',
        endDate: '2027-01-01',
      }),
    ).toThrow(/Overlapping affiliation/i);

    const nonOverlap = providerOpsService.addAffiliation(ctx.tenantId, {
      practitionerId: 'prac-a-1',
      practitionerName: 'Dr. Elena Vargas',
      organizationId: 'org-a-capital-health',
      organizationName: 'Capital Valley Medical Group',
      locationName: 'Albany State St Clinic',
      role: 'Attending',
      specialty: 'Family Medicine',
      billingAuthority: true,
      startDate: '2028-01-01',
      endDate: '2029-12-31',
    });
    expect(nonOverlap.id).toBeTruthy();
  });

  it('routes self-service change requests based on tenant auto-approve rules and ownership checks', async () => {
    const autoReq = await providerOpsService.submitChangeRequest(
      ctx,
      {
        practitionerId: 'prac-a-1',
        practitionerName: 'Dr. Elena Vargas',
        field: 'phone',
        beforeValue: '518-555-0101',
        afterValue: '518-555-9999',
      },
      { name: 'Dr. Elena Vargas', role: 'ProviderUser' },
    );
    expect(autoReq.status).toBe('AutoApplied');

    const bankReq = await providerOpsService.submitChangeRequest(
      ctx,
      {
        practitionerId: 'prac-a-1',
        practitionerName: 'Dr. Elena Vargas',
        field: 'bankingDetails',
        beforeValue: '****4410',
        afterValue: '****9921',
      },
      { name: 'Dr. Elena Vargas', role: 'ProviderUser' },
    );
    expect(bankReq.status).toBe('PendingApproval');

    const ownReq = await providerOpsService.submitChangeRequest(
      ctx,
      {
        practitionerId: 'prac-a-1',
        practitionerName: 'Dr. Elena Vargas',
        field: 'ownershipChange',
        beforeValue: 'Solo LLC',
        afterValue: 'Regional Health Corp',
      },
      { name: 'Dr. Elena Vargas', role: 'ProviderUser' },
    );
    expect(ownReq.status).toBe('RoutedToEnrollment');
  });

  it('transitions provider status, writes Provenance, and emits ProviderStatusChanged with claimsBlocked', async () => {
    const updated = await providerOpsService.changeProviderStatus(
      ctx,
      'prac-a-1',
      'Suspended',
      'Pending license verification follow-up',
      '2026-11-24',
      actor,
    );
    expect(updated.status).toBe('Suspended');

    const events = eventBus.getHistory(ctx.tenantId);
    const statusEvt = events.find((e) => e.type === 'ProviderStatusChanged');
    expect(statusEvt).toBeDefined();
    expect(statusEvt?.payload).toMatchObject({
      practitionerId: 'prac-a-1',
      newStatus: 'Suspended',
      claimsBlocked: true,
    });
  });
});
