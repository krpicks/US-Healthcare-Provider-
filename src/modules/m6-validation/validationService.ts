import { eventBus } from '../../events';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { validateNpi } from '../../rules';
import { auditService, settingsService } from '../../services';
import {
  AppError,
  type FhirCommunication,
  type FhirDetectedIssue,
  type FhirProvenance,
  type RoleName,
} from '../../types';
import { providerService } from '../m3-directory/providerService';
import {
  enrollmentService,
  type EnrollmentApplication,
} from '../m5-enrollment/enrollmentService';

export type ValidationOutcome = 'Pass' | 'Fail' | 'Warning' | 'Unable';
export type ValidatorSeverity = 'Critical' | 'Major' | 'Advisory';
export type ValidatorRunMode = 'Mock' | 'Gateway';

export interface ValidatorRuleConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: ValidatorSeverity;
  timeoutMs: number;
  mode: ValidatorRunMode;
}

export interface ValidatorResult {
  validatorId: string;
  validatorName: string;
  status: ValidationOutcome;
  severity: ValidatorSeverity;
  evidence: string;
  durationMs: number;
  sourceMode: ValidatorRunMode;
  fallbackWarning?: string;
  detectedIssueId?: string;
  overridden?: {
    reason: string;
    actor: string;
    timestamp: string;
    provenanceId?: string;
  };
}

export interface ValidationRunReport {
  id: string;
  applicationId: string;
  applicationNumber: string;
  providerName: string;
  npi: string;
  runAt: string;
  overallStatus: 'Pass' | 'Fail' | 'Warning';
  results: ValidatorResult[];
}

export interface ExclusionRecord {
  id: string;
  name: string;
  npi?: string;
  source: 'OIG-LEIE' | 'SAM.gov';
  exclusionType: string;
  effectiveDate: string;
}

export interface LicenseRegistryEntry {
  licenseNumber: string;
  state: string;
  status: 'Active' | 'Expired' | 'Revoked' | 'Suspended';
  expiryDate: string;
}

export interface ValidationReferenceData {
  exclusions: ExclusionRecord[];
  deathMasterNpis: string[];
  revokedLicenses: LicenseRegistryEntry[];
}

export interface ValidatorDefinition {
  id: string;
  name: string;
  run: (
    app: EnrollmentApplication,
    ctx: FhirRequestContext,
    refData: ValidationReferenceData,
  ) => Promise<{ status: ValidationOutcome; evidence: string }>;
}

const DEFAULT_RULES: ValidatorRuleConfig[] = [
  { id: 'npi', name: 'NPI Luhn & NPPES Lookup', description: 'Verifies 10-digit Luhn checksum and simulated NPPES registry active match.', enabled: true, severity: 'Critical', timeoutMs: 4000, mode: 'Mock' },
  { id: 'license', name: 'State Licensing Board', description: 'Checks license status, state match, and non-expired term.', enabled: true, severity: 'Critical', timeoutMs: 4000, mode: 'Mock' },
  { id: 'exclusion', name: 'SAM & OIG-LEIE Exclusions', description: 'Screens applicant, owners >=5%, and NPI against federal exclusion lists.', enabled: true, severity: 'Critical', timeoutMs: 5000, mode: 'Mock' },
  { id: 'death-master', name: 'SSA Death Master File', description: 'Confirms applicant is not listed on the Social Security Death Master File.', enabled: true, severity: 'Critical', timeoutMs: 4000, mode: 'Mock' },
  { id: 'address', name: 'USPS Address Standardization', description: 'Validates practice street, city, state, and 5-digit ZIP formatting.', enabled: true, severity: 'Advisory', timeoutMs: 3000, mode: 'Mock' },
  { id: 'duplicate', name: 'Duplicate Enrollment (M3)', description: 'Checks M3 Provider Directory for existing active NPI or high-similarity duplicate.', enabled: true, severity: 'Major', timeoutMs: 4000, mode: 'Mock' },
  { id: 'tin', name: 'IRS TIN Match', description: 'Verifies EIN/TIN format (XX-XXXXXXX) and simulated IRS CP575 match.', enabled: true, severity: 'Major', timeoutMs: 4000, mode: 'Mock' },
  { id: 'dea', name: 'DEA Registration Check', description: 'Validates DEA format (2 letters + 7 digits) for prescribing provider types.', enabled: true, severity: 'Advisory', timeoutMs: 4000, mode: 'Mock' },
  { id: 'taxonomy', name: 'NUCC Taxonomy Consistency', description: 'Ensures 10-character NUCC code matches selected provider specialty.', enabled: true, severity: 'Major', timeoutMs: 3000, mode: 'Mock' },
];

