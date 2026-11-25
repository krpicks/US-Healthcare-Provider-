import { eventBus } from '../events';
import { getFhirClient, mockFhirClient, type FhirRequestContext } from '../fhir';
import { seedTenantFhirData } from '../mock-data';
import { auditService } from '../services/auditService';
import {
  AppError,
  type FhirBundle,
  type FhirProvenance,
  type RoleName,
} from '../types';
import type { ModulePermissions } from '../app/rbac';
import {
  DEFAULT_SEED_TENANTS,
  type TenantStatus,
  type TenantSummary,
  type TenantType,
} from './tenantContext';

export type ProgramTemplate =
  | 'Medicaid FFS'
  | 'Managed Care'
  | 'Health Center UDS+';

export type ConfigScope = 'PLATFORM' | 'PROGRAM' | 'TENANT' | 'ENVIRONMENT';

export type EnvironmentName = 'local' | 'dev' | 'test' | 'staging' | 'production';

export interface TenantContact {
  name: string;
  role: string;
  email: string;
  phone: string;
}

export interface TenantBranding {
  logoText: string;
  primaryColor: string;
  supportEmail: string;
  supportPhone: string;
  templateHeader: string;
  templateFooter: string;
}

export interface TenantEndpoints {
  fhirBase: string;
  authMode: 'none' | 'bearer' | 'smart-oauth2';
  gatewayUrl: string;
  ecrNowUrl: string;
  mmisUrl: string;
  clearinghouseUrl: string;
  publicHealthUrl: string;
  vaultSecretRef: string;
}

export interface TenantIdentityConfig {
  oidcIssuer: string;
  clientId: string;
  redirectUris: string[];
  groupToRoleMapping: Array<{ group: string; role: RoleName }>;
}

export interface TenantBusinessRules {
  providerTypes: string[];
  applicationTypes: string[];
  requiredDocuments: Record<string, string[]>;
  riskRules: Array<{
    providerType: string;
    riskLevel: 'Limited' | 'Moderate' | 'High';
  }>;
  slaDays: number;
  revalidationMonths: number;
  recredentialingMonths: number;
  applicationFeeUsd: number;
  feeWaivedTypes: string[];
  autoApproveSelfServiceFields: string[];
}

export interface TenantValidatorConfig {
  id: string;
  name: string;
  enabled: boolean;
  mode: 'Mock' | 'Gateway';
}

export interface TenantFeatureFlag {
  key: string;
  label: string;
  environment: EnvironmentName;
  enabled: boolean;
  rolloutPercentage: number;
  scheduledEnableAt?: string;
}

export interface TenantCodeSets {
  taxonomies: Array<{ code: string; display: string }>;
  specialties: string[];
  triggerCodes: Array<{ system: string; code: string; display: string }>;
  udsElements: string[];
}

export interface TenantNotificationTemplate {
  eventType: string;
  channel: 'InApp' | 'Email' | 'Portal';
  subject: string;
  enabled: boolean;
}

export interface ConfigSettingDefinition {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  defaultValue: string | number | boolean | string[];
  scope: ConfigScope;
  description: string;
  sensitive: boolean;
  min?: number;
  max?: number;
  allowedValues?: string[];
}

export interface ConfigChangeVersion {
  version: number;
  timestamp: string;
  actor: string;
  key: string;
  scope: ConfigScope;
  environment?: EnvironmentName;
  previousValue: unknown;
  newValue: unknown;
  status: 'Applied' | 'PendingApproval' | 'Rejected' | 'RolledBack';
  approvedBy?: string;
}

export interface EffectiveConfigEntry {
  definition: ConfigSettingDefinition;
  effectiveValue: unknown;
  sourceLayer: ConfigScope;
  pendingApproval?: ConfigChangeVersion;
}

export interface ProvisioningStepLog {
  step: string;
  status: 'Pending' | 'Completed' | 'Failed';
  timestamp: string;
  message: string;
}

export interface TenantRecord extends TenantSummary {
  programTemplate: ProgramTemplate;
  contacts: TenantContact[];
  branding: TenantBranding;
  endpoints: TenantEndpoints;
  identity: TenantIdentityConfig;
  roleOverrides: Partial<Record<RoleName, Record<string, Partial<ModulePermissions>>>>;
  businessRules: TenantBusinessRules;
  validators: TenantValidatorConfig[];
  codeSets: TenantCodeSets;
  notificationTemplates: TenantNotificationTemplate[];
  featureFlags: TenantFeatureFlag[];
  legalHold: boolean;
  scheduledDeletionAt?: string;
  configOverrides: Record<string, unknown>;
  envOverrides: Partial<Record<EnvironmentName, Record<string, unknown>>>;
  configHistory: ConfigChangeVersion[];
  provisioningLog: ProvisioningStepLog[];
  createdAt: string;
  updatedAt: string;
}

export interface DryRunReport {
  tenantCode: string;
  fhirPartition: string;
  resourcesToSeed: string[];
  adminUser: string;
  defaultRolesCount: number;
  featureFlagsCount: number;
  warnings: string[];
}

export interface ConfigImportValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  keysToUpdate: string[];
  strippedSecrets: string[];
}

