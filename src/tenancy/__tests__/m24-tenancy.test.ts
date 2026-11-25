import { beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../events';
import { mockFhirClient } from '../../fhir';
import { settingsService } from '../../services';
import {
  buildDefaultTenantDraft,
  tenantService,
} from '../tenantService';

describe('M24 Tenant Configuration & Onboarding', () => {
  const platformAdmin = { name: 'Alex Morgan', role: 'PlatformAdmin' as const };
  const tenantAdmin = { name: 'Jordan Patel', role: 'TenantAdmin' as const };

  beforeEach(() => {
    settingsService.reset();
    tenantService.resetForTests();
    mockFhirClient.clearTenantStore('tenant-state-medicaid');
    mockFhirClient.clearTenantStore('tenant-health-center-net');
    mockFhirClient.clearTenantStore('tenant-ohio-medicaid-pilot');
    mockFhirClient.clearTenantStore('tenant-failed-rollback');
    eventBus.clearHistory();
  });

  it('resolves layered configuration across PLATFORM -> PROGRAM -> TENANT -> ENVIRONMENT', async () => {
    const tenantId = 'tenant-state-medicaid';
    const baseEntries = tenantService.resolveEffectiveConfig(tenantId, 'dev');
    const slaBase = baseEntries.find((e) => e.definition.key === 'enrollment.slaDays');
    expect(slaBase).toBeDefined();
    expect(slaBase?.sourceLayer).toBe('TENANT');

    // Override at ENVIRONMENT level and verify ENVIRONMENT wins
    await tenantService.updateConfigSetting(
      tenantId,
      'enrollment.slaDays',
      21,
      'ENVIRONMENT',
      platformAdmin,
      'staging',
    );

    const stagingEntries = tenantService.resolveEffectiveConfig(tenantId, 'staging');
    const slaStaging = stagingEntries.find((e) => e.definition.key === 'enrollment.slaDays');
    expect(slaStaging?.effectiveValue).toBe(21);
    expect(slaStaging?.sourceLayer).toBe('ENVIRONMENT');

    // Dev environment still reads TENANT layer
    const devEntries = tenantService.resolveEffectiveConfig(tenantId, 'dev');
    const slaDev = devEntries.find((e) => e.definition.key === 'enrollment.slaDays');
    expect(slaDev?.sourceLayer).toBe('TENANT');
    expect(slaDev?.effectiveValue).not.toBe(21);
  });

  it('enforces strict tenant isolation for non-PlatformAdmin roles', () => {
    expect(() =>
      tenantService.assertTenantAccess(
        'tenant-state-medicaid',
        'tenant-health-center-net',
        'TenantAdmin',
      ),
    ).toThrow(/Cross-tenant access denied/i);

    expect(() =>
      tenantService.assertTenantAccess(
        'tenant-state-medicaid',
        'tenant-health-center-net',
        'PlatformAdmin',
      ),
    ).not.toThrow();

    expect(() =>
      tenantService.assertTenantAccess(
        'tenant-state-medicaid',
        'tenant-state-medicaid',
        'EnrollmentAnalyst',
      ),
    ).not.toThrow();
  });

  it('validates onboarding wizard drafts for slug format, duplicates, and bounds', () => {
    const invalidDraft = buildDefaultTenantDraft('Medicaid FFS', {
      legalName: '',
      code: 'Invalid Slug!',
      businessRules: {
        ...buildDefaultTenantDraft('Medicaid FFS').businessRules,
        slaDays: 2,
      },
    });
    const res = tenantService.validateWizardDraft(invalidDraft);
    expect(res.valid).toBe(false);
    expect(res.errors.legalName).toBeDefined();
    expect(res.errors.code).toBeDefined();
    expect(res.errors.slaDays).toBeDefined();

    const dupDraft = buildDefaultTenantDraft('Medicaid FFS', {
      legalName: 'Duplicate Agency',
      code: 'state-medicaid-a',
    });
    const dupRes = tenantService.validateWizardDraft(dupDraft);
    expect(dupRes.valid).toBe(false);
    expect(dupRes.errors.code).toMatch(/already exists/i);
  });

  it('provisions a new tenant end-to-end and publishes TenantProvisioned event', async () => {
    const draft = buildDefaultTenantDraft('Medicaid FFS', {
      legalName: 'Ohio Medicaid Pilot Program',
      code: 'ohio-medicaid-pilot',
    });

    const dryRun = tenantService.buildDryRun(draft);
    expect(dryRun.tenantCode).toBe('ohio-medicaid-pilot');
    expect(dryRun.defaultRolesCount).toBe(11);

    const { tenant, steps } = await tenantService.provisionTenant(draft, platformAdmin);
    expect(tenant.status).toBe('Active');
    expect(steps.every((s) => s.status === 'Completed')).toBe(true);
    expect(tenantService.getTenantByCode('ohio-medicaid-pilot')).toBeDefined();
    expect(mockFhirClient.hasTenantStore(tenant.id)).toBe(true);

    const events = eventBus.getHistory(tenant.id);
    expect(events.some((e) => e.type === 'TenantProvisioned')).toBe(true);
  });

  it('rolls back partial tenant provisioning cleanly when a step fails', async () => {
    const draft = buildDefaultTenantDraft('Medicaid FFS', {
      legalName: 'Rollback Test Agency',
      code: 'failed-rollback',
    });

    await expect(
      tenantService.provisionTenant(draft, platformAdmin, {
        simulateFailureAtStep: 2,
      }),
    ).rejects.toThrow(/rolled back/i);

    expect(tenantService.getTenantByCode('failed-rollback')).toBeUndefined();
    expect(mockFhirClient.hasTenantStore('tenant-failed-rollback')).toBe(false);
  });

  it('requires approval for sensitive config changes by TenantAdmin and supports rollback', async () => {
    const tenantId = 'tenant-state-medicaid';
    const pending = await tenantService.updateConfigSetting(
      tenantId,
      'enrollment.applicationFeeUsd',
      850,
      'TENANT',
      tenantAdmin,
    );
    expect(pending.status).toBe('PendingApproval');

    const approved = await tenantService.approvePendingConfig(
      tenantId,
      pending.version,
      platformAdmin,
    );
    expect(approved.status).toBe('Applied');

    const afterApprove = tenantService
      .resolveEffectiveConfig(tenantId)
      .find((e) => e.definition.key === 'enrollment.applicationFeeUsd');
    expect(afterApprove?.effectiveValue).toBe(850);

    await tenantService.rollbackConfigVersion(tenantId, pending.version, platformAdmin);
    const afterRollback = tenantService
      .resolveEffectiveConfig(tenantId)
      .find((e) => e.definition.key === 'enrollment.applicationFeeUsd');
    expect(afterRollback?.effectiveValue).toBe(pending.previousValue);
  });

  it('exports config without raw secrets and validates/strips secrets on JSON import', () => {
    const exported = tenantService.exportConfigJson('tenant-state-medicaid');
    expect(exported).toContain('vaultSecretRef');
    expect(exported).not.toContain('Bearer ');

    const importWithSecrets = JSON.stringify({
      clientSecret: 'SHOULD_BE_STRIPPED',
      configOverrides: {
        'enrollment.slaDays': 25,
      },
    });
    const report = tenantService.validateConfigImportJson(importWithSecrets);
    expect(report.valid).toBe(true);
    expect(report.strippedSecrets).toContain('clientSecret');
    expect(report.keysToUpdate).toContain('enrollment.slaDays');

    const invalidImport = JSON.stringify({
      configOverrides: {
        'enrollment.slaDays': 999,
      },
    });
    const invalidReport = tenantService.validateConfigImportJson(invalidImport);
    expect(invalidReport.valid).toBe(false);
    expect(invalidReport.errors.length).toBeGreaterThan(0);
  });

  it('blocks offboarding deletion when legal hold is active and allows it after release', async () => {
    const tenantId = 'tenant-health-center-net';
    tenantService.toggleLegalHold(tenantId, true);

    await expect(
      tenantService.scheduleOffboardingDeletion(
        tenantId,
        '2027-01-31',
        platformAdmin,
      ),
    ).rejects.toThrow(/legal hold/i);

    tenantService.toggleLegalHold(tenantId, false);
    const offboarded = await tenantService.scheduleOffboardingDeletion(
      tenantId,
      '2027-01-31',
      platformAdmin,
    );
    expect(offboarded.status).toBe('Offboarded');
    expect(offboarded.scheduledDeletionAt).toBe('2027-01-31');
  });
});
