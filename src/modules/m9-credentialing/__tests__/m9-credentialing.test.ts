import { beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../events';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { providerService } from '../../m3-directory/providerService';
import { planService } from '../../m23-plans/planService';
import { credentialingService } from '../credentialingService';

describe('M9 Credentialing & Contracting', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const actor = { name: 'Jordan Patel', role: 'CredentialingSpecialist' as const };

  beforeEach(async () => {
    settingsService.reset();
    credentialingService.resetForTests();
    planService.resetForTests();
    eventBus.clearHistory();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('auto-approves a clean 8-item PSV file, schedules 36-month recredentialing, and emits CredentialingCompleted', async () => {
    const providers = await providerService.listProviders(ctx);
    const file = credentialingService.createCredentialingFile(ctx.tenantId, providers[1]);
    expect(file.psvItems).toHaveLength(8);

    credentialingService.markAllPsvVerified(ctx.tenantId, file.id, actor.name);
    const completed = await credentialingService.evaluateAndFinalizeFile(ctx, file.id, actor);

    expect(completed.status).toBe('Clean - Auto Approved');
    expect(completed.nextRecredentialingDue).toBeTruthy();
    expect(completed.taskId).toBeTruthy();
    expect(completed.provenanceId).toBeTruthy();
    expect(
      eventBus.getHistory(ctx.tenantId).some((e) => e.type === 'CredentialingCompleted'),
    ).toBe(true);
  });

  it('routes flagged PSV files to Committee, records votes, exports minutes, and finalizes Committee Approved', async () => {
    const state = credentialingService.getState(ctx.tenantId);
    const flaggedFile = state.files.find((f) => f.status === 'Committee Review');
    expect(flaggedFile).toBeDefined();

    const finalized = await credentialingService.recordCommitteeVoteAndDecision(
      ctx,
      flaggedFile!.id,
      {
        vote: 'Approve',
        comment: 'Board review cleared prior malpractice settlement.',
        finalizeOutcome: 'Committee Approved',
      },
      { name: 'Morgan Avery', role: 'AgencyApprover' },
    );
    expect(finalized.status).toBe('Committee Approved');
    expect(finalized.votes.length).toBeGreaterThanOrEqual(2);

    const minutes = credentialingService.exportCommitteeMinutes(ctx.tenantId, flaggedFile!.id);
    expect(minutes).toContain('Credentialing Committee Minutes');
    expect(minutes).toContain('Board review cleared');
  });

  it('executes merge-field contract, links provider to M23 plan network, adds amendments, and emits ContractSigned', async () => {
    const providers = await providerService.listProviders(ctx);
    const planState = planService.getState(ctx);
    const mcoPlan = planState.plans[1];
    const bhNet = planState.networks.find((n) => n.planId === mcoPlan.id)!;

    const ctr = await credentialingService.createAndSignContract(
      ctx,
      {
        practitionerId: providers[1].id,
        providerName: providers[1].fullName,
        npi: providers[1].npi,
        templateId: 'tpl-mco-2026',
        planId: mcoPlan.id,
        networkId: bhNet.id,
        effectiveStart: '2026-01-01',
        effectiveEnd: '2026-12-31',
        signerName: providers[1].fullName,
      },
      actor,
    );
    expect(ctr.status).toBe('Active');
    expect(ctr.renderedText).toContain(providers[1].fullName);
    expect(ctr.renderedText).toContain(providers[1].npi);
    expect(bhNet.assignedProviderIds).toContain(providers[1].id);
    expect(eventBus.getHistory(ctx.tenantId).some((e) => e.type === 'ContractSigned')).toBe(true);

    const amended = credentialingService.addContractAmendment(
      ctx.tenantId,
      ctr.id,
      { title: '2026 Telehealth Addendum', effectiveDate: '2026-06-01', summary: 'Parity rates added.' },
      actor.name,
    );
    expect(amended.status).toBe('Amended');
    expect(amended.amendments).toHaveLength(1);
  });

  it('shares credentialing packet with plan as FHIR Bundle + Provenance', async () => {
    const state = credentialingService.getState(ctx.tenantId);
    const planState = planService.getState(ctx);
    const shared = await credentialingService.shareCredentialingWithPlan(
      ctx,
      state.files[0].id,
      planState.plans[0].id,
      actor,
    );
    expect(shared.resourceCount).toBeGreaterThanOrEqual(3);
    expect(shared.provenanceId).toBeTruthy();
    const parsed = JSON.parse(shared.bundleJson) as { resourceType: string; type: string };
    expect(parsed.resourceType).toBe('Bundle');
    expect(parsed.type).toBe('collection');
  });
});