function buildInitialRefData(): ValidationReferenceData {
  return {
    exclusions: [
      { id: 'excl-1', name: 'Dr. Victor Malpractice', npi: '1999999992', source: 'OIG-LEIE', exclusionType: '1128(a)(1) Program Fraud', effectiveDate: '2024-03-15' },
      { id: 'excl-2', name: 'Apex Fraudulent Labs LLC', npi: '1888888885', source: 'SAM.gov', exclusionType: 'Debarment', effectiveDate: '2023-11-01' },
      { id: 'excl-3', name: 'Dr. Arthur Vance', npi: '1777777778', source: 'OIG-LEIE', exclusionType: '1128(b)(4) License Revocation', effectiveDate: '2025-01-10' },
      { id: 'excl-4', name: 'TriState Kickback Clinic', source: 'SAM.gov', exclusionType: 'Federal Exclusion', effectiveDate: '2024-08-22' },
      { id: 'excl-5', name: 'Dr. Brenda Holloway', npi: '1666666661', source: 'OIG-LEIE', exclusionType: '1128(a)(3) Felony Conviction', effectiveDate: '2025-05-04' },
    ],
    deathMasterNpis: ['1555555554'],
    revokedLicenses: [
      { licenseNumber: 'REV-0001', state: 'NY', status: 'Revoked', expiryDate: '2024-01-01' },
    ],
  };
}

interface TenantValidationState {
  rules: ValidatorRuleConfig[];
  refData: ValidationReferenceData;
  runsByApp: Record<string, ValidationRunReport[]>;
}

const tenantValidationStore = new Map<string, TenantValidationState>();

function getState(tenantId: string): TenantValidationState {
  let st = tenantValidationStore.get(tenantId);
  if (!st) {
    st = {
      rules: DEFAULT_RULES.map((r) => ({ ...r })),
      refData: buildInitialRefData(),
      runsByApp: {},
    };
    tenantValidationStore.set(tenantId, st);
  }
  return st;
}

const TAXONOMY_PREFIX_MAP: Record<string, string[]> = {
  'Family Medicine': ['207Q'],
  'Internal Medicine': ['207R'],
  Pediatrics: ['2080'],
  Psychiatry: ['2084'],
  Dentistry: ['1223'],
};

