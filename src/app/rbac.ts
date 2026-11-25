import type { PermissionAction, RoleName } from '../types';
import { MODULE_REGISTRY } from './moduleRegistry';

export const ALL_ROLES: readonly RoleName[] = [
  'PlatformAdmin',
  'TenantAdmin',
  'ProviderUser',
  'EnrollmentAnalyst',
  'ScreeningAnalyst',
  'CredentialingSpecialist',
  'ProgramIntegrityOfficer',
  'AgencyApprover',
  'PlanManager',
  'IntegrationEngineer',
  'Auditor',
] as const;

export const ALL_ACTIONS: readonly PermissionAction[] = [
  'view',
  'create',
  'edit',
  'approve',
  'delete',
  'export',
] as const;

export type ModulePermissions = Record<PermissionAction, boolean>;
export type RolePermissionMap = Record<string, ModulePermissions>;
export type PermissionMatrix = Record<RoleName, RolePermissionMap>;

export const ROLE_UNMASK_PERMISSION: Record<RoleName, boolean> = {
  PlatformAdmin: true,
  TenantAdmin: true,
  ProviderUser: false,
  EnrollmentAnalyst: true,
  ScreeningAnalyst: true,
  CredentialingSpecialist: true,
  ProgramIntegrityOfficer: true,
  AgencyApprover: true,
  PlanManager: false,
  IntegrationEngineer: false,
  Auditor: true,
};

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  PlatformAdmin: 'Full cross-tenant administration, tenant switching, and platform governance.',
  TenantAdmin: 'Tenant configuration, user role management, and full tenant operations.',
  ProviderUser: 'Provider self-service enrollment, directory updates, and document uploads.',
  EnrollmentAnalyst: 'Reviews applications, runs validations, and manages provider directory.',
  ScreeningAnalyst: 'Executes risk-based screening, site visits, and background checks.',
  CredentialingSpecialist: 'Manages primary source verification, committee review, and contracts.',
  ProgramIntegrityOfficer: 'Monitors exclusions, adverse actions, suspensions, and investigations.',
  AgencyApprover: 'Two-person sign-off authority for denials, high-risk approvals, and sensitive configs.',
  PlanManager: 'Manages insurance plans, benefits, networks, adequacy, and fee schedules.',
  IntegrationEngineer: 'Operates FHIR Explorer, eCR, UDS+, Inferno conformance, and .NET gateway.',
  Auditor: 'Read-only compliance, audit log review, exports, and security oversight.',
};

function none(): ModulePermissions {
  return {
    view: false,
    create: false,
    edit: false,
    approve: false,
    delete: false,
    export: false,
  };
}

function all(): ModulePermissions {
  return {
    view: true,
    create: true,
    edit: true,
    approve: true,
    delete: true,
    export: true,
  };
}

function viewOnly(allowExport = false): ModulePermissions {
  return {
    view: true,
    create: false,
    edit: false,
    approve: false,
    delete: false,
    export: allowExport,
  };
}

function editor(opts?: { approve?: boolean; delete?: boolean; export?: boolean }): ModulePermissions {
  return {
    view: true,
    create: true,
    edit: true,
    approve: Boolean(opts?.approve),
    delete: Boolean(opts?.delete),
    export: opts?.export ?? true,
  };
}

const ALL_MODULE_IDS = ['p0-foundation', ...MODULE_REGISTRY.map((m) => m.id)];

function buildMatrixForRole(
  role: RoleName,
  overrides: Record<string, ModulePermissions>,
  defaultPerms: ModulePermissions,
): RolePermissionMap {
  const map: RolePermissionMap = {};
  for (const id of ALL_MODULE_IDS) {
    map[id] = overrides[id] ?? { ...defaultPerms };
  }
  // Always allow viewing Build Status
  map['p0-foundation'] = {
    ...map['p0-foundation'],
    view: true,
    export: role === 'PlatformAdmin' || role === 'TenantAdmin' || role === 'Auditor',
  };
  return map;
}

