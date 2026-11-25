import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '../../../events';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { enrollmentService } from '../../m5-enrollment/enrollmentService';
import { VALIDATORS, validationService } from '../validationService';

describe('M6 Automated Validation Engine', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const actor = { name: 'Taylor Brooks', role: 'EnrollmentAnalyst' as const };

  beforeEach(async () => {
    settingsService.reset();
    enrollmentService.resetForTests();
    validationService.resetForTests();
    eventBus.clearHistory();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('executes all 9 validators in parallel, transitions clean case to In Screening, and emits ValidationCompleted', async () => {
    expect(VALIDATORS).toHaveLength(9);
    const app = enrollmentService.listApplications(ctx.tenantId)[0];

    const report = await validationService.runValidationSuite(ctx, app.id, actor);
    expect(report.results).toHaveLength(9);
    expect(report.overallStatus).toBe('Pass');

    const refreshed = enrollmentService.getApplicationById(ctx.tenantId, app.id);
    expect(refreshed?.status).toBe('In Screening');
    expect(
      eventBus.getHistory(ctx.tenantId).some((e) => e.type === 'ValidationCompleted'),
    ).toBe(true);
  });

  it('detects SAM/OIG-LEIE exclusion match, creates FHIR DetectedIssue, and supports audited Provenance override', async () => {
    const app = enrollmentService.listApplications(ctx.tenantId)[0];
    validationService.addExclusionEntry(ctx.tenantId, {
      name: `${app.applicantGiven} ${app.applicantFamily}`,
      npi: app.npi,
      source: 'OIG-LEIE',
      exclusionType: '1128(a)(1) Program Fraud',
      effectiveDate: '2026-01-15',
    });

    const report = await validationService.runValidationSuite(ctx, app.id, actor);
    expect(report.overallStatus).toBe('Fail');
    const excl = report.results.find((r) => r.validatorId === 'exclusion');
    expect(excl?.status).toBe('Fail');
    expect(excl?.detectedIssueId).toBeTruthy();

    // Override requires reason
    await expect(
      validationService.overrideValidationFinding(ctx, app.id, 'exclusion', '', actor),
    ).rejects.toThrow(/mandatory/);

    const overridden = await validationService.overrideValidationFinding(
      ctx,
      app.id,
      'exclusion',
      'Confirmed false-positive name match after SSN/NPI cross-verification.',
      actor,
    );
    expect(overridden.overridden?.provenanceId).toBeTruthy();
    expect(enrollmentService.getApplicationById(ctx.tenantId, app.id)?.status).toBe('In Screening');
  });

  it('generates an RFI Communication from validation failures and transitions case to RFI Issued', async () => {
    const app = enrollmentService.listApplications(ctx.tenantId)[0];
    app.tin = 'INVALID-TIN';

    await validationService.runValidationSuite(ctx, app.id, actor);
    const comm = await validationService.createRfiFromFailures(ctx, app.id, '2026-04-30', actor);
    expect(comm.resourceType).toBe('Communication');
    expect(enrollmentService.getApplicationById(ctx.tenantId, app.id)?.status).toBe('RFI Issued');
  });

  it('falls back cleanly to Mock validator with warning when Gateway mode is unreachable', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const app = enrollmentService.listApplications(ctx.tenantId)[0];
    validationService.updateRule(ctx.tenantId, 'npi', { mode: 'Gateway' });

    const report = await validationService.runValidationSuite(ctx, app.id, actor);
    const npiRes = report.results.find((r) => r.validatorId === 'npi');
    expect(npiRes?.status).toBe('Pass');
    expect(npiRes?.sourceMode).toBe('Mock');
    expect(npiRes?.fallbackWarning).toMatch(/fell back to Mock/i);

    fetchSpy.mockRestore();
  });
});