export const CONFIG_SETTING_DEFINITIONS: ConfigSettingDefinition[] = [
  {
    key: 'enrollment.slaDays',
    type: 'number',
    defaultValue: 30,
    scope: 'TENANT',
    description: 'Target determination turnaround SLA in calendar days.',
    sensitive: false,
    min: 5,
    max: 180,
  },
  {
    key: 'enrollment.revalidationMonths',
    type: 'number',
    defaultValue: 60,
    scope: 'PROGRAM',
    description: 'Mandatory provider revalidation interval in months.',
    sensitive: false,
    min: 12,
    max: 120,
  },
  {
    key: 'credentialing.recredentialingMonths',
    type: 'number',
    defaultValue: 36,
    scope: 'PROGRAM',
    description: 'NCQA / state recredentialing cycle length in months.',
    sensitive: false,
    min: 12,
    max: 60,
  },
  {
    key: 'enrollment.applicationFeeUsd',
    type: 'number',
    defaultValue: 709,
    scope: 'PROGRAM',
    description: 'CMS institutional provider application fee (USD).',
    sensitive: true,
    min: 0,
    max: 5000,
  },
  {
    key: 'security.requireTwoPersonDenial',
    type: 'boolean',
    defaultValue: true,
    scope: 'PLATFORM',
    description: 'Require AgencyApprover sign-off for denials and high-risk approvals.',
    sensitive: true,
  },
  {
    key: 'directory.staleDaysThreshold',
    type: 'number',
    defaultValue: 90,
    scope: 'TENANT',
    description: 'Days before an unverified provider record is flagged as stale.',
    sensitive: false,
    min: 30,
    max: 365,
  },
  {
    key: 'fhir.partitionStrategy',
    type: 'string',
    defaultValue: 'path',
    scope: 'ENVIRONMENT',
    description: 'Tenant partition strategy for Live FHIR requests (path or header).',
    sensitive: true,
    allowedValues: ['path', 'header'],
  },
  {
    key: 'ecr.autoTriggerEnabled',
    type: 'boolean',
    defaultValue: true,
    scope: 'TENANT',
    description: 'Automatically evaluate eCR trigger codes on new Condition/Observation writes.',
    sensitive: false,
  },
];

const PROGRAM_LAYER_DEFAULTS: Record<ProgramTemplate, Record<string, unknown>> = {
  'Medicaid FFS': {
    'enrollment.revalidationMonths': 60,
    'credentialing.recredentialingMonths': 36,
    'enrollment.applicationFeeUsd': 709,
    'enrollment.slaDays': 30,
  },
  'Managed Care': {
    'enrollment.revalidationMonths': 36,
    'credentialing.recredentialingMonths': 36,
    'enrollment.applicationFeeUsd': 0,
    'enrollment.slaDays': 21,
  },
  'Health Center UDS+': {
    'enrollment.revalidationMonths': 60,
    'credentialing.recredentialingMonths': 24,
    'enrollment.applicationFeeUsd': 0,
    'enrollment.slaDays': 15,
  },
};

