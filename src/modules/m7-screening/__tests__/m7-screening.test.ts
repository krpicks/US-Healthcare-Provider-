import { beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../events';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { enrollmentService } from '../../m5-enrollment/enrollmentService';
import { screeningService } from '../screeningService';

describe('M7 Risk-Based Screening', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const analyst = { name: 'Taylor Brooks', role: 'EnrollmentAnalyst' as const };
  const approver = { name: 'Morgan Avery', role: 'AgencyApprover' as const };

  beforeEach(async () => {
    settingsService.reset();
    enrollmentService.resetForTests();
    screeningService.resetForTests();
    eventBus.clearHistory();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('evaluates Limited, Moderate, and High risk tiers from configurable rules with version history', () => {
    const apps = enrollmentService.listApplications(ctx.tenantId);
    expect(screeningService.evaluateRiskTier(ctx.tenantId, apps[0]).tier).toBe('Limited');
    expect(screeningService.evaluateRiskTier(ctx.tenantId, apps[1]).tier).toBe('Moderate');
    expect(screeningService.evaluateRiskTier(ctx.tenantId, apps[2]).tier).toBe('High');

    screeningService.updateRule(ctx.tenantId, 'rr-2', { resultingTier: 'High' }, analyst.name);
    expect(screeningService.getState(ctx.tenantId).ruleVersions.length).toBeGreaterThan(1);
    expect(screeningService.evaluateRiskTier(ctx.tenantId, apps[1]).tier).toBe('High');
  });

  it('persists FHIR RiskAssessment and screening Tasks, and transitions to In Review once all tasks finish', async () => {
    const highApp = enrollmentService.listApplications(ctx.tenantId)[2];
    const assigned = await screeningService.assignScreening(ctx, highApp.id, analyst);

    expect(assigned.effectiveTier).toBe('High');
    expect(assigned.riskAssessmentId).toBeTruthy();
    expect(assigned.taskIds).toHaveLength(3); // DB + Site visit + Fingerprints
    expect(assigned.requiresSiteVisit).toBe(true);
    expect(assigned.requiresFingerprint).toBe(true);
    expect(eventBus.getHistory(ctx.tenantId).some((e) => e.type === 'ScreeningAssigned')).toBe(true);

    const completed = await screeningService.updateScreeningTasks(
      ctx,
      highApp.id,
      {
        databaseCheckDone: true,
        siteVisit: {
          completed: true,
          signageVerified: true,
          hoursPosted: true,
          adaAccessible: true,
          equipmentPresent: true,
          outcome: 'Passed',
        },
        fingerprints: assigned.fingerprints.map((f) => ({
          ...f,
          status: 'Cleared',
          clearedDate: '2026-03-01',
        })),
      },
      analyst,
    );

    expect(completed.status).toBe('Completed');
    expect(enrollmentService.getApplicationById(ctx.tenantId, highApp.id)?.status).toBe('In Review');
    expect(eventBus.getHistory(ctx.tenantId).some((e) => e.type === 'ScreeningCompleted')).toBe(true);
  });

  it('enforces AgencyApprover/ProgramIntegrityOfficer role for risk tier override and writes Provenance', async () => {
    const app = enrollmentService.listApplications(ctx.tenantId)[1];
    await screeningService.assignScreening(ctx, app.id, analyst);

    await expect(
      screeningService.overrideRiskTier(ctx, app.id, 'Limited', 'Downgrade attempt', analyst),
    ).rejects.toThrow(/requires AgencyApprover/i);

    const overridden = await screeningService.overrideRiskTier(
      ctx,
      app.id,
      'Limited',
      'Established Medicare-enrolled clinician eligible for Limited tier per CMS guidance.',
      approver,
    );
    expect(overridden.effectiveTier).toBe('Limited');
    expect(overridden.requiresSiteVisit).toBe(false);
    expect(overridden.override?.provenanceId).toBeTruthy();
  });
});
