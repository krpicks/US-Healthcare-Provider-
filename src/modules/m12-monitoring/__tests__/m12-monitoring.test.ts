import { beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../events';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { providerService } from '../../m3-directory/providerService';
import { enrollmentService } from '../../m5-enrollment/enrollmentService';
import { validationService } from '../../m6-validation/validationService';
import { mmisEdiService } from '../../m10-mmis-edi/mmisEdiService';
import { claimsService } from '../../m11-claims/claimsService';
import { providerOpsService } from '../../m22-provider-ops/providerOpsService';
import { planService } from '../../m23-plans/planService';
import { monitoringService } from '../monitoringService';

describe('M12 Ongoing Monitoring & Revalidation', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const officer = { name: 'Dana Morales', role: 'ProgramIntegrityOfficer' as const };

  beforeEach(async () => {
    settingsService.reset();
    monitoringService.resetForTests();
    validationService.resetForTests();
    enrollmentService.resetForTests();
    mmisEdiService.resetForTests();
    claimsService.resetForTests();
    providerOpsService.resetForTests();
    planService.resetForTests();
    eventBus.clearHistory();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('Scenario B: detects M6 exclusion hit, suspends provider updating M3 + M10 MMIS, and blocks M11 claims with PROVIDER_NOT_ACTIVE', async () => {
    const providers = await providerService.listProviders(ctx);
    const target = providers.find((p) => p.id === 'prac-a-1')!;

    // Add active M3 provider to M6 exclusion list
    validationService.addExclusionEntry(ctx.tenantId, {
      name: target.fullName,
      npi: target.npi,
      source: 'OIG-LEIE',
      exclusionType: '1128(a)(1) Program Fraud',
      effectiveDate: '2026-03-01',
    });

    // Run M12 exclusion monitor -> raises ExclusionHit alert + Task + DetectedIssue + event
    const run = await monitoringService.runMonitor(ctx, 'exclusion-rescreen', officer);
    expect(run.newAlerts).toHaveLength(1);
    const alert = run.newAlerts[0];
    expect(alert.alertType).toBe('ExclusionHit');
    expect(alert.taskId).toBeTruthy();
    expect(alert.detectedIssueId).toBeTruthy();
    expect(eventBus.getHistory(ctx.tenantId).some((e) => e.type === 'ExclusionHit')).toBe(true);

    // Suspend provider from alert -> M3 Suspended, M10 MMIS StatusUpdate queued, M11 claim Denied PROVIDER_NOT_ACTIVE
    const suspendedAlert = await monitoringService.suspendProviderFromAlert(
      ctx,
      alert.id,
      'Mandatory federal exclusion suspension.',
      officer,
    );
    expect(suspendedAlert.status).toBe('Suspended');
    expect(suspendedAlert.programIntegrityReferralId).toBeTruthy();

    const updatedProviders = await providerService.listProviders(ctx);
    expect(updatedProviders.find((p) => p.id === 'prac-a-1')?.status).toBe('Suspended');

    const mmisLoads = mmisEdiService.getState(ctx.tenantId).loads;
    expect(
      mmisLoads.some((l) => l.practitionerId === 'prac-a-1' && l.action === 'StatusUpdate' && l.providerStatus === 'Suspended'),
    ).toBe(true);

    const ffsPlan = planService.getState(ctx).plans[0];
    const blockedClaim = await claimsService.submitAndAdjudicateClaim(
      ctx,
      {
        patientId: 'pat-jane-doe-state-medicaid-a',
        patientName: 'Jane Doe',
        billingProviderId: 'prac-a-1',
        renderingProviderId: 'prac-a-1',
        planId: ffsPlan.id,
        lines: [
          { code: '99213', diagnosisCode: 'I10', units: 1, billedUsd: 100, dateOfService: '2026-06-15' },
        ],
      },
      { name: 'Claims Analyst', role: 'PlanManager' },
    );
    expect(blockedClaim.decision).toBe('Denied');
    expect(blockedClaim.denialCode).toBe('PROVIDER_NOT_ACTIVE');
  });

  it('detects 90/60/30-day license expirations, emits LicenseExpiring, and launches pre-filled M5 Revalidation draft', async () => {
    const run = await monitoringService.runMonitor(ctx, 'license-expiry', officer);
    expect(run.newAlerts.length).toBeGreaterThanOrEqual(1);
    expect(eventBus.getHistory(ctx.tenantId).some((e) => e.type === 'LicenseExpiring')).toBe(true);

    const { alert, draftId } = await monitoringService.startRevalidationFromAlert(
      ctx,
      run.newAlerts[0].id,
      officer.name,
    );
    expect(alert.status).toBe('RevalidationStarted');
    const draft = enrollmentService.getApplicationById(ctx.tenantId, draftId);
    expect(draft?.applicationType).toBe('Revalidation');
    expect(draft?.npi).toBe(alert.npi);
  });

  it('creates FHIR Subscription resource, dismisses alerts with Provenance, and builds sorted Expiration Calendar', async () => {
    const sub = await monitoringService.createFhirSubscription(
      ctx,
      {
        reason: 'Track suspended practitioners',
        criteria: 'Practitioner?active=false',
        channelType: 'rest-hook',
        endpoint: 'https://hooks.synthetic.example/prac',
      },
      officer,
    );
    expect(sub.fhirSubscriptionId).toBeTruthy();
    const fhirSub = await mockFhirClient.read(ctx, 'Subscription', sub.fhirSubscriptionId!);
    expect(fhirSub.resourceType).toBe('Subscription');

    const run = await monitoringService.runMonitor(ctx, 'revalidation-due', officer);
    expect(run.newAlerts.length).toBeGreaterThanOrEqual(1);
    const dismissed = await monitoringService.dismissAlertWithReason(
      ctx,
      run.newAlerts[0].id,
      'Revalidation packet received via paper backup.',
      officer,
    );
    expect(dismissed.status).toBe('Dismissed');
    expect(dismissed.actionNote).toContain('Provenance/');

    const calendar = await monitoringService.getExpirationCalendar(ctx);
    expect(calendar.length).toBeGreaterThan(0);
    for (let i = 1; i < calendar.length; i += 1) {
      expect(calendar[i].daysUntilDue).toBeGreaterThanOrEqual(calendar[i - 1].daysUntilDue);
    }
  });
});
