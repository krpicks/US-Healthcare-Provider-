import { beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../events';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { planService } from '../planService';

describe('M23 Plan Management & Rate Schedules', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const actor = { name: 'Jamie Foster', role: 'PlanManager' as const };

  beforeEach(async () => {
    settingsService.reset();
    planService.resetForTests();
    eventBus.clearHistory();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('looks up effective reimbursement rates by CPT code, plan, provider type, and date of service', () => {
    const state = planService.getState(ctx);
    const ffsPlan = state.plans[0];

    const hit = planService.lookupEffectiveRate(ctx, {
      code: '99213',
      planId: ffsPlan.id,
      providerType: 'Individual Physician',
      dateOfService: '2026-06-15',
    });
    expect(hit.found).toBe(true);
    expect(hit.rateUsd).toBe(92.5);

    const outOfRange = planService.lookupEffectiveRate(ctx, {
      code: '99213',
      planId: ffsPlan.id,
      providerType: 'Individual Physician',
      dateOfService: '2024-06-15',
    });
    expect(outOfRange.found).toBe(false);
  });

  it('verifies member eligibility against seeded FHIR Coverage resources', async () => {
    const state = planService.getState(ctx);
    const ffsPlan = state.plans[0];

    const eligible = await planService.checkMemberEligibility(
      ctx,
      'pat-jane-doe-state-medicaid-a',
      ffsPlan.id,
      '2026-06-15',
    );
    expect(eligible.eligible).toBe(true);
    expect(eligible.coverage?.resourceType).toBe('Coverage');

    const ineligible = await planService.checkMemberEligibility(
      ctx,
      'pat-jane-doe-state-medicaid-a',
      ffsPlan.id,
      '2025-01-01',
    );
    expect(ineligible.eligible).toBe(false);
  });

  it('detects network adequacy gaps and resolves them after bulk provider assignment', () => {
    const initial = planService.evaluateNetworkAdequacy(ctx);
    const bhGap = initial.find((g) => g.category === 'Behavioral Health');
    expect(bhGap?.status).toBe('Gap Detected');
    expect((bhGap?.ratioGap ?? 0) > 0).toBe(true);

    planService.assignProvidersToNetwork(ctx, bhGap!.networkId, [
      'prac-a-1',
      'prac-a-2',
      'prac-a-4',
      'prac-a-5',
    ]);

    const after = planService.evaluateNetworkAdequacy(ctx);
    const bhResolved = after.find((g) => g.networkId === bhGap!.networkId);
    expect(bhResolved?.status).toBe('Adequate');
    expect(bhResolved?.ratioGap).toBe(0);
  });

  it('builds, validates ($validate), publishes directory bundle, and tracks snapshot diffs', async () => {
    const firstPreview = await planService.buildAndValidateDirectoryBundle(ctx);
    expect(firstPreview.validationOk).toBe(true);
    expect(firstPreview.bundle.entry?.length).toBeGreaterThan(0);
    expect(firstPreview.addedKeys.length).toBe(firstPreview.bundle.entry?.length);

    const snapshot = await planService.publishDirectorySnapshot(ctx, actor);
    expect(snapshot.validationOk).toBe(true);

    const secondPreview = await planService.buildAndValidateDirectoryBundle(ctx);
    expect(secondPreview.addedKeys).toHaveLength(0);
    expect(secondPreview.removedKeys).toHaveLength(0);
  });

  it('imports fee schedule CSV and increments rate schedule version with RateScheduleChanged event', () => {
    const state = planService.getState(ctx);
    const schedule = state.rateSchedules[0];
    const csv = [
      'code,modifier,description,rateUsd,effectiveStart,effectiveEnd',
      '99215,,Office visit high complexity,184.25,2026-01-01,2026-12-31',
    ].join('\n');

    const updated = planService.importFeeScheduleCsv(ctx, schedule.id, csv);
    expect(updated.version).toBe('2026.2');
    expect(updated.entries.some((e) => e.code === '99215')).toBe(true);
    expect(
      eventBus.getHistory(ctx.tenantId).some((e) => e.type === 'RateScheduleChanged'),
    ).toBe(true);
  });
});