export function buildDefaultTenantDraft(
  program: ProgramTemplate = 'Medicaid FFS',
  overrides?: Partial<TenantRecord>,
): Omit<TenantRecord, 'id' | 'createdAt' | 'updatedAt'> {
  const isFqhc = program === 'Health Center UDS+';
  const isMco = program === 'Managed Care';

  return {
    code: overrides?.code ?? '',
    legalName: overrides?.legalName ?? '',
    type:
      overrides?.type ??
      (isFqhc
        ? 'Health center'
        : isMco
          ? 'Health plan'
          : 'State Medicaid agency'),
    status: overrides?.status ?? 'Draft',
    timezone: overrides?.timezone ?? 'America/New_York',
    locale: overrides?.locale ?? 'en-US',
    dataRegion: overrides?.dataRegion ?? 'us-east-1',
    programTemplate: program,
    contacts: overrides?.contacts ?? [
      {
        name: 'Jordan Patel',
        role: 'Tenant Administrator',
        email: 'admin@synthetic-tenant.example',
        phone: '555-010-2000',
      },
    ],
    branding: overrides?.branding ?? {
      logoText: 'ProviderLink',
      primaryColor: '#0f766e',
      supportEmail: 'support@synthetic-tenant.example',
      supportPhone: '800-555-0199',
      templateHeader: 'Official Synthetic Medicaid Provider Notice',
      templateFooter: 'Prototype - synthetic data only. Do not submit live PHI.',
    },
    endpoints: overrides?.endpoints ?? {
      fhirBase: 'http://localhost:8081/fhir',
      authMode: 'none',
      gatewayUrl: 'http://localhost:5000',
      ecrNowUrl: 'http://localhost:8080',
      mmisUrl: 'http://localhost:5000/api/v1/mmis',
      clearinghouseUrl: 'http://localhost:5000/api/v1/edi',
      publicHealthUrl: 'http://localhost:8080/api/pha',
      vaultSecretRef: 'vault://kv/providerlink/tenants/default-client-secret',
    },
    identity: overrides?.identity ?? {
      oidcIssuer: 'https://idp.synthetic.example/realms/providerlink',
      clientId: 'providerlink-web-spa',
      redirectUris: ['http://localhost:3000/auth/callback'],
      groupToRoleMapping: [
        { group: 'pl-tenant-admins', role: 'TenantAdmin' },
        { group: 'pl-enrollment-analysts', role: 'EnrollmentAnalyst' },
        { group: 'pl-approvers', role: 'AgencyApprover' },
      ],
    },
    roleOverrides: overrides?.roleOverrides ?? {},
    businessRules: overrides?.businessRules ?? {
      providerTypes: isFqhc
        ? ['FQHC Clinician', 'Physician Assistant', 'Nurse Practitioner', 'Behavioral Health Specialist']
        : [
            'Individual Physician',
            'Nurse Practitioner',
            'Behavioral Health Specialist',
            'Dental Provider',
            'Group Practice',
            'Hospital / Institutional',
          ],
      applicationTypes: [
        'New Enrollment',
        'Revalidation',
        'Update',
        'Change of Ownership',
        'Reinstatement',
      ],
      requiredDocuments: {
        'Individual Physician': ['State Medical License', 'Malpractice COI', 'W-9 Form', 'DEA Certificate'],
        'Nurse Practitioner': ['APRN License', 'Collaborative Agreement', 'W-9 Form'],
        'Behavioral Health Specialist': ['Clinical License', 'Malpractice COI', 'W-9 Form'],
        'Dental Provider': ['Dental License', 'Malpractice COI', 'W-9 Form'],
        'FQHC Clinician': ['State License', 'HRSA Scope Letter', 'W-9 Form'],
        'Physician Assistant': ['PA License', 'Supervision Agreement', 'W-9 Form'],
      },
      riskRules: [
        { providerType: 'Individual Physician', riskLevel: 'Limited' },
        { providerType: 'Nurse Practitioner', riskLevel: 'Limited' },
        { providerType: 'Behavioral Health Specialist', riskLevel: 'Moderate' },
        { providerType: 'Hospital / Institutional', riskLevel: 'High' },
        { providerType: 'FQHC Clinician', riskLevel: 'Limited' },
      ],
      slaDays: isFqhc ? 15 : isMco ? 21 : 30,
      revalidationMonths: isMco ? 36 : 60,
      recredentialingMonths: isFqhc ? 24 : 36,
      applicationFeeUsd: program === 'Medicaid FFS' ? 709 : 0,
      feeWaivedTypes: ['Individual Physician', 'Nurse Practitioner', 'FQHC Clinician'],
      autoApproveSelfServiceFields: ['phone', 'hours', 'acceptingNewPatients'],
    },
    validators: overrides?.validators ?? [
      { id: 'npi', name: 'NPI Luhn & NPPES Check', enabled: true, mode: 'Mock' },
      { id: 'license', name: 'State Licensing Board', enabled: true, mode: 'Mock' },
      { id: 'exclusion', name: 'SAM & OIG-LEIE Exclusion', enabled: true, mode: 'Mock' },
      { id: 'death-master', name: 'SSA Death Master File', enabled: true, mode: 'Mock' },
      { id: 'address', name: 'USPS Address Standardization', enabled: true, mode: 'Mock' },
      { id: 'duplicate', name: 'Duplicate Enrollment Detector', enabled: true, mode: 'Mock' },
      { id: 'tin', name: 'IRS TIN Match', enabled: true, mode: 'Mock' },
      { id: 'dea', name: 'DEA Registration Check', enabled: true, mode: 'Mock' },
      { id: 'taxonomy', name: 'NUCC Taxonomy Consistency', enabled: true, mode: 'Mock' },
    ],
    codeSets: overrides?.codeSets ?? {
      taxonomies: [
        { code: '207Q00000X', display: 'Family Medicine' },
        { code: '207R00000X', display: 'Internal Medicine' },
        { code: '208000000X', display: 'Pediatrics' },
        { code: '2084P0800X', display: 'Psychiatry' },
        { code: '1223G0001X', display: 'General Practice Dentistry' },
        { code: '363LF0000X', display: 'Family Nurse Practitioner' },
        { code: '363A00000X', display: 'Physician Assistant' },
        { code: '207V00000X', display: 'Obstetrics & Gynecology' },
      ],
      specialties: [
        'Family Medicine',
        'Internal Medicine',
        'Pediatrics',
        'Psychiatry',
        'General Practice Dentistry',
        'Family Nurse Practitioner',
        'Physician Assistant',
        'Obstetrics & Gynecology',
      ],
      triggerCodes: [
        { system: 'http://snomed.info/sct', code: '840539006', display: 'COVID-19' },
        { system: 'http://loinc.org', code: '94500-6', display: 'SARS-CoV-2 RNA PCR' },
        { system: 'http://snomed.info/sct', code: '240589008', display: 'Chlamydia trachomatis infection' },
        { system: 'http://loinc.org', code: '16128-1', display: 'Hepatitis C virus Ab' },
      ],
      udsElements: [
        'Patient Demographics (Race/Ethnicity)',
        'SDOH Screening',
        'Clinical Encounters',
        'Active Diagnoses',
        'Laboratory Results',
        'Vital Signs',
        'Immunizations',
      ],
    },
    notificationTemplates: overrides?.notificationTemplates ?? [
      { eventType: 'ProviderSubmitted', channel: 'Portal', subject: 'Application Received', enabled: true },
      { eventType: 'ProviderApproved', channel: 'Email', subject: 'Medicaid Enrollment Approved', enabled: true },
      { eventType: 'ProviderDenied', channel: 'Email', subject: 'Enrollment Determination & Appeal Rights', enabled: true },
      { eventType: 'ReportabilityResponseReceived', channel: 'InApp', subject: 'Public Health eCR RR Received', enabled: true },
    ],
    featureFlags: overrides?.featureFlags ?? [
      { key: 'ecr.realtimeTrigger', label: 'Real-time eCR Triggering', environment: 'dev', enabled: true, rolloutPercentage: 100 },
      { key: 'uds.autoDeidentify', label: 'UDS+ Automatic De-identification', environment: 'dev', enabled: true, rolloutPercentage: 100 },
      { key: 'claims.instantAdjudication', label: 'Instant Claims Simulation', environment: 'staging', enabled: true, rolloutPercentage: 50 },
      { key: 'gateway.liveValidators', label: 'External .NET Gateway Validators', environment: 'production', enabled: false, rolloutPercentage: 0, scheduledEnableAt: '2027-01-15T00:00:00Z' },
    ],
    legalHold: overrides?.legalHold ?? false,
    configOverrides: overrides?.configOverrides ?? {},
    envOverrides: overrides?.envOverrides ?? {},
    configHistory: overrides?.configHistory ?? [],
    provisioningLog: overrides?.provisioningLog ?? [],
  };
}

