import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '../../../events';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { providerService } from '../../m3-directory/providerService';
import { SAMPLE_X12_837P, mmisEdiService } from '../mmisEdiService';

describe('M10 MMIS Load & EDI Trading Partner Setup', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const actor = { name: 'Casey Nguyen', role: 'IntegrationEngineer' as const };

  beforeEach(async () => {
    settingsService.reset();
    mmisEdiService.resetForTests();
    eventBus.clearHistory();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('auto-queues MMIS load with generated Medicaid ID on ProviderApproved, exports JSON & fixed-width, and emits MmisLoadAcknowledged', async () => {
    const providers = await providerService.listProviders(ctx);
    const target = providers[1];

    eventBus.publish({
      type: 'ProviderApproved',
      tenantId: ctx.tenantId,
      sourceModule: 'M8',
      payload: {
        practitionerId: target.id,
        providerName: target.fullName,
        npi: target.npi,
        effectiveDate: '2026-03-01',
      },
    });

    const st = mmisEdiService.getState(ctx.tenantId);
    const queued = st.loads.find((l) => l.practitionerId === target.id && l.status === 'Queued');
    expect(queued).toBeDefined();
    expect(queued!.medicaidId).toMatch(/^NY-MCD-\d+$/);
    expect(queued!.fixedWidthPayload.startsWith('HDRMMIS01')).toBe(true);

    const acked = await mmisEdiService.sendMmisLoad(ctx, queued!.id, actor, {
      forceOutcome: 'Acknowledged',
    });
    expect(acked.status).toBe('Acknowledged');
    expect(acked.taskId).toBeTruthy();
    expect(
      eventBus.getHistory(ctx.tenantId).some((e) => e.type === 'MmisLoadAcknowledged'),
    ).toBe(true);
  });

  it('falls back to Mock adapter with warning when Gateway mode fails and reconciles mismatches back into FHIR', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('Gateway offline'));

    mmisEdiService.setConfig(ctx.tenantId, { adapterMode: 'Gateway' });
    const providers = await providerService.listProviders(ctx);
    const load = mmisEdiService.queueMmisLoad(ctx.tenantId, {
      practitionerId: providers[2].id,
      providerName: providers[2].fullName,
      npi: providers[2].npi,
      action: 'InitialLoad',
      providerStatus: 'Active',
      effectiveDate: '2026-03-01',
    });

    // Reconciliation shows Medicaid ID mismatch before sync
    const reconBefore = await mmisEdiService.computeReconciliation(ctx);
    const mismatchRow = reconBefore.find((r) => r.loadId === load.id);
    expect(mismatchRow?.mismatches.length).toBeGreaterThan(0);

    await mmisEdiService.fixMismatchInFhir(ctx, load.id, actor);
    const reconAfter = await mmisEdiService.computeReconciliation(ctx);
    expect(reconAfter.find((r) => r.loadId === load.id)?.mismatches).toHaveLength(0);

    const sent = await mmisEdiService.sendMmisLoad(ctx, load.id, actor, {
      forceOutcome: 'Acknowledged',
    });
    expect(sent.adapterUsed).toBe('Mock');
    expect(sent.fallbackWarning).toMatch(/Gateway unreachable/i);

    fetchSpy.mockRestore();
  });

  it('onboards an EDI Trading Partner, enforces checklist before Go-Live, and creates FHIR Endpoint', async () => {
    const tp = mmisEdiService.createTradingPartner(ctx.tenantId, {
      tradingPartnerId: 'TP-EMPIRE-99',
      name: 'Empire Billing Clearinghouse',
      submitterId: 'SUB999',
      receiverId: 'NYMMIS01',
      transactions: ['837P', '835', '270/271'],
      connectivity: 'API',
      endpointAddress: 'https://empire.synthetic.example/edi',
    });

    await expect(
      mmisEdiService.approveTradingPartnerGoLive(ctx, tp.id, actor),
    ).rejects.toThrow(/checklist/i);

    mmisEdiService.updatePartnerChecklist(ctx.tenantId, tp.id, {
      envelopeTested: true,
      ack999Passed: true,
      ack277CaPassed: true,
      securityVerified: true,
    });

    const live = await mmisEdiService.approveTradingPartnerGoLive(ctx, tp.id, actor);
    expect(live.status).toBe('Live');
    expect(live.endpointResourceId).toBeTruthy();

    const ep = await mockFhirClient.read(ctx, 'Endpoint', live.endpointResourceId!);
    expect(ep.resourceType).toBe('Endpoint');
  });

  it('validates X12 payloads in the EDI Test Console and produces 999 and 277CA acknowledgements', () => {
    const ok = mmisEdiService.runEdiTestConsole(ctx.tenantId, SAMPLE_X12_837P);
    expect(ok.valid).toBe(true);
    expect(ok.ack999).toContain('IK5*A~');
    expect(ok.ack277Ca).toContain('ST*277*');

    const bad = mmisEdiService.runEdiTestConsole(ctx.tenantId, 'CLM*BROKEN*100~');
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.ack999).toContain('IK5*R~');
  });
});
