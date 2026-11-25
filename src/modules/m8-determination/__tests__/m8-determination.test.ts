import { beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../events';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { providerService } from '../../m3-directory/providerService';
import { enrollmentService } from '../../m5-enrollment/enrollmentService';
import {
  DENIAL_REASON_CODES,
  computeSlaHealth,
  determinationService,
} from '../determinationService';

describe('M8 Review, Determination, RFI & Appeals', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const analyst = { name: 'Taylor Brooks', role: 'EnrollmentAnalyst' as const };
  const approver = { name: 'Morgan Avery', role: 'AgencyApprover' as const };

  beforeEach(async () => {
    settingsService.reset();
    enrollmentService.resetForTests();
    determinationService.resetForTests();
    eventBus.clearHistory();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('computes SLA health (On track / At risk / Breached) and supports bulk assign & next-case routing', () => {
    const apps = enrollmentService.listApplications(ctx.tenantId);
    expect(computeSlaHealth(apps[0]).health).toBe('On track');
    expect(computeSlaHealth(apps[1]).health).toBe('At risk');
    expect(computeSlaHealth(apps[2]).health).toBe('Breached');

    determinationService.bulkAssign(ctx.tenantId, [apps[0].id, apps[1].id], 'Alex Rivera');
    expect(enrollmentService.getApplicationById(ctx.tenantId, apps[0].id)?.assignedAnalyst).toBe('Alex Rivera');

    const next = determinationService.getNextCase(ctx.tenantId);
    expect(next).toBeDefined();
  });

  it('enforces two-person AgencyApprover sign-off on High-risk Approvals and activates provider in M3', async () => {
    const highApp = enrollmentService.listApplications(ctx.tenantId)[2];
    highApp.riskTier = 'High';
    highApp.status = 'In Review';

    // Analyst cannot unilaterally finalize High-risk approval
    const queued = await determinationService.submitDecision(
      ctx,
      {
        applicationId: highApp.id,
        decisionType: 'Approve',
        effectiveDate: '2026-03-01',
        notes: 'All High-risk site visit and fingerprint checks cleared.',
      },
      analyst,
    );
    expect(queued.status).toBe('PendingSignOff');
    expect(queued.pending).toBeDefined();

    // Analyst cannot sign off own pending decision
    await expect(
      determinationService.signOffPendingDecision(ctx, queued.pending!.id, analyst),
    ).rejects.toThrow(/AgencyApprover/);

    // AgencyApprover signs off -> finalizes, creates M3 Practitioner, emits ProviderApproved
    const finalDecision = await determinationService.signOffPendingDecision(
      ctx,
      queued.pending!.id,
      approver,
    );
    expect(finalDecision.outcome).toBe('Approved');
    expect(finalDecision.provenanceId).toBeTruthy();
    expect(enrollmentService.getApplicationById(ctx.tenantId, highApp.id)?.status).toBe('Approved');

    const providers = await providerService.listProviders(ctx);
    expect(providers.some((p) => p.npi === highApp.npi && p.status === 'Active')).toBe(true);
    expect(eventBus.getHistory(ctx.tenantId).some((e) => e.type === 'ProviderApproved')).toBe(true);
  });

  it('enforces two-person rule on Denials, emits ProviderDenied, and re-opens case when Appeal is Overturned', async () => {
    const app = enrollmentService.listApplications(ctx.tenantId)[1];

    const queuedDeny = await determinationService.submitDecision(
      ctx,
      {
        applicationId: app.id,
        decisionType: 'Deny',
        reasonCodes: [DENIAL_REASON_CODES[1]],
        notes: 'License could not be verified.',
      },
      analyst,
    );
    expect(queuedDeny.status).toBe('PendingSignOff');

    const denied = await determinationService.signOffPendingDecision(
      ctx,
      queuedDeny.pending!.id,
      approver,
    );
    expect(denied.outcome).toBe('Denied');
    expect(denied.letterText).toContain('APPEAL RIGHTS');
    expect(eventBus.getHistory(ctx.tenantId).some((e) => e.type === 'ProviderDenied')).toBe(true);

    // File and overturn appeal -> case re-opens to In Review
    const appeal = determinationService.fileAppeal(
      ctx.tenantId,
      app.id,
      'Board issued corrected active license certificate.',
      ['corrected_license.pdf'],
    );
    expect(appeal.status).toBe('Open');

    const resolved = await determinationService.resolveAppeal(
      ctx,
      appeal.id,
      'Overturned',
      'Verified board reinstatement letter; returning to review.',
      approver,
    );
    expect(resolved.status).toBe('Overturned');
    expect(enrollmentService.getApplicationById(ctx.tenantId, app.id)?.status).toBe('In Review');
  });

  it('pends a case with RFI deficiency notice and stores FHIR Communication', async () => {
    const app = enrollmentService.listApplications(ctx.tenantId)[1];
    const comm = await determinationService.pendWithRfi(
      ctx,
      app.id,
      ['Missing Malpractice Certificate of Insurance ($1M/$3M)'],
      '2026-04-15',
      'Provide updated COI.',
      analyst,
    );
    expect(comm.resourceType).toBe('Communication');
    expect(enrollmentService.getApplicationById(ctx.tenantId, app.id)?.status).toBe('RFI Issued');
  });
});