function createInitialTenants(): TenantRecord[] {
  const now = '2026-11-01T12:00:00.000Z';
  const tenantADraft = buildDefaultTenantDraft('Medicaid FFS', {
    ...DEFAULT_SEED_TENANTS[0],
    configOverrides: { 'enrollment.slaDays': 30, 'directory.staleDaysThreshold': 90 },
    provisioningLog: [
      { step: 'Create tenant FHIR partition', status: 'Completed', timestamp: now, message: 'Partition state-medicaid-a initialized.' },
      { step: 'Seed reference data', status: 'Completed', timestamp: now, message: '7 providers, 3 plans, Jane Doe sample bundle seeded.' },
      { step: 'Provision admin & RBAC defaults', status: 'Completed', timestamp: now, message: 'TenantAdmin and 11-role matrix initialized.' },
      { step: 'Write Provenance & AuditEvent', status: 'Completed', timestamp: now, message: 'Initial provisioning provenance recorded.' },
    ],
  });

  const tenantBDraft = buildDefaultTenantDraft('Health Center UDS+', {
    ...DEFAULT_SEED_TENANTS[1],
    branding: {
      logoText: 'Community Health FQHC',
      primaryColor: '#0369a1',
      supportEmail: 'helpdesk@fqhc-synthetic.example',
      supportPhone: '312-555-0190',
      templateHeader: 'Community Health Center Network — Provider Operations',
      templateFooter: 'Prototype - synthetic data only.',
    },
    configOverrides: { 'enrollment.slaDays': 15, 'directory.staleDaysThreshold': 60 },
    provisioningLog: [
      { step: 'Create tenant FHIR partition', status: 'Completed', timestamp: now, message: 'Partition fqhc-network-b initialized.' },
      { step: 'Seed reference data', status: 'Completed', timestamp: now, message: '3 FQHC providers, 3 plans, Jane Doe sample bundle seeded.' },
      { step: 'Provision admin & RBAC defaults', status: 'Completed', timestamp: now, message: 'TenantAdmin and 11-role matrix initialized.' },
      { step: 'Write Provenance & AuditEvent', status: 'Completed', timestamp: now, message: 'Initial provisioning provenance recorded.' },
    ],
  });

  return [
    { ...tenantADraft, id: DEFAULT_SEED_TENANTS[0].id, createdAt: now, updatedAt: now },
    { ...tenantBDraft, id: DEFAULT_SEED_TENANTS[1].id, createdAt: now, updatedAt: now },
  ];
}

class TenantService {
  private tenants = new Map<string, TenantRecord>();
  private listeners = new Set<() => void>();

