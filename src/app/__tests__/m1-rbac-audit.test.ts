import { beforeEach, describe, expect, it } from 'vitest';
import { mockFhirClient } from '../../fhir';
import { maskSensitiveValue } from '../../rules';
import { auditService, settingsService } from '../../services';
import {
  ALL_ROLES,
  PERMISSION_MATRIX,
  canRoleUnmask,
  hasPermission,
} from '../rbac';

describe('M1 RBAC Permission Matrix, PII Masking & FHIR AuditEvent Log', () => {
  const ctxA = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const ctxB = { tenantId: 'tenant-health-center-net', tenantCode: 'fqhc-network-b' };

  beforeEach(() => {
    settingsService.reset();
    mockFhirClient.clearTenantStore(ctxA.tenantId);
    mockFhirClient.clearTenantStore(ctxB.tenantId);
  });

  it('defines permissions for all 11 platform roles in a single matrix', () => {
    expect(ALL_ROLES).toHaveLength(11);
    for (const role of ALL_ROLES) {
      expect(PERMISSION_MATRIX[role]).toBeDefined();
    }

    expect(hasPermission('PlatformAdmin', 'm24-tenants', 'delete')).toBe(true);
    expect(hasPermission('ProviderUser', 'm24-tenants', 'view')).toBe(false);
    expect(hasPermission('Auditor', 'm1-shell', 'view')).toBe(true);
    expect(hasPermission('Auditor', 'm3-directory', 'edit')).toBe(false);
    expect(hasPermission('AgencyApprover', 'm8-determination', 'approve')).toBe(true);
    expect(hasPermission('IntegrationEngineer', 'm2-fhir', 'create')).toBe(true);
  });

  it('applies tenant-specific role overrides without mutating global matrix', () => {
    expect(hasPermission('ProviderUser', 'm23-plans', 'edit')).toBe(false);
    const overridden = hasPermission('ProviderUser', 'm23-plans', 'edit', {
      ProviderUser: {
        'm23-plans': { edit: true },
      },
    });
    expect(overridden).toBe(true);
    expect(hasPermission('ProviderUser', 'm23-plans', 'edit')).toBe(false);
  });

  it('masks sensitive SSN, TIN, DOB, and bank account values and enforces unmask permissions', () => {
    expect(maskSensitiveValue('123-45-6789', 'ssn')).toBe('***-**-6789');
    expect(maskSensitiveValue('12-3456789', 'tin')).toBe('**-***6789');
    expect(maskSensitiveValue('1984-05-12', 'dob')).toBe('1984-**-**');
    expect(maskSensitiveValue('000192837465', 'bank')).toBe('•••• •••• 7465');

    expect(canRoleUnmask('PlatformAdmin')).toBe(true);
    expect(canRoleUnmask('ProgramIntegrityOfficer')).toBe(true);
    expect(canRoleUnmask('ProviderUser')).toBe(false);
    expect(canRoleUnmask('IntegrationEngineer')).toBe(false);
  });

  it('records tenant-scoped FHIR AuditEvent resources and filters by actor, action, and resourceType', async () => {
    await auditService.record({
      ctx: ctxA,
      actorName: 'Alex Morgan',
      actorRole: 'PlatformAdmin',
      action: 'unmask',
      resourceType: 'Practitioner',
      resourceId: 'prac-a-1',
      outcomeDesc: 'Unmasked TIN for verification',
    });

    await auditService.record({
      ctx: ctxA,
      actorName: 'Jamie Foster',
      actorRole: 'PlanManager',
      action: 'export',
      resourceType: 'Bundle',
      outcomeDesc: 'Exported directory bundle',
    });

    await auditService.record({
      ctx: ctxB,
      actorName: 'Jordan Patel',
      actorRole: 'TenantAdmin',
      action: 'create',
      resourceType: 'Patient',
      resourceId: 'pat-b-1',
    });

    const tenantAEvents = await auditService.list(ctxA);
    const tenantBEvents = await auditService.list(ctxB);
    expect(tenantAEvents).toHaveLength(2);
    expect(tenantBEvents).toHaveLength(1);

    const unmaskOnly = await auditService.list(ctxA, { action: 'unmask' });
    expect(unmaskOnly).toHaveLength(1);
    expect(unmaskOnly[0].type?.code).toBe('110110');

    const byActor = await auditService.list(ctxA, { actor: 'Jamie' });
    expect(byActor).toHaveLength(1);
    expect(byActor[0].entity?.[0]?.type?.code).toBe('Bundle');
  });
});
