import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '../../../events';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { ecrService } from '../ecrService';

describe('M13 Electronic Case Reporting (eCR)', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const actor = { name: 'Alex Rivera', role: 'IntegrationEngineer' as const };
  const janeDoeId = 'pat-jane-doe-state-medicaid-a';

  beforeEach(async () => {
    settingsService.reset();
    ecrService.resetForTests();
    eventBus.clearHistory();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('Scenario C: triggers on positive SARS-CoV-2 patient, builds & $validates eICR Composition Bundle, submits to stub, and ingests RR DocumentReference', async () => {
    const triggerRes = await ecrService.evaluatePatientTriggers(ctx, janeDoeId, actor);
    expect(triggerRes.triggered).toBe(true);
    expect(triggerRes.createdCase).toBeDefined();
    expect(triggerRes.createdCase!.conditionGroup).toContain('COVID-19');

    const caseId = triggerRes.createdCase!.id;
    const built = await ecrService.buildAndValidateEicr(ctx, caseId, actor);
    expect(built.status).toBe('eICR created');
    expect(built.validationPassed).toBe(true);
    expect(built.eicrBundle?.type).toBe('document');
    expect(built.eicrBundle?.entry?.[0].resource?.resourceType).toBe('Composition');

    const submitted = await ecrService.submitEicr(ctx, caseId, actor);
    expect(submitted.status).toBe('Acknowledged');
    expect(submitted.phaStatus).toBe('Pending PHA Review');

    const rrDone = await ecrService.processPhaDecisionAndRrIntake(
      ctx,
      caseId,
      {
        accept: true,
        determination: 'Reportable',
        ruleSummary: 'Positive COVID-19 PCR reportable to State DOH.',
        phaReviewer: 'PHA Stub Reviewer',
      },
      actor,
    );

    expect(rrDone.status).toBe('RR received');
    expect(rrDone.reportabilityResponse?.documentReferenceId).toBeTruthy();

    const docRef = await mockFhirClient.read(
      ctx,
      'DocumentReference',
      rrDone.reportabilityResponse!.documentReferenceId!,
    );
    expect(docRef.resourceType).toBe('DocumentReference');

    const events = eventBus.getHistory(ctx.tenantId).map((e) => e.type);
    expect(events).toContain('CaseTriggered');
    expect(events).toContain('EicrGenerated');
    expect(events).toContain('ReportabilityResponseReceived');
  });

  it('supports editable trigger code value set (add, toggle, update metadata, delete)', () => {
    const added = ecrService.addTriggerCode(ctx.tenantId, {
      system: 'http://snomed.info/sct',
      systemLabel: 'SNOMED',
      code: '76795007',
      display: 'Acute type B viral hepatitis',
      conditionGroup: 'Hepatitis B',
      resourceTypes: ['Condition'],
      active: true,
    });
    expect(ecrService.getState(ctx.tenantId).valueSet.codes.some((c) => c.id === added.id)).toBe(true);

    ecrService.updateTriggerCode(ctx.tenantId, added.id, { active: false });
    expect(ecrService.getState(ctx.tenantId).valueSet.codes.find((c) => c.id === added.id)?.active).toBe(false);

    ecrService.updateValueSetMetadata(ctx.tenantId, { version: '2026.2.0-RCTC' });
    expect(ecrService.getState(ctx.tenantId).valueSet.version).toBe('2026.2.0-RCTC');

    ecrService.deleteTriggerCode(ctx.tenantId, added.id);
    expect(ecrService.getState(ctx.tenantId).valueSet.codes.some((c) => c.id === added.id)).toBe(false);
  });

  it('supports follow-up eICR versioning and case closure', async () => {
    const trig = await ecrService.evaluatePatientTriggers(ctx, janeDoeId, actor);
    const caseId = trig.createdCase!.id;
    await ecrService.buildAndValidateEicr(ctx, caseId, actor);
    const followUp = await ecrService.createFollowUpUpdate(ctx, caseId, actor);
    expect(followUp.versionNumber).toBe(2);

    const closed = ecrService.closeCase(ctx.tenantId, caseId, 'Reporting completed.', actor.name);
    expect(closed.status).toBe('Closed');
  });

  it('falls back cleanly to built-in eCRNow stub when live eCRNow endpoint is unreachable', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('Connection refused'));

    ecrService.updateAdapterConfig(ctx.tenantId, {
      enabledLive: true,
      baseUrl: 'http://localhost:8080',
      submitPath: '/api/v2/eicr',
    });

    const trig = await ecrService.evaluatePatientTriggers(ctx, janeDoeId, actor);
    const res = await ecrService.submitEicr(ctx, trig.createdCase!.id, actor, {
      autoReceiveStubRr: true,
      simulatedDetermination: 'May be reportable',
    });

    expect(res.submittedVia).toBe('eCRNow Built-in Stub');
    expect(res.fallbackWarning).toMatch(/Live eCRNow unreachable/i);
    expect(res.reportabilityResponse?.determination).toBe('May be reportable');

    fetchSpy.mockRestore();
  });
});