export const PERMISSION_MATRIX: PermissionMatrix = {
  PlatformAdmin: buildMatrixForRole('PlatformAdmin', {}, all()),

  TenantAdmin: buildMatrixForRole(
    'TenantAdmin',
    {
      'm24-tenants': editor({ approve: true, delete: false, export: true }),
      'm1-shell': all(),
      'm2-fhir': editor({ delete: true }),
      'm3-directory': all(),
      'm22-provider-ops': all(),
      'm23-plans': all(),
      'm4-patients': all(),
      'm17-security': all(),
    },
    editor({ approve: true, export: true }),
  ),

  ProviderUser: buildMatrixForRole(
    'ProviderUser',
    {
      'm1-shell': viewOnly(false),
      'm3-directory': viewOnly(false),
      'm22-provider-ops': {
        view: true,
        create: true,
        edit: false,
        approve: false,
        delete: false,
        export: false,
      },
      'm23-plans': viewOnly(false),
      'm5-enrollment': editor({ export: false }),
      'm8-determination': viewOnly(false),
      'm10-mmis-edi': viewOnly(false),
      'm11-claims': editor({ export: false }),
      'm18-notifications': viewOnly(false),
    },
    none(),
  ),

  EnrollmentAnalyst: buildMatrixForRole(
    'EnrollmentAnalyst',
    {
      'm1-shell': viewOnly(true),
      'm2-fhir': viewOnly(true),
      'm3-directory': editor({ export: true }),
      'm22-provider-ops': editor({ approve: true, export: true }),
      'm23-plans': viewOnly(true),
      'm4-patients': viewOnly(false),
      'm5-enrollment': editor({ export: true }),
      'm6-validation': editor({ approve: true, export: true }),
      'm7-screening': viewOnly(true),
      'm8-determination': editor({ approve: false, export: true }),
      'm10-mmis-edi': viewOnly(true),
      'm12-monitoring': viewOnly(true),
      'm18-notifications': editor({ export: false }),
      'm19-analytics': viewOnly(true),
    },
    none(),
  ),

  ScreeningAnalyst: buildMatrixForRole(
    'ScreeningAnalyst',
    {
      'm1-shell': viewOnly(false),
      'm3-directory': viewOnly(true),
      'm22-provider-ops': viewOnly(false),
      'm5-enrollment': viewOnly(false),
      'm6-validation': editor({ export: true }),
      'm7-screening': editor({ approve: true, export: true }),
      'm8-determination': viewOnly(false),
      'm12-monitoring': editor({ export: true }),
      'm18-notifications': viewOnly(false),
      'm19-analytics': viewOnly(true),
    },
    none(),
  ),

  CredentialingSpecialist: buildMatrixForRole(
    'CredentialingSpecialist',
    {
      'm1-shell': viewOnly(false),
      'm3-directory': editor({ export: true }),
      'm22-provider-ops': editor({ export: true }),
      'm23-plans': viewOnly(true),
      'm5-enrollment': viewOnly(false),
      'm8-determination': viewOnly(false),
      'm9-credentialing': editor({ approve: true, export: true }),
      'm12-monitoring': viewOnly(true),
      'm18-notifications': viewOnly(false),
    },
    none(),
  ),

  ProgramIntegrityOfficer: buildMatrixForRole(
    'ProgramIntegrityOfficer',
    {
      'm1-shell': viewOnly(true),
      'm3-directory': editor({ approve: true, export: true }),
      'm22-provider-ops': editor({ approve: true, export: true }),
      'm6-validation': editor({ approve: true, export: true }),
      'm7-screening': editor({ approve: true, export: true }),
      'm8-determination': editor({ approve: true, export: true }),
      'm11-claims': viewOnly(true),
      'm12-monitoring': all(),
      'm17-security': viewOnly(true),
      'm19-analytics': viewOnly(true),
    },
    none(),
  ),

  AgencyApprover: buildMatrixForRole(
    'AgencyApprover',
    {
      'm24-tenants': {
        view: true,
        create: false,
        edit: false,
        approve: true,
        delete: false,
        export: true,
      },
      'm1-shell': viewOnly(true),
      'm3-directory': viewOnly(true),
      'm22-provider-ops': {
        view: true,
        create: false,
        edit: false,
        approve: true,
        delete: false,
        export: true,
      },
      'm23-plans': {
        view: true,
        create: false,
        edit: false,
        approve: true,
        delete: false,
        export: true,
      },
      'm7-screening': {
        view: true,
        create: false,
        edit: false,
        approve: true,
        delete: false,
        export: true,
      },
      'm8-determination': editor({ approve: true, export: true }),
      'm9-credentialing': {
        view: true,
        create: false,
        edit: false,
        approve: true,
        delete: false,
        export: true,
      },
      'm12-monitoring': {
        view: true,
        create: false,
        edit: false,
        approve: true,
        delete: false,
        export: true,
      },
      'm19-analytics': viewOnly(true),
    },
    none(),
  ),

  PlanManager: buildMatrixForRole(
    'PlanManager',
    {
      'm1-shell': viewOnly(false),
      'm3-directory': viewOnly(true),
      'm22-provider-ops': editor({ approve: true, export: true }),
      'm23-plans': all(),
      'm9-credentialing': viewOnly(true),
      'm11-claims': editor({ export: true }),
      'm18-notifications': viewOnly(false),
      'm19-analytics': viewOnly(true),
    },
    none(),
  ),

  IntegrationEngineer: buildMatrixForRole(
    'IntegrationEngineer',
    {
      'm24-tenants': viewOnly(true),
      'm1-shell': editor({ export: true }),
      'm2-fhir': all(),
      'm3-directory': viewOnly(true),
      'm23-plans': viewOnly(true),
      'm4-patients': editor({ export: true }),
      'm10-mmis-edi': all(),
      'm13-ecr': all(),
      'm14-uds': all(),
      'm15-conformance': all(),
      'm16-gateway': all(),
      'm19-analytics': viewOnly(true),
      'm20-diagnostics': all(),
      'm21-docs': editor({ export: true }),
    },
    none(),
  ),

  Auditor: buildMatrixForRole('Auditor', {}, viewOnly(true)),
};

export function hasPermission(
  role: RoleName,
  moduleId: string,
  action: PermissionAction,
  tenantOverrides?: Partial<Record<RoleName, Record<string, Partial<ModulePermissions>>>>,
): boolean {
  const override = tenantOverrides?.[role]?.[moduleId]?.[action];
  if (typeof override === 'boolean') {
    return override;
  }
  return Boolean(PERMISSION_MATRIX[role]?.[moduleId]?.[action]);
}

export function canRoleUnmask(role: RoleName): boolean {
  return Boolean(ROLE_UNMASK_PERMISSION[role]);
}
