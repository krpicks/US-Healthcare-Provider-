import { beforeEach, describe, expect, it } from 'vitest';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { udsService } from '../udsService';

describe('M14 UDS+ Reporting Readiness', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const actor = { name: 'Morgan Brooks', role: 'IntegrationEngineer' as const };

  beforeEach(async () => {
    settingsService.reset();
    udsService.resetForTests();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('builds cohort and evaluates editable UDS+ IG requirements with completeness scorecard', async () => {
    const added = udsService.addRequirement(ctx.tenantId, {
      category: 'SDOH',
      name: 'Transportation Barrier Screening',
      fhirPath: 'Observation.code(93030-5)',
      igProfile: 'uds-plus-observation',
      required: false,
      notes: 'Custom IG element',
    });

    const cohort = await udsService.buildCohort(ctx, {
      periodStart: '2025-01-01',
      periodEnd: '2026-12-31',
      minEncounters: 0,
      stateFilter: '',
      genderFilter: 'all',
    });

    expect(cohort.charts.length).toBeGreaterThanOrEqual(1);
    expect(cohort.evaluations.some((e) => e.requirement.id === added.id)).toBe(true);
    expect(cohort.overallCompletenessPct).toBeGreaterThan(0);

    udsService.deleteRequirement(ctx.tenantId, added.id);
    expect(udsService.getState(ctx.tenantId).requirements.some((r) => r.id === added.id)).toBe(false);
  });

  it('de-identifies cohort strictly: strips names/MRNs/contacts/streets, shifts dates consistently, generalizes ZIP, and never exports pseudonym map', async () => {
    await udsService.buildCohort(ctx, {
      periodStart: '2025-01-01',
      periodEnd: '2026-12-31',
      minEncounters: 0,
      stateFilter: '',
      genderFilter: 'all',
    });

    const { previews, bundle } = udsService.deidentifyCohort(ctx.tenantId);
    expect(previews.length).toBeGreaterThanOrEqual(1);
    expect(udsService.getInMemoryPseudonymCount()).toBeGreaterThanOrEqual(1);

    const first = previews[0];
    expect(first.after.name).toBeUndefined();
    expect(first.after.telecom).toBeUndefined();
    expect(first.after.identifier).toBeUndefined();
    expect(first.after.birthDate).not.toBe(first.before.birthDate);
    expect(first.after.id).toMatch(/^uds-[a-f0-9]+$/);

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('Jane Doe');
    expect(serialized).not.toContain('MRN-1001');
    expect(serialized).not.toContain(first.originalPatientId);
  });

  it('validates de-identified cohort against configured UDS+ & US Core profiles via $validate and surfaces M4 fix actions', async () => {
    await udsService.buildCohort(ctx, {
      periodStart: '2025-01-01',
      periodEnd: '2026-12-31',
      minEncounters: 0,
      stateFilter: '',
      genderFilter: 'all',
    });
    udsService.deidentifyCohort(ctx.tenantId);

    const val = await udsService.validateCohortAgainstProfiles(ctx);
    expect(val.passedCount).toBeGreaterThanOrEqual(1);
    expect(val.findings.length).toBeGreaterThanOrEqual(1);
    expect(val.findings[0].fixActionLabel).toContain('M4');
  });

  it('builds submission collection Bundle + MeasureReport, supports simulated rejection and resubmission', async () => {
    await udsService.buildCohort(ctx, {
      periodStart: '2025-01-01',
      periodEnd: '2026-12-31',
      minEncounters: 0,
      stateFilter: '',
      genderFilter: 'all',
    });
    udsService.deidentifyCohort(ctx.tenantId);

    const rejected = await udsService.submitDeidentifiedBundle(ctx, actor, {
      simulateRejection: true,
    });
    expect(rejected.status).toBe('Rejected');
    expect(rejected.measureReportId).toBeTruthy();

    const resubmitted = udsService.resubmitBundle(ctx.tenantId, rejected.id);
    expect(resubmitted.status).toBe('Resubmitted');
    expect(resubmitted.ackId).toMatch(/^HRSA-RESUB-/);
  });
});
