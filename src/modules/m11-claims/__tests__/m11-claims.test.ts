import { beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../events';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { providerOpsService } from '../../m22-provider-ops/providerOpsService';
import { planService } from '../../m23-plans/planService';
import { claimsService } from '../claimsService';

describe('M11 Claims & Operations Simulation', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const actor = { name: 'Riley Chen', role: 'PlanManager' as const };
  const patientId = 'pat-jane-doe-state-medicaid-a';

  beforeEach(async () => {
    settingsService.reset();
    claimsService.resetForTests();
    planService.resetForTests();
    providerOpsService.resetForTests();
    eventBus.clearHistory();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('adjudicates a clean in-network claim through all 6 stages to Paid using M23 rate schedules and writes Claim, ClaimResponse & PaymentReconciliation', async () => {
    const ffsPlan = planService.getState(ctx).plans[0];
    const claim = await claimsService.submitAndAdjudicateClaim(
      ctx,
      {
        patientId,
        patientName: 'Jane Doe',
        billingProviderId: 'prac-a-1',
        renderingProviderId: 'prac-a-1',
        planId: ffsPlan.id,
        lines: [
          {
            code: '99214',
            diagnosisCode: 'I10',
            units: 1,
            billedUsd: 165.0,
            dateOfService: '2026-06-15',
          },
        ],
      },
      actor,
    );

    expect(claim.decision).toBe('Paid');
    expect(claim.totalPaidUsd).toBe(131.75); // M23 2026 fee schedule rate for 99214
    expect(claim.pipelineTrace).toHaveLength(6);
    expect(claim.fhirClaimId).toBeTruthy();
    expect(claim.fhirClaimResponseId).toBeTruthy();
    expect(claim.fhirPaymentReconciliationId).toBeTruthy();

    const recon = await mockFhirClient.read(ctx, 'PaymentReconciliation', claim.fhirPaymentReconciliationId!);
    expect(recon.resourceType).toBe('PaymentReconciliation');
  });

  it('denies claims with PROVIDER_NOT_ACTIVE when rendering provider is Suspended in M3', async () => {
    const ffsPlan = planService.getState(ctx).plans[0];
    await providerOpsService.changeProviderStatus(
      ctx,
      'prac-a-1',
      'Suspended',
      'OIG-LEIE Exclusion Hit',
      '2026-03-01',
      { name: 'Program Integrity', role: 'ProgramIntegrityOfficer' },
    );

    const denied = await claimsService.submitAndAdjudicateClaim(
      ctx,
      {
        patientId,
        patientName: 'Jane Doe',
        billingProviderId: 'prac-a-1',
        renderingProviderId: 'prac-a-1',
        planId: ffsPlan.id,
        lines: [
          {
            code: '99213',
            diagnosisCode: 'I10',
            units: 1,
            billedUsd: 110,
            dateOfService: '2026-06-15',
          },
        ],
      },
      actor,
    );

    expect(denied.decision).toBe('Denied');
    expect(denied.denialCode).toBe('PROVIDER_NOT_ACTIVE');
    expect(denied.totalPaidUsd).toBe(0);
  });

  it('enforces M23 Prior Authorization rules and pays once PA is approved', async () => {
    const ffsPlan = planService.getState(ctx).plans[0];

    // CPT 70551 requires PA under FFS plan
    const deniedNoPa = await claimsService.submitAndAdjudicateClaim(
      ctx,
      {
        patientId,
        patientName: 'Jane Doe',
        billingProviderId: 'prac-a-1',
        renderingProviderId: 'prac-a-1',
        planId: ffsPlan.id,
        lines: [
          {
            code: '70551',
            modifier: '26',
            diagnosisCode: 'G43.909',
            units: 1,
            billedUsd: 300,
            dateOfService: '2026-06-15',
          },
        ],
      },
      actor,
    );
    expect(deniedNoPa.decision).toBe('Denied');
    expect(deniedNoPa.denialCode).toBe('PRIOR_AUTH_REQUIRED');

    // Submit & approve PA
    const pa = claimsService.submitPriorAuth(ctx.tenantId, {
      patientId,
      patientName: 'Jane Doe',
      providerId: 'prac-a-1',
      providerName: 'Dr. Elena Vargas',
      planId: ffsPlan.id,
      planName: ffsPlan.name,
      procedureCode: '70551',
      clinicalNotes: 'Approved neurological indication.',
    });
    claimsService.decidePriorAuth(ctx.tenantId, pa.id, 'Approved', actor.name);

    const paidWithPa = await claimsService.submitAndAdjudicateClaim(
      ctx,
      {
        patientId,
        patientName: 'Jane Doe',
        billingProviderId: 'prac-a-1',
        renderingProviderId: 'prac-a-1',
        planId: ffsPlan.id,
        priorAuthNumber: pa.authNumber,
        lines: [
          {
            code: '70551',
            modifier: '26',
            diagnosisCode: 'G43.909',
            units: 1,
            billedUsd: 300,
            dateOfService: '2026-06-15',
          },
        ],
      },
      actor,
    );
    expect(paidWithPa.decision).toBe('Paid');
    expect(paidWithPa.totalPaidUsd).toBe(245);
  });

  it('denies ineligible date of service and computes Operations Dashboard denial Pareto metrics', async () => {
    const ffsPlan = planService.getState(ctx).plans[0];
    const deniedElig = await claimsService.submitAndAdjudicateClaim(
      ctx,
      {
        patientId,
        patientName: 'Jane Doe',
        billingProviderId: 'prac-a-1',
        renderingProviderId: 'prac-a-1',
        planId: ffsPlan.id,
        lines: [
          {
            code: '99213',
            diagnosisCode: 'I10',
            units: 1,
            billedUsd: 100,
            dateOfService: '2024-01-15', // outside 2026 Coverage period
          },
        ],
      },
      actor,
    );
    expect(deniedElig.decision).toBe('Denied');
    expect(deniedElig.denialCode).toBe('MEMBER_NOT_ELIGIBLE');

    const metrics = claimsService.getDashboardMetrics(ctx.tenantId);
    expect(metrics.deniedCount).toBe(1);
    expect(metrics.denialPareto[0]).toEqual({ code: 'MEMBER_NOT_ELIGIBLE', count: 1, pct: 100 });
  });
});