export const VALIDATORS: ValidatorDefinition[] = [
  {
    id: 'npi',
    name: 'NPI Luhn & NPPES Lookup',
    async run(app) {
      if (!validateNpi(app.npi)) {
        return { status: 'Fail', evidence: `NPI '${app.npi}' failed US 10-digit Luhn checksum.` };
      }
      return {
        status: 'Pass',
        evidence: `NPI ${app.npi} passed Luhn check; NPPES active Enumeration Type-1 confirmed for ${app.applicantGiven} ${app.applicantFamily}.`,
      };
    },
  },
  {
    id: 'license',
    name: 'State Licensing Board',
    async run(app, _ctx, refData) {
      if (!app.licenseNumber.trim()) {
        return { status: 'Fail', evidence: 'No state license number provided.' };
      }
      const revoked = refData.revokedLicenses.find(
        (l) => l.licenseNumber.toLowerCase() === app.licenseNumber.trim().toLowerCase(),
      );
      if (revoked) {
        return {
          status: 'Fail',
          evidence: `License ${app.licenseState}-${app.licenseNumber} status is ${revoked.status} per State Board.`,
        };
      }
      const today = new Date().toISOString().slice(0, 10);
      if (app.licenseExpiry && app.licenseExpiry < today) {
        return {
          status: 'Fail',
          evidence: `License ${app.licenseState}-${app.licenseNumber} expired on ${app.licenseExpiry}.`,
        };
      }
      return {
        status: 'Pass',
        evidence: `State Board verified ${app.licenseState}-${app.licenseNumber} Active through ${app.licenseExpiry}.`,
      };
    },
  },
  {
    id: 'exclusion',
    name: 'SAM & OIG-LEIE Exclusions',
    async run(app, _ctx, refData) {
      const fullName = `${app.applicantGiven} ${app.applicantFamily}`.trim().toLowerCase();
      const orgName = app.organizationName.trim().toLowerCase();
      const ownerNames = app.disclosures.map((d) => d.name.trim().toLowerCase());

      const hit = refData.exclusions.find(
        (e) =>
          (e.npi && e.npi === app.npi) ||
          fullName.includes(e.name.toLowerCase()) ||
          e.name.toLowerCase().includes(fullName) ||
          (orgName && e.name.toLowerCase() === orgName) ||
          ownerNames.some((o) => o && e.name.toLowerCase().includes(o)),
      );
      if (hit) {
        return {
          status: 'Fail',
          evidence: `EXCLUSION MATCH (${hit.source}): ${hit.name} — ${hit.exclusionType} (effective ${hit.effectiveDate}).`,
        };
      }
      return {
        status: 'Pass',
        evidence: `Screened applicant, organization, and ${app.disclosures.length} disclosed party(ies) against ${refData.exclusions.length} SAM/OIG-LEIE entries: 0 hits.`,
      };
    },
  },
  {
    id: 'death-master',
    name: 'SSA Death Master File',
    async run(app, _ctx, refData) {
      if (refData.deathMasterNpis.includes(app.npi)) {
        return { status: 'Fail', evidence: `NPI ${app.npi} matched SSA Death Master File deceased record.` };
      }
      return { status: 'Pass', evidence: 'No match found in SSA Death Master File.' };
    },
  },
  {
    id: 'address',
    name: 'USPS Address Standardization',
    async run(app) {
      const loc = app.locations[0];
      if (!loc || !loc.street.trim() || !loc.city.trim()) {
        return { status: 'Fail', evidence: 'Primary practice address is incomplete.' };
      }
      if (!/^\d{5}(-\d{4})?$/.test(loc.postalCode.trim())) {
        return { status: 'Warning', evidence: `ZIP '${loc.postalCode}' does not match USPS 5-digit format.` };
      }
      return {
        status: 'Pass',
        evidence: `USPS standardized: ${loc.street.toUpperCase()}, ${loc.city.toUpperCase()}, ${loc.state.toUpperCase()} ${loc.postalCode}.`,
      };
    },
  },
  {
    id: 'duplicate',
    name: 'Duplicate Enrollment (M3)',
    async run(app, ctx) {
      if (app.applicationType !== 'New Enrollment') {
        return { status: 'Pass', evidence: `Duplicate check bypassed for ${app.applicationType} workflow.` };
      }
      const existing = await providerService.listProviders(ctx);
      const exactNpi = existing.find((p) => p.npi === app.npi && p.status !== 'Terminated');
      if (exactNpi) {
        return {
          status: 'Warning',
          evidence: `Active Provider Directory record already exists for NPI ${app.npi} (${exactNpi.fullName}, status ${exactNpi.status}).`,
        };
      }
      return { status: 'Pass', evidence: `Checked against ${existing.length} directory providers: no active duplicate NPI.` };
    },
  },
  {
    id: 'tin',
    name: 'IRS TIN Match',
    async run(app) {
      if (!/^\d{2}-\d{7}$/.test(app.tin.trim())) {
        return { status: 'Fail', evidence: `TIN '${app.tin}' must match IRS EIN format XX-XXXXXXX.` };
      }
      return { status: 'Pass', evidence: `IRS TIN Match confirmed for ${app.organizationName} (**-***${app.tin.slice(-4)}).` };
    },
  },
  {
    id: 'dea',
    name: 'DEA Registration Check',
    async run(app) {
      if (!app.deaNumber.trim()) {
        return { status: 'Warning', evidence: 'No DEA number provided; verify if provider prescribes controlled substances.' };
      }
      if (!/^[A-Z]{2}\d{7}$/.test(app.deaNumber.trim().toUpperCase())) {
        return { status: 'Fail', evidence: `DEA '${app.deaNumber}' fails 2-letter + 7-digit format validation.` };
      }
      return { status: 'Pass', evidence: `DEA registration ${app.deaNumber.toUpperCase()} active (Schedules II–V).` };
    },
  },
  {
    id: 'taxonomy',
    name: 'NUCC Taxonomy Consistency',
    async run(app) {
      if (!/^[0-9A-Z]{10}$/.test(app.taxonomyCode.trim())) {
        return { status: 'Fail', evidence: `Taxonomy '${app.taxonomyCode}' is not a valid 10-character NUCC code.` };
      }
      const prefixes = TAXONOMY_PREFIX_MAP[app.specialty];
      if (prefixes && !prefixes.some((p) => app.taxonomyCode.startsWith(p))) {
        return {
          status: 'Warning',
          evidence: `Taxonomy ${app.taxonomyCode} may not align with declared specialty '${app.specialty}'.`,
        };
      }
      return { status: 'Pass', evidence: `NUCC code ${app.taxonomyCode} consistent with ${app.specialty} (${app.providerType}).` };
    },
  },
];

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Validator timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const validationService = {
  getState(tenantId: string): TenantValidationState {
    return getState(tenantId);
  },

  resetForTests(tenantId?: string): void {
    if (tenantId) {
      tenantValidationStore.delete(tenantId);
    } else {
      tenantValidationStore.clear();
    }
  },

  updateRule(
    tenantId: string,
    validatorId: string,
    patch: Partial<ValidatorRuleConfig>,
  ): ValidatorRuleConfig[] {
    const st = getState(tenantId);
    st.rules = st.rules.map((r) => (r.id === validatorId ? { ...r, ...patch } : r));
    return st.rules;
  },

  addExclusionEntry(
    tenantId: string,
    entry: Omit<ExclusionRecord, 'id'>,
  ): ExclusionRecord {
    const st = getState(tenantId);
    const created: ExclusionRecord = {
      ...entry,
      id: `excl-${Date.now().toString(36)}`,
    };
    st.refData.exclusions.unshift(created);
    return created;
  },

  removeExclusionEntry(tenantId: string, id: string): void {
    const st = getState(tenantId);
    st.refData.exclusions = st.refData.exclusions.filter((e) => e.id !== id);
  },

  getLatestRun(tenantId: string, applicationId: string): ValidationRunReport | undefined {
    const st = getState(tenantId);
    return st.runsByApp[applicationId]?.[0];
  },

  /**
   * Parallel validator orchestrator with timeout & partial failure handling.
   * Writes DetectedIssue for failures, updates enrollment case, publishes ValidationCompleted.
   */
  async runValidationSuite(
    ctx: FhirRequestContext,
    applicationId: string,
    actor: { name: string; role: RoleName },
  ): Promise<ValidationRunReport> {
    const app = enrollmentService.getApplicationById(ctx.tenantId, applicationId);
    if (!app) {
      throw new AppError({ message: 'Enrollment application not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const st = getState(ctx.tenantId);
    const enabledRules = st.rules.filter((r) => r.enabled);
    const client = getFhirClient();
    const gatewayBase = settingsService.load().gatewayBaseUrl.replace(/\/+$/, '');

    const settled = await Promise.allSettled(
      enabledRules.map(async (rule): Promise<ValidatorResult> => {
        const started = performance.now();
        const def = VALIDATORS.find((v) => v.id === rule.id);
        if (!def) {
          return {
            validatorId: rule.id,
            validatorName: rule.name,
            status: 'Unable',
            severity: rule.severity,
            evidence: 'Validator implementation not registered.',
            durationMs: 0,
            sourceMode: 'Mock',
          };
        }

        let fallbackWarning: string | undefined;
        let usedMode: ValidatorRunMode = rule.mode;

        if (rule.mode === 'Gateway') {
          try {
            const resp = await runWithTimeout(
              fetch(`${gatewayBase}/api/v1/validators/${rule.id}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Tenant-Id': ctx.tenantCode,
                },
                body: JSON.stringify({ applicationId: app.id, npi: app.npi }),
              }),
              rule.timeoutMs,
            );
            if (!resp.ok) {
              throw new Error(`Gateway returned HTTP ${resp.status}`);
            }
            const json = (await resp.json()) as { status?: ValidationOutcome; evidence?: string };
            return {
              validatorId: rule.id,
              validatorName: rule.name,
              status: json.status ?? 'Pass',
              severity: rule.severity,
              evidence: json.evidence ?? 'Verified by .NET Integration Gateway.',
              durationMs: Math.round(performance.now() - started),
              sourceMode: 'Gateway',
            };
          } catch (err) {
            usedMode = 'Mock';
            fallbackWarning = `Gateway unreachable (${err instanceof Error ? err.message : 'network error'}); fell back to Mock validator.`;
          }
        }

        try {
          const res = await runWithTimeout(def.run(app, ctx, st.refData), rule.timeoutMs);
          return {
            validatorId: rule.id,
            validatorName: rule.name,
            status: res.status,
            severity: rule.severity,
            evidence: res.evidence,
            durationMs: Math.round(performance.now() - started),
            sourceMode: usedMode,
            fallbackWarning,
          };
        } catch (err) {
          return {
            validatorId: rule.id,
            validatorName: rule.name,
            status: 'Unable',
            severity: rule.severity,
            evidence: err instanceof Error ? err.message : 'Validator execution failed.',
            durationMs: Math.round(performance.now() - started),
            sourceMode: usedMode,
            fallbackWarning,
          };
        }
      }),
    );

    const results: ValidatorResult[] = settled.map((item, idx) =>
      item.status === 'fulfilled'
        ? item.value
        : {
            validatorId: enabledRules[idx].id,
            validatorName: enabledRules[idx].name,
            status: 'Unable',
            severity: enabledRules[idx].severity,
            evidence: 'Unexpected validator exception.',
            durationMs: 0,
            sourceMode: 'Mock',
          },
    );

    // Persist DetectedIssue for every Fail or Unable result
    for (const r of results) {
      if (r.status === 'Fail' || r.status === 'Unable') {
        const issue: FhirDetectedIssue = {
          resourceType: 'DetectedIssue',
          status: 'final',
          severity: r.severity === 'Critical' ? 'high' : r.severity === 'Major' ? 'moderate' : 'low',
          code: {
            coding: [
              {
                system: 'http://providerlink.local/CodeSystem/validation-issue',
                code: r.validatorId,
                display: r.validatorName,
              },
            ],
          },
          identifiedDateTime: new Date().toISOString(),
          detail: `${app.applicationNumber}: ${r.evidence}`,
        };
        const created = await client.create(ctx, issue);
        r.detectedIssueId = created.id;
      }
    }

    const failCount = results.filter((r) => r.status === 'Fail').length;
    const warnCount = results.filter((r) => r.status === 'Warning' || r.status === 'Unable').length;
    const overallStatus: ValidationRunReport['overallStatus'] =
      failCount > 0 ? 'Fail' : warnCount > 0 ? 'Warning' : 'Pass';

    const report: ValidationRunReport = {
      id: `val-${Date.now().toString(36)}`,
      applicationId: app.id,
      applicationNumber: app.applicationNumber,
      providerName: `${app.applicantGiven} ${app.applicantFamily}`,
      npi: app.npi,
      runAt: new Date().toISOString(),
      overallStatus,
      results,
    };

    st.runsByApp[app.id] = [report, ...(st.runsByApp[app.id] ?? [])];

    // Advance case status when validation runs
    if (app.status === 'Submitted' || app.status === 'In Validation') {
      const nextStatus = failCount === 0 ? 'In Screening' : 'In Validation';
      enrollmentService.transitionStatus(
        ctx.tenantId,
        app.id,
        nextStatus,
        `${actor.name} (${actor.role})`,
        `Validation run ${report.id}: ${results.filter((r) => r.status === 'Pass').length}/${results.length} passed, ${failCount} failed.`,
      );
    }

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'DetectedIssue',
      outcomeDesc: `Executed M6 validation suite for ${app.applicationNumber}: ${overallStatus} (${failCount} fail, ${warnCount} warn)`,
    });

    eventBus.publish({
      type: 'ValidationCompleted',
      tenantId: ctx.tenantId,
      sourceModule: 'M6',
      payload: {
        applicationId: app.id,
        applicationNumber: app.applicationNumber,
        overallStatus,
        passCount: results.filter((r) => r.status === 'Pass').length,
        failCount,
      },
    });

    return report;
  },

  async overrideValidationFinding(
    ctx: FhirRequestContext,
    applicationId: string,
    validatorId: string,
    reason: string,
    actor: { name: string; role: RoleName },
  ): Promise<ValidatorResult> {
    if (!reason.trim()) {
      throw new AppError({
        message: 'A documented justification reason is mandatory for validation overrides.',
        statusCode: 400,
        code: 'REASON_REQUIRED',
      });
    }
    const latest = this.getLatestRun(ctx.tenantId, applicationId);
    const finding = latest?.results.find((r) => r.validatorId === validatorId);
    if (!latest || !finding) {
      throw new AppError({ message: 'Validation finding not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const client = getFhirClient();
    const prov: FhirProvenance = {
      resourceType: 'Provenance',
      target: [
        {
          reference: finding.detectedIssueId
            ? `DetectedIssue/${finding.detectedIssueId}`
            : `Task/${applicationId}`,
        },
      ],
      recorded: new Date().toISOString(),
      reason: [{ text: `Validation override (${finding.validatorName}): ${reason}` }],
      agent: [{ who: { display: `${actor.name} (${actor.role})` } }],
    };
    const createdProv = await client.create(ctx, prov);

    finding.overridden = {
      reason,
      actor: `${actor.name} (${actor.role})`,
      timestamp: new Date().toISOString(),
      provenanceId: createdProv.id,
    };

    const unresolvedFails = latest.results.filter(
      (r) => r.status === 'Fail' && !r.overridden,
    );
    if (unresolvedFails.length === 0) {
      latest.overallStatus = 'Warning';
      enrollmentService.transitionStatus(
        ctx.tenantId,
        applicationId,
        'In Screening',
        `${actor.name} (${actor.role})`,
        `All critical validation failures overridden (Provenance/${createdProv.id}); moved to Screening.`,
      );
    }

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Provenance',
      resourceId: createdProv.id,
      outcomeDesc: `Overrode ${finding.validatorName} on ${latest.applicationNumber}: ${reason}`,
    });

    return finding;
  },

  async createRfiFromFailures(
    ctx: FhirRequestContext,
    applicationId: string,
    dueDate: string,
    actor: { name: string; role: RoleName },
  ): Promise<FhirCommunication> {
    const latest = this.getLatestRun(ctx.tenantId, applicationId);
    const failures = (latest?.results ?? []).filter(
      (r) => (r.status === 'Fail' || r.status === 'Warning') && !r.overridden,
    );
    if (failures.length === 0) {
      throw new AppError({
        message: 'No open validation failures or warnings to include in an RFI.',
        statusCode: 400,
        code: 'NO_FAILURES',
      });
    }

    const deficiencies = failures.map((f) => `${f.validatorName}: ${f.evidence}`);
    enrollmentService.addRfiToApplication(
      ctx.tenantId,
      applicationId,
      {
        dueDate,
        deficiencies,
        notes: 'Automated RFI generated from M6 Validation Engine findings.',
      },
      `${actor.name} (${actor.role})`,
    );

    const client = getFhirClient();
    const comm: FhirCommunication = {
      resourceType: 'Communication',
      status: 'completed',
      category: [{ text: 'Request for Information (RFI)' }],
      sent: new Date().toISOString(),
      sender: { display: `${actor.name} (${actor.role})` },
      payload: [{ contentString: `RFI due ${dueDate}: ${deficiencies.join(' | ')}` }],
    };
    return client.create(ctx, comm);
  },
};
