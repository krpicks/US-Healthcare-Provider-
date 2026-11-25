import { beforeEach, describe, expect, it } from 'vitest';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { SAMPLE_INFERNO_JSON, conformanceService } from '../conformanceService';

describe('M15 FHIR Conformance & Inferno Dashboard', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };

  beforeEach(async () => {
    settingsService.reset();
    conformanceService.resetForTests();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('executes all 6 built-in FHIR R4 conformance probes including fhirVersion 4.0.1, CapabilityStatement, search, $validate, meta.profile, and reference integrity', async () => {
    const checks = await conformanceService.runBuiltInChecks(ctx);
    expect(checks).toHaveLength(6);
    expect(checks.find((c) => c.id === 'chk-fhir-version')?.status).toBe('Pass');
    expect(checks.find((c) => c.id === 'chk-cap-resources')?.status).toBe('Pass');
    expect(checks.find((c) => c.id === 'chk-search-params')?.status).toBe('Pass');
    expect(checks.find((c) => c.id === 'chk-validate-op')?.status).toBe('Pass');
    expect(checks.find((c) => c.id === 'chk-ref-integrity')?.status).toBe('Pass');
  });

  it('imports Inferno JSON results, computes pass/fail/skip/omit counts, and auto-creates classified failure triage items', () => {
    const { run, createdTriageCount } = conformanceService.importInfernoResults(
      ctx.tenantId,
      SAMPLE_INFERNO_JSON,
      'JSON',
      'Jordan Lee',
    );
    expect(run.passCount).toBe(4);
    expect(run.failCount).toBe(2);
    expect(run.skipCount).toBe(1);
    expect(run.omitCount).toBe(1);
    expect(run.passRatePct).toBe(67);
    expect(createdTriageCount).toBe(2);

    const triage = conformanceService.getState(ctx.tenantId).triageItems;
    expect(triage.some((t) => t.causeCategory === 'profile claim')).toBe(true);
    expect(triage.some((t) => t.causeCategory === 'search parameter')).toBe(true);

    const updated = conformanceService.updateTriageItem(ctx.tenantId, triage[0].id, {
      status: 'Resolved',
      notes: 'Added US Core meta.profile URL in seed factory.',
    });
    expect(updated.status).toBe('Resolved');
  });

  it('imports CSV Inferno results and rejects malformed JSON/CSV safely', () => {
    const csv = [
      'test_id,title,group,result,message',
      'ecr-01,eICR Bundle Composition present,eCR,pass,',
      'ecr-02,Bearer token required,Auth,fail,401 unauthorized token mismatch',
    ].join('\n');

    const { run, createdTriageCount } = conformanceService.importInfernoResults(
      ctx.tenantId,
      csv,
      'CSV',
    );
    expect(run.passCount).toBe(1);
    expect(run.failCount).toBe(1);
    expect(createdTriageCount).toBe(1);
    expect(conformanceService.getState(ctx.tenantId).triageItems[0].causeCategory).toBe('auth');

    expect(() =>
      conformanceService.importInfernoResults(ctx.tenantId, '{not-valid-json', 'JSON'),
    ).toThrow(/Invalid JSON/i);
  });

  it('generates printable Markdown conformance report combining probes, Inferno runs, and triage items', async () => {
    await conformanceService.runBuiltInChecks(ctx);
    conformanceService.importInfernoResults(ctx.tenantId, SAMPLE_INFERNO_JSON, 'Sample');
    const md = conformanceService.generateConformanceReportMarkdown(ctx.tenantId);

    expect(md).toContain('# FHIR Conformance & Inferno Report');
    expect(md).toContain('FHIR Version 4.0.1 Declared');
    expect(md).toContain('Open Triage Items');
  });
});