  constructor() {
    for (const tenant of createInitialTenants()) {
      this.tenants.set(tenant.id, tenant);
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  public resetForTests(): void {
    this.tenants.clear();
    for (const tenant of createInitialTenants()) {
      this.tenants.set(tenant.id, tenant);
    }
    this.notify();
  }

  public listTenants(): TenantRecord[] {
    return Array.from(this.tenants.values());
  }

  public getTenantById(tenantId: string): TenantRecord | undefined {
    return this.tenants.get(tenantId);
  }

  public getTenantByCode(code: string): TenantRecord | undefined {
    return Array.from(this.tenants.values()).find((t) => t.code === code);
  }

  public assertTenantAccess(
    activeTenantId: string,
    targetTenantId: string,
    actorRole: RoleName,
  ): void {
    if (actorRole === 'PlatformAdmin') return;
    if (activeTenantId !== targetTenantId) {
      throw new AppError({
        message: `Cross-tenant access denied: tenant '${activeTenantId}' cannot access '${targetTenantId}'.`,
        statusCode: 403,
        code: 'TENANT_ISOLATION_VIOLATION',
      });
    }
  }

  public validateWizardDraft(
    draft: Omit<TenantRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): { valid: boolean; errors: Record<string, string> } {
    const errors: Record<string, string> = {};
    if (!draft.legalName.trim()) {
      errors.legalName = 'Legal name is required.';
    }
    if (!draft.code.trim()) {
      errors.code = 'Tenant code slug is required.';
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.code.trim())) {
      errors.code = 'Code must be lowercase letters, numbers, and hyphens only.';
    } else if (this.getTenantByCode(draft.code.trim())) {
      errors.code = `Tenant code '${draft.code.trim()}' already exists.`;
    }
    if (!draft.endpoints.fhirBase.trim()) {
      errors.fhirBase = 'FHIR Base URL is required.';
    }
    if (draft.businessRules.slaDays < 5 || draft.businessRules.slaDays > 180) {
      errors.slaDays = 'SLA days must be between 5 and 180.';
    }
    if (draft.businessRules.providerTypes.length === 0) {
      errors.providerTypes = 'At least one provider type must be configured.';
    }
    if (!draft.contacts[0]?.email?.includes('@')) {
      errors.contactEmail = 'A valid primary contact email is required.';
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }

  public buildDryRun(
    draft: Omit<TenantRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): DryRunReport {
    const warnings: string[] = [];
    if (!draft.endpoints.vaultSecretRef.startsWith('vault://')) {
      warnings.push('Secret reference should use a vault:// URI; raw secrets are never stored.');
    }
    if (draft.endpoints.authMode === 'none') {
      warnings.push('FHIR endpoint auth mode is set to None (suitable for local Mock/Dev only).');
    }

    return {
      tenantCode: draft.code,
      fhirPartition: `${draft.endpoints.fhirBase.replace(/\/+$/, '')}/${draft.code}`,
      resourcesToSeed: [
        'Tenant Organization & Payer Division',
        'Reference InsurancePlans (FFS, MCO, CHIP)',
        'Sample Providers & Practice Locations',
        'Sample Clinical Bundle (Jane Doe MRN-1001)',
        'Provisioning Provenance & AuditEvent',
      ],
      adminUser: draft.contacts[0]?.email ?? 'admin@synthetic.example',
      defaultRolesCount: 11,
      featureFlagsCount: draft.featureFlags.length,
      warnings,
    };
  }

  public async provisionTenant(
    draft: Omit<TenantRecord, 'id' | 'createdAt' | 'updatedAt'>,
    actor: { name: string; role: RoleName },
    options?: { simulateFailureAtStep?: number },
  ): Promise<{ tenant: TenantRecord; steps: ProvisioningStepLog[] }> {
    const validation = this.validateWizardDraft(draft);
    if (!validation.valid) {
      const firstErr = Object.values(validation.errors)[0];
      throw new AppError({
        message: firstErr ?? 'Tenant onboarding configuration is invalid.',
        statusCode: 400,
        code: 'WIZARD_VALIDATION_FAILED',
      });
    }

    const id = `tenant-${draft.code}`;
    const now = new Date().toISOString();
    const steps: ProvisioningStepLog[] = [];
    const ctx: FhirRequestContext = { tenantId: id, tenantCode: draft.code };

    try {
      // Step 1: Partition store
      if (options?.simulateFailureAtStep === 1) {
        throw new Error('Simulated failure creating tenant FHIR partition.');
      }
      const client = getFhirClient();
      await client.capabilities(ctx);
      steps.push({
        step: 'Create tenant FHIR partition',
        status: 'Completed',
        timestamp: new Date().toISOString(),
        message: `Partition '${draft.code}' initialized in ${client.mode} store.`,
      });

      // Step 2: Seed reference data
      if (options?.simulateFailureAtStep === 2) {
        throw new Error('Simulated failure seeding reference FHIR data.');
      }
      const seeded = await seedTenantFhirData(client, ctx, true);
      steps.push({
        step: 'Seed reference data',
        status: 'Completed',
        timestamp: new Date().toISOString(),
        message: `Seeded ${seeded.resourcesWritten} synthetic FHIR resources.`,
      });

      // Step 3: Admin user & RBAC defaults
      if (options?.simulateFailureAtStep === 3) {
        throw new Error('Simulated failure creating admin user & default roles.');
      }
      steps.push({
        step: 'Create admin user & default roles',
        status: 'Completed',
        timestamp: new Date().toISOString(),
        message: `Admin ${draft.contacts[0]?.email ?? 'admin'} assigned TenantAdmin with 11 RBAC role templates.`,
      });

      // Step 4: Provenance & AuditEvent
      const provenance: FhirProvenance = {
        resourceType: 'Provenance',
        target: [{ reference: `Organization/org-payor-${draft.code.includes('fqhc') ? 'b' : 'a'}`, display: draft.legalName }],
        recorded: new Date().toISOString(),
        activity: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation',
              code: 'CREATE',
              display: 'Tenant Provisioned',
            },
          ],
        },
        agent: [{ who: { display: `${actor.name} (${actor.role})` } }],
      };
      await client.create(ctx, provenance);
      await auditService.record({
        ctx,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'create',
        resourceType: 'Organization',
        resourceId: id,
        outcomeDesc: `Provisioned tenant ${draft.code} (${draft.programTemplate})`,
      });
      steps.push({
        step: 'Write Provenance & AuditEvent',
        status: 'Completed',
        timestamp: new Date().toISOString(),
        message: 'FHIR Provenance and AuditEvent recorded.',
      });

      const tenant: TenantRecord = {
        ...draft,
        id,
        status: 'Active',
        provisioningLog: steps,
        createdAt: now,
        updatedAt: now,
      };
      this.tenants.set(id, tenant);

      eventBus.publish({
        type: 'TenantProvisioned',
        tenantId: id,
        sourceModule: 'M24',
        payload: {
          tenantId: id,
          tenantCode: draft.code,
          programTemplate: draft.programTemplate,
        },
      });

      this.notify();
      return { tenant, steps };
    } catch (err) {
      // Provisioning rollback: purge partial mock partition & ensure tenant is not left half-active
      mockFhirClient.clearTenantStore(id);
      this.tenants.delete(id);
      steps.push({
        step: 'Rollback partial provisioning',
        status: 'Failed',
        timestamp: new Date().toISOString(),
        message:
          err instanceof Error
            ? `Rolled back after error: ${err.message}`
            : 'Rolled back after provisioning failure.',
      });
      throw new AppError({
        message:
          err instanceof Error
            ? `Provisioning failed and rolled back: ${err.message}`
            : 'Provisioning failed and rolled back.',
        statusCode: 500,
        code: 'PROVISIONING_ROLLED_BACK',
        rawOutcome: steps,
      });
    }
  }

  public resolveEffectiveConfig(
    tenantId: string,
    env: EnvironmentName = 'dev',
  ): EffectiveConfigEntry[] {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new AppError({
        message: `Tenant '${tenantId}' not found.`,
        statusCode: 404,
        code: 'TENANT_NOT_FOUND',
      });
    }
    const programDefaults = PROGRAM_LAYER_DEFAULTS[tenant.programTemplate] ?? {};
    const envOverrides = tenant.envOverrides[env] ?? {};

    return CONFIG_SETTING_DEFINITIONS.map((def) => {
      let effectiveValue: unknown = def.defaultValue;
      let sourceLayer: ConfigScope = 'PLATFORM';

      if (def.key in programDefaults) {
        effectiveValue = programDefaults[def.key];
        sourceLayer = 'PROGRAM';
      }
      if (def.key in tenant.configOverrides) {
        effectiveValue = tenant.configOverrides[def.key];
        sourceLayer = 'TENANT';
      }
      if (def.key in envOverrides) {
        effectiveValue = envOverrides[def.key];
        sourceLayer = 'ENVIRONMENT';
      }

      const pendingApproval = tenant.configHistory.find(
        (h) => h.key === def.key && h.status === 'PendingApproval',
      );

      return {
        definition: def,
        effectiveValue,
        sourceLayer,
        pendingApproval,
      };
    });
  }

  public async updateConfigSetting(
    tenantId: string,
    key: string,
    newValue: unknown,
    scope: ConfigScope,
    actor: { name: string; role: RoleName },
    env: EnvironmentName = 'dev',
  ): Promise<ConfigChangeVersion> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new AppError({ message: 'Tenant not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    const def = CONFIG_SETTING_DEFINITIONS.find((d) => d.key === key);
    if (!def) {
      throw new AppError({ message: `Unknown config key '${key}'`, statusCode: 400, code: 'INVALID_KEY' });
    }

    // Validate type & bounds
    if (def.type === 'number') {
      const n = Number(newValue);
      if (Number.isNaN(n)) {
        throw new AppError({ message: `${key} must be a valid number.`, statusCode: 400, code: 'INVALID_VALUE' });
      }
      if (def.min !== undefined && n < def.min) {
        throw new AppError({ message: `${key} must be >= ${def.min}.`, statusCode: 400, code: 'INVALID_VALUE' });
      }
      if (def.max !== undefined && n > def.max) {
        throw new AppError({ message: `${key} must be <= ${def.max}.`, statusCode: 400, code: 'INVALID_VALUE' });
      }
      newValue = n;
    } else if (def.type === 'boolean') {
      newValue = Boolean(newValue);
    } else if (def.allowedValues && !def.allowedValues.includes(String(newValue))) {
      throw new AppError({
        message: `${key} must be one of: ${def.allowedValues.join(', ')}.`,
        statusCode: 400,
        code: 'INVALID_VALUE',
      });
    }

    const currentEntry = this.resolveEffectiveConfig(tenantId, env).find(
      (e) => e.definition.key === key,
    );
    const needsApproval =
      def.sensitive &&
      actor.role !== 'PlatformAdmin' &&
      actor.role !== 'AgencyApprover';

    const change: ConfigChangeVersion = {
      version: tenant.configHistory.length + 1,
      timestamp: new Date().toISOString(),
      actor: `${actor.name} (${actor.role})`,
      key,
      scope,
      environment: scope === 'ENVIRONMENT' ? env : undefined,
      previousValue: currentEntry?.effectiveValue,
      newValue,
      status: needsApproval ? 'PendingApproval' : 'Applied',
      approvedBy: needsApproval ? undefined : `${actor.name} (${actor.role})`,
    };

    if (!needsApproval) {
      this.applyChangeValue(tenant, key, newValue, scope, env);
    }
    tenant.configHistory.unshift(change);
    tenant.updatedAt = new Date().toISOString();

    await auditService.record({
      ctx: { tenantId: tenant.id, tenantCode: tenant.code },
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Organization',
      resourceId: tenant.id,
      outcomeDesc: `Config ${key} (${change.status}): ${String(change.previousValue)} -> ${String(newValue)}`,
    });

    if (!needsApproval) {
      eventBus.publish({
        type: 'ConfigChanged',
        tenantId: tenant.id,
        sourceModule: 'M24',
        payload: { key, scope, previousValue: change.previousValue, newValue },
      });
    }

    this.notify();
    return change;
  }

  public async approvePendingConfig(
    tenantId: string,
    version: number,
    actor: { name: string; role: RoleName },
  ): Promise<ConfigChangeVersion> {
    if (actor.role !== 'PlatformAdmin' && actor.role !== 'AgencyApprover') {
      throw new AppError({
        message: 'Only PlatformAdmin or AgencyApprover can approve sensitive configuration changes.',
        statusCode: 403,
        code: 'FORBIDDEN',
      });
    }
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new AppError({ message: 'Tenant not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    const change = tenant.configHistory.find((c) => c.version === version);
    if (!change || change.status !== 'PendingApproval') {
      throw new AppError({ message: 'Pending change not found', statusCode: 404, code: 'NOT_FOUND' });
    }

    this.applyChangeValue(
      tenant,
      change.key,
      change.newValue,
      change.scope,
      change.environment ?? 'dev',
    );
    change.status = 'Applied';
    change.approvedBy = `${actor.name} (${actor.role})`;
    tenant.updatedAt = new Date().toISOString();

    eventBus.publish({
      type: 'ConfigChanged',
      tenantId: tenant.id,
      sourceModule: 'M24',
      payload: { key: change.key, approvedVersion: version, newValue: change.newValue },
    });

    await auditService.record({
      ctx: { tenantId: tenant.id, tenantCode: tenant.code },
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Organization',
      resourceId: tenant.id,
      outcomeDesc: `Approved sensitive config change v${version} for ${change.key}`,
    });

    this.notify();
    return change;
  }

  public async rollbackConfigVersion(
    tenantId: string,
    version: number,
    actor: { name: string; role: RoleName },
  ): Promise<ConfigChangeVersion> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new AppError({ message: 'Tenant not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    const target = tenant.configHistory.find((c) => c.version === version);
    if (!target) {
      throw new AppError({ message: 'Config version not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    return this.updateConfigSetting(
      tenantId,
      target.key,
      target.previousValue,
      target.scope,
      actor,
      target.environment ?? 'dev',
    );
  }

  private applyChangeValue(
    tenant: TenantRecord,
    key: string,
    value: unknown,
    scope: ConfigScope,
    env: EnvironmentName,
  ): void {
    if (scope === 'ENVIRONMENT') {
      tenant.envOverrides[env] = {
        ...(tenant.envOverrides[env] ?? {}),
        [key]: value,
      };
    } else {
      tenant.configOverrides[key] = value;
    }

    // Keep businessRules synced for well-known keys
    if (key === 'enrollment.slaDays' && typeof value === 'number') {
      tenant.businessRules.slaDays = value;
    }
    if (key === 'enrollment.revalidationMonths' && typeof value === 'number') {
      tenant.businessRules.revalidationMonths = value;
    }
    if (key === 'credentialing.recredentialingMonths' && typeof value === 'number') {
      tenant.businessRules.recredentialingMonths = value;
    }
    if (key === 'enrollment.applicationFeeUsd' && typeof value === 'number') {
      tenant.businessRules.applicationFeeUsd = value;
    }
  }

  public updateFeatureFlag(
    tenantId: string,
    flagKey: string,
    patch: Partial<TenantFeatureFlag>,
  ): TenantRecord {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new AppError({ message: 'Tenant not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    tenant.featureFlags = tenant.featureFlags.map((f) =>
      f.key === flagKey ? { ...f, ...patch } : f,
    );
    tenant.updatedAt = new Date().toISOString();
    eventBus.publish({
      type: 'ConfigChanged',
      tenantId: tenant.id,
      sourceModule: 'M24',
      payload: { featureFlag: flagKey, patch },
    });
    this.notify();
    return tenant;
  }

  public exportConfigJson(tenantId: string): string {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new AppError({ message: 'Tenant not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    // Secrets explicitly excluded; only vault reference URI is exported
    const exportPayload = {
      schemaVersion: '1.0',
      exportedAt: new Date().toISOString(),
      tenantCode: tenant.code,
      programTemplate: tenant.programTemplate,
      branding: tenant.branding,
      endpoints: {
        ...tenant.endpoints,
        vaultSecretRef: tenant.endpoints.vaultSecretRef,
      },
      businessRules: tenant.businessRules,
      validators: tenant.validators,
      codeSets: tenant.codeSets,
      featureFlags: tenant.featureFlags,
      configOverrides: tenant.configOverrides,
      envOverrides: tenant.envOverrides,
    };
    return JSON.stringify(exportPayload, null, 2);
  }

  public validateConfigImportJson(rawJson: string): ConfigImportValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];
    const keysToUpdate: string[] = [];
    const strippedSecrets: string[] = [];

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawJson) as Record<string, unknown>;
    } catch {
      return {
        valid: false,
        errors: ['Invalid JSON syntax.'],
        warnings: [],
        keysToUpdate: [],
        strippedSecrets: [],
      };
    }

    if (!parsed || typeof parsed !== 'object') {
      errors.push('Configuration import must be a JSON object.');
    }

    // Detect & strip forbidden secret keys
    const forbidden = ['secret', 'token', 'password', 'apiKey', 'clientSecret', 'privateKey'];
    for (const key of Object.keys(parsed)) {
      if (forbidden.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
        strippedSecrets.push(key);
        warnings.push(`Sensitive field '${key}' will be stripped; use vault:// references instead.`);
      }
    }

    if (parsed.configOverrides && typeof parsed.configOverrides === 'object') {
      for (const [k, val] of Object.entries(parsed.configOverrides as Record<string, unknown>)) {
        const def = CONFIG_SETTING_DEFINITIONS.find((d) => d.key === k);
        if (!def) {
          warnings.push(`Unknown config key '${k}' will be ignored.`);
          continue;
        }
        if (def.type === 'number') {
          const n = Number(val);
          if (Number.isNaN(n) || (def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) {
            errors.push(`Config key '${k}' has out-of-range numeric value '${String(val)}'.`);
            continue;
          }
        }
        if (def.allowedValues && !def.allowedValues.includes(String(val))) {
          errors.push(`Config key '${k}' must be one of ${def.allowedValues.join(', ')}.`);
          continue;
        }
        keysToUpdate.push(k);
      }
    }

    if (parsed.businessRules && typeof parsed.businessRules === 'object') {
      const br = parsed.businessRules as Partial<TenantBusinessRules>;
      if (br.slaDays !== undefined && (br.slaDays < 5 || br.slaDays > 180)) {
        errors.push('businessRules.slaDays must be between 5 and 180.');
      }
      keysToUpdate.push('businessRules');
    }

    if (parsed.branding) keysToUpdate.push('branding');
    if (parsed.featureFlags) keysToUpdate.push('featureFlags');

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      keysToUpdate,
      strippedSecrets,
    };
  }

  public async applyConfigImportJson(
    tenantId: string,
    rawJson: string,
    actor: { name: string; role: RoleName },
  ): Promise<ConfigImportValidationReport> {
    const report = this.validateConfigImportJson(rawJson);
    if (!report.valid) {
      throw new AppError({
        message: report.errors[0] ?? 'Configuration import validation failed.',
        statusCode: 400,
        code: 'IMPORT_VALIDATION_FAILED',
      });
    }
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new AppError({ message: 'Tenant not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (parsed.configOverrides && typeof parsed.configOverrides === 'object') {
      for (const [k, val] of Object.entries(parsed.configOverrides as Record<string, unknown>)) {
        if (CONFIG_SETTING_DEFINITIONS.some((d) => d.key === k)) {
          tenant.configOverrides[k] = val;
        }
      }
    }
    if (parsed.branding && typeof parsed.branding === 'object') {
      tenant.branding = { ...tenant.branding, ...(parsed.branding as Partial<TenantBranding>) };
    }
    if (parsed.businessRules && typeof parsed.businessRules === 'object') {
      tenant.businessRules = {
        ...tenant.businessRules,
        ...(parsed.businessRules as Partial<TenantBusinessRules>),
      };
    }
    if (Array.isArray(parsed.featureFlags)) {
      tenant.featureFlags = parsed.featureFlags as TenantFeatureFlag[];
    }
    tenant.updatedAt = new Date().toISOString();

    await auditService.record({
      ctx: { tenantId: tenant.id, tenantCode: tenant.code },
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Organization',
      resourceId: tenant.id,
      outcomeDesc: `Imported tenant configuration JSON (${report.keysToUpdate.length} sections)`,
    });
    eventBus.publish({
      type: 'ConfigChanged',
      tenantId: tenant.id,
      sourceModule: 'M24',
      payload: { importedKeys: report.keysToUpdate },
    });
    this.notify();
    return report;
  }

  public async suspendTenant(
    tenantId: string,
    actor: { name: string; role: RoleName },
  ): Promise<TenantRecord> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new AppError({ message: 'Tenant not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    tenant.status = 'Suspended';
    tenant.updatedAt = new Date().toISOString();
    await auditService.record({
      ctx: { tenantId: tenant.id, tenantCode: tenant.code },
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Organization',
      resourceId: tenant.id,
      outcomeDesc: `Suspended tenant ${tenant.code}`,
    });
    this.notify();
    return tenant;
  }

  public toggleLegalHold(tenantId: string, legalHold: boolean): TenantRecord {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new AppError({ message: 'Tenant not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    tenant.legalHold = legalHold;
    tenant.updatedAt = new Date().toISOString();
    this.notify();
    return tenant;
  }

  public async exportTenantDataBundle(
    tenantId: string,
    actor: { name: string; role: RoleName },
  ): Promise<FhirBundle> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new AppError({ message: 'Tenant not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    const ctx: FhirRequestContext = { tenantId: tenant.id, tenantCode: tenant.code };
    const bundle = mockFhirClient.exportTenantBundle(ctx);
    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'export',
      resourceType: 'Bundle',
      resourceId: tenant.id,
      outcomeDesc: `Exported offboarding data bundle (${bundle.total ?? 0} resources)`,
    });
    return bundle;
  }

  public async scheduleOffboardingDeletion(
    tenantId: string,
    deletionDateIso: string,
    actor: { name: string; role: RoleName },
  ): Promise<TenantRecord> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new AppError({ message: 'Tenant not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    if (tenant.legalHold) {
      throw new AppError({
        message: 'Deletion blocked: active legal hold is placed on this tenant.',
        statusCode: 409,
        code: 'LEGAL_HOLD_ACTIVE',
      });
    }
    tenant.status = 'Offboarded';
    tenant.scheduledDeletionAt = deletionDateIso;
    tenant.updatedAt = new Date().toISOString();
    await auditService.record({
      ctx: { tenantId: tenant.id, tenantCode: tenant.code },
      actorName: actor.name,
      actorRole: actor.role,
      action: 'delete',
      resourceType: 'Organization',
      resourceId: tenant.id,
      outcomeDesc: `Scheduled tenant offboarding deletion for ${deletionDateIso}`,
    });
    this.notify();
    return tenant;
  }

  public async testEndpointConnection(
    endpointLabel: string,
    url: string,
    mode: 'mock' | 'live',
  ): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const started = performance.now();
    if (!url || !/^https?:\/\//i.test(url.trim())) {
      return {
        ok: false,
        latencyMs: 0,
        message: `${endpointLabel}: URL must start with http:// or https://`,
      };
    }
    if (mode === 'mock') {
      await new Promise((r) => setTimeout(r, 40));
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        message: `${endpointLabel} reachable in Mock mode (FHIR 4.0.1 / contract stub OK).`,
      };
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const targetUrl =
        endpointLabel === 'FHIR Base'
          ? `${url.replace(/\/+$/, '')}/metadata`
          : url;
      const resp = await fetch(targetUrl, {
        method: 'GET',
        headers: { Accept: 'application/fhir+json, application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - started);
      if (!resp.ok) {
        return {
          ok: false,
          latencyMs,
          message: `HTTP ${resp.status} ${resp.statusText}`,
        };
      }
      return {
        ok: true,
        latencyMs,
        message: `Connected (HTTP ${resp.status})`,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        message:
          err instanceof Error
            ? `${err.message} (check CORS or local server status)`
            : 'Connection failed',
      };
    }
  }
}

export const tenantService = new TenantService();
