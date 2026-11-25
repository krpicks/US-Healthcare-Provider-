import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { auditService } from '../../services/auditService';
import {
  AppError,
  type FhirBundle,
  type FhirMeasureReport,
  type FhirOperationOutcome,
  type FhirPatient,
  type FhirResource,
  type RoleName,
} from '../../types';
import { patientService, type PatientChartBundle } from '../m4-patients/patientService';

export type UdsAvailability = 'Present' | 'Partial' | 'Missing';

export type UdsRequirementCategory =
  | 'Demographics'
  | 'SDOH'
  | 'Encounters'
  | 'Diagnoses'
  | 'Labs'
  | 'Vitals'
  | 'Immunizations'
  | 'Measure Inputs';

export interface UdsDataElementRequirement {
  id: string;
  category: UdsRequirementCategory;
  name: string;
  fhirPath: string;
  igProfile: string;
  required: boolean;
  notes: string;
}

export interface UdsRequirementEvaluation {
  requirement: UdsDataElementRequirement;
  availability: UdsAvailability;
  presentCount: number;
  cohortSize: number;
  completenessPct: number;
}

export interface UdsCohortCriteria {
  periodStart: string;
  periodEnd: string;
  minEncounters: number;
  stateFilter: string;
  genderFilter: 'all' | 'male' | 'female' | 'other' | 'unknown';
}

export interface UdsDeidentifiedPatientPreview {
  originalPatientId: string;
  pseudonymId: string;
  dateShiftDays: number;
  before: FhirPatient;
  after: FhirPatient;
  resourceCount: number;
}

export interface UdsValidationFinding {
  id: string;
  patientId: string;
  pseudonymId: string;
  resourceType: string;
  profileUrl: string;
  severity: 'error' | 'warning' | 'information';
  message: string;
  fixActionLabel: string;
}

export interface UdsSubmissionRecord {
  id: string;
  submissionNumber: string;
  createdAt: string;
  reportingPeriod: string;
  cohortSize: number;
  resourceCount: number;
  status: 'Prepared' | 'Submitted' | 'Acknowledged' | 'Rejected' | 'Resubmitted';
  ackId?: string;
  rejectionReason?: string;
  bundleJson: string;
  measureReportId?: string;
}

export interface UdsProfileConfig {
  igVersion: string;
  udsPatientProfile: string;
  usCorePatientProfile: string;
  udsEncounterProfile: string;
  udsConditionProfile: string;
  udsObservationProfile: string;
}

export interface UdsTenantState {
  requirements: UdsDataElementRequirement[];
  profileConfig: UdsProfileConfig;
  criteria: UdsCohortCriteria;
  lastCohortCharts: PatientChartBundle[];
  lastDeidentifiedPreviews: UdsDeidentifiedPatientPreview[];
  lastDeidentifiedBundle?: FhirBundle;
  lastValidationFindings: UdsValidationFinding[];
  submissions: UdsSubmissionRecord[];
}

const DEFAULT_UDS_REQUIREMENTS: UdsDataElementRequirement[] = [
  {
    id: 'uds-req-demo-basic',
    category: 'Demographics',
    name: 'Patient Birth Date, Gender & Generalized ZIP',
    fhirPath: 'Patient.birthDate | Patient.gender | Patient.address.postalCode',
    igProfile: 'uds-plus-patient',
    required: true,
    notes: 'Required for Table 3A/3B age, sex, and geographic reporting.',
  },
  {
    id: 'uds-req-demo-race',
    category: 'Demographics',
    name: 'US Core Race & Ethnicity Extensions',
    fhirPath: 'Patient.extension(us-core-race) | Patient.extension(us-core-ethnicity)',
    igProfile: 'uds-plus-patient',
    required: true,
    notes: 'Required for UDS Table 3B demographic stratification.',
  },
  {
    id: 'uds-req-sdoh',
    category: 'SDOH',
    name: 'Social Determinants of Health (Housing / Income / FPL)',
    fhirPath: 'Observation(category=social-history) | Patient.extension(fpl)',
    igProfile: 'uds-plus-income-observation',
    required: true,
    notes: 'Captures Federal Poverty Level (FPL) and housing status for Table 4.',
  },
  {
    id: 'uds-req-enc',
    category: 'Encounters',
    name: 'Qualifying Clinical Encounters in Measurement Period',
    fhirPath: 'Encounter.period.start | Encounter.class',
    igProfile: 'uds-plus-encounter',
    required: true,
    notes: 'Defines active UDS+ patient cohort for Table 5.',
  },
  {
    id: 'uds-req-diag',
    category: 'Diagnoses',
    name: 'Selected Diagnoses (ICD-10-CM / SNOMED CT)',
    fhirPath: 'Condition.code.coding',
    igProfile: 'uds-plus-diagnosis',
    required: true,
    notes: 'Supports Table 6A clinical diagnosis reporting.',
  },
  {
    id: 'uds-req-labs',
    category: 'Labs',
    name: 'Laboratory Results (LOINC-coded Observations)',
    fhirPath: 'Observation.code.coding(loinc)',
    igProfile: 'uds-plus-observation',
    required: true,
    notes: 'Supports HbA1c, HIV/STI, and infectious disease reporting.',
  },
  {
    id: 'uds-req-vitals',
    category: 'Vitals',
    name: 'Vital Signs (Blood Pressure / BMI)',
    fhirPath: 'Observation.code(8480-6 | 39156-5)',
    igProfile: 'us-core-vital-signs',
    required: false,
    notes: 'Used for Controlling High Blood Pressure (CMS165) and BMI screening.',
  },
  {
    id: 'uds-req-imm',
    category: 'Immunizations',
    name: 'Immunization / Preventive Administration Records',
    fhirPath: 'Procedure.code(33879002) | Immunization',
    igProfile: 'uds-plus-immunization',
    required: false,
    notes: 'Supports Table 6B Childhood Immunization Status.',
  },
  {
    id: 'uds-req-measure',
    category: 'Measure Inputs',
    name: 'eCQM / MeasureReport Summary Denominator Inputs',
    fhirPath: 'MeasureReport.group.population',
    igProfile: 'uds-plus-deidentified-bundle',
    required: true,
    notes: 'Aggregated quality measure inputs for HRSA submission.',
  },
];

const storeByTenant = new Map<string, UdsTenantState>();

// Strictly IN-MEMORY ONLY pseudonym & date-shift mapping. Never persisted or exported.
const ephemeralSessionSalt = `salt-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
const inMemoryPseudonymMap = new Map<
  string,
  { pseudonymId: string; dateShiftDays: number }
>();

let udsSeq = 100;
function nextUdsId(prefix: string): string {
  udsSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${udsSeq}`;
}

function getOrInitState(tenantId: string): UdsTenantState {
  const existing = storeByTenant.get(tenantId);
  if (existing) return existing;

  const initial: UdsTenantState = {
    requirements: DEFAULT_UDS_REQUIREMENTS.map((r) => ({ ...r })),
    profileConfig: {
      igVersion: 'HRSA UDS+ IG v1.1.0 / US Core v6.1.0',
      udsPatientProfile: 'http://fhir.org/guides/hrsa/uds-plus/StructureDefinition/uds-plus-patient',
      usCorePatientProfile: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
      udsEncounterProfile: 'http://fhir.org/guides/hrsa/uds-plus/StructureDefinition/uds-plus-encounter',
      udsConditionProfile: 'http://fhir.org/guides/hrsa/uds-plus/StructureDefinition/uds-plus-diagnosis',
      udsObservationProfile: 'http://fhir.org/guides/hrsa/uds-plus/StructureDefinition/uds-plus-observation',
    },
    criteria: {
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      minEncounters: 0,
      stateFilter: '',
      genderFilter: 'all',
    },
    lastCohortCharts: [],
    lastDeidentifiedPreviews: [],
    lastValidationFindings: [],
    submissions: [],
  };
  storeByTenant.set(tenantId, initial);
  return initial;
}

function deterministicSaltedHash(input: string): string {
  const combined = `${ephemeralSessionSalt}:${input}`;
  let h1 = 0xdeadbeef ^ combined.length;
  let h2 = 0x41c6ce57 ^ combined.length;
  for (let i = 0; i < combined.length; i += 1) {
    const ch = combined.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0')
  ).toUpperCase();
}

function getOrCreatePseudonym(tenantId: string, originalPatientId: string) {
  const key = `${tenantId}::${originalPatientId}`;
  const existing = inMemoryPseudonymMap.get(key);
  if (existing) return existing;

  const hash = deterministicSaltedHash(key);
  const shiftSeed = parseInt(hash.slice(0, 4), 16);
  // Consistent non-zero shift between -21 and +21 days
  let dateShiftDays = (shiftSeed % 41) - 20;
  if (dateShiftDays === 0) dateShiftDays = 7;

  const entry = {
    pseudonymId: `uds-${hash.slice(0, 12).toLowerCase()}`,
    dateShiftDays,
  };
  inMemoryPseudonymMap.set(key, entry);
  return entry;
}

function shiftIsoDate(dateStr: string | undefined, shiftDays: number): string | undefined {
  if (!dateStr) return dateStr;
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  const shifted = new Date(parsed.getTime() + shiftDays * 86_400_000);
  if (dateStr.length <= 10) {
    return shifted.toISOString().slice(0, 10);
  }
  return shifted.toISOString();
}

const LOW_POP_ZIP3 = new Set([
  '036', '059', '063', '102', '203', '556', '692', '790', '821', '823', '830', '831', '878', '879', '884', '890', '893',
]);

function generalizeZip(zip?: string): string | undefined {
  if (!zip) return undefined;
  const digits = zip.replace(/\D/g, '');
  if (digits.length < 3) return '00000';
  const prefix3 = digits.slice(0, 3);
  return LOW_POP_ZIP3.has(prefix3) ? '00000' : `${prefix3}00`;
}

function deidentifyPatientResource(
  patient: FhirPatient,
  pseudonymId: string,
  dateShiftDays: number,
  profileUrls: string[],
): FhirPatient {
  const safeExtensions = (patient.extension ?? []).filter(
    (e) =>
      !e.url.toLowerCase().includes('ssn') &&
      !e.url.toLowerCase().includes('tax') &&
      !e.url.toLowerCase().includes('mrn'),
  );

  const safeAddress = (patient.address ?? []).map((a) => ({
    state: a.state,
    postalCode: generalizeZip(a.postalCode),
    country: a.country ?? 'US',
  }));

  return {
    resourceType: 'Patient',
    id: pseudonymId,
    meta: {
      profile: profileUrls,
      tag: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationValue',
          code: 'PSEUDED',
          display: 'pseudonymized',
        },
      ],
    },
    active: patient.active ?? true,
    gender: patient.gender,
    birthDate: shiftIsoDate(patient.birthDate, dateShiftDays),
    address: safeAddress.length > 0 ? safeAddress : undefined,
    extension: safeExtensions.length > 0 ? safeExtensions : undefined,
  };
}

function rewritePatientReference(
  ref: { reference?: string; display?: string } | undefined,
  pseudonymId: string,
): { reference: string } | undefined {
  if (!ref) return undefined;
  return { reference: `Patient/${pseudonymId}` };
}

function evaluateSingleRequirement(
  req: UdsDataElementRequirement,
  charts: PatientChartBundle[],
): UdsRequirementEvaluation {
  const cohortSize = charts.length;
  if (cohortSize === 0) {
    return {
      requirement: req,
      availability: 'Missing',
      presentCount: 0,
      cohortSize: 0,
      completenessPct: 0,
    };
  }

  let presentCount = 0;
  for (const ch of charts) {
    const p = ch.patient.resource;
    let hasIt = false;
    switch (req.id) {
      case 'uds-req-demo-basic':
        hasIt = Boolean(p.birthDate && p.gender && p.address?.[0]?.state);
        break;
      case 'uds-req-demo-race':
        hasIt = Boolean(
          p.extension?.some(
            (e) => e.url.includes('us-core-race') || e.url.includes('us-core-ethnicity'),
          ),
        );
        break;
      case 'uds-req-sdoh':
        hasIt = ch.observations.some((o) =>
          o.category?.some((c) =>
            c.coding?.some((cd) => cd.code === 'social-history'),
          ),
        );
        break;
      case 'uds-req-enc':
        hasIt = ch.encounters.length > 0;
        break;
      case 'uds-req-diag':
        hasIt = ch.conditions.length > 0;
        break;
      case 'uds-req-labs':
        hasIt = ch.observations.some((o) =>
          o.code?.coding?.some((cd) => cd.system?.includes('loinc')),
        );
        break;
      case 'uds-req-vitals':
        hasIt = ch.observations.some((o) =>
          o.code?.coding?.some((cd) => cd.code === '8480-6' || cd.code === '39156-5'),
        );
        break;
      case 'uds-req-imm':
        hasIt = ch.procedures.some((pr) =>
          pr.code?.coding?.some((cd) => cd.code === '33879002'),
        );
        break;
      case 'uds-req-measure':
        hasIt = ch.encounters.length > 0 || ch.conditions.length > 0;
        break;
      default:
        // Custom user-added IG requirement: heuristic check on FHIR path prefix
        if (req.fhirPath.startsWith('Patient')) hasIt = Boolean(p.birthDate);
        else if (req.fhirPath.startsWith('Encounter')) hasIt = ch.encounters.length > 0;
        else if (req.fhirPath.startsWith('Condition')) hasIt = ch.conditions.length > 0;
        else if (req.fhirPath.startsWith('Observation')) hasIt = ch.observations.length > 0;
        else hasIt = ch.procedures.length > 0;
        break;
    }
    if (hasIt) presentCount += 1;
  }

  const pct = Math.round((presentCount / cohortSize) * 100);
  const availability: UdsAvailability =
    pct === 100 ? 'Present' : pct > 0 ? 'Partial' : 'Missing';

  return {
    requirement: req,
    availability,
    presentCount,
    cohortSize,
    completenessPct: pct,
  };
}

export const udsService = {
  getState(tenantId: string): UdsTenantState {
    return getOrInitState(tenantId);
  },

  resetForTests(): void {
    storeByTenant.clear();
    inMemoryPseudonymMap.clear();
  },

  getInMemoryPseudonymCount(): number {
    return inMemoryPseudonymMap.size;
  },

  addRequirement(
    tenantId: string,
    input: Omit<UdsDataElementRequirement, 'id'>,
  ): UdsDataElementRequirement {
    if (!input.name.trim() || !input.fhirPath.trim()) {
      throw new AppError({
        message: 'Requirement name and FHIR path are required.',
        statusCode: 400,
        code: 'INVALID_REQUIREMENT',
      });
    }
    const state = getOrInitState(tenantId);
    const created: UdsDataElementRequirement = { ...input, id: nextUdsId('uds-req') };
    state.requirements.push(created);
    return created;
  },

  updateRequirement(
    tenantId: string,
    reqId: string,
    patch: Partial<Omit<UdsDataElementRequirement, 'id'>>,
  ): UdsDataElementRequirement {
    const state = getOrInitState(tenantId);
    const target = state.requirements.find((r) => r.id === reqId);
    if (!target) {
      throw new AppError({ message: 'Requirement not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    Object.assign(target, patch);
    return target;
  },

  deleteRequirement(tenantId: string, reqId: string): void {
    const state = getOrInitState(tenantId);
    state.requirements = state.requirements.filter((r) => r.id !== reqId);
  },

  updateProfileConfig(
    tenantId: string,
    patch: Partial<UdsProfileConfig>,
  ): UdsProfileConfig {
    const state = getOrInitState(tenantId);
    Object.assign(state.profileConfig, patch);
    return state.profileConfig;
  },

  async buildCohort(
    ctx: FhirRequestContext,
    criteria: UdsCohortCriteria,
  ): Promise<{
    charts: PatientChartBundle[];
    evaluations: UdsRequirementEvaluation[];
    overallCompletenessPct: number;
  }> {
    const state = getOrInitState(ctx.tenantId);
    state.criteria = { ...criteria };
    const allPatients = await patientService.listPatients(ctx);
    const matchedCharts: PatientChartBundle[] = [];

    for (const pat of allPatients) {
      if (criteria.genderFilter !== 'all' && pat.gender !== criteria.genderFilter) continue;
      if (
        criteria.stateFilter.trim() &&
        pat.state.toLowerCase() !== criteria.stateFilter.trim().toLowerCase()
      ) {
        continue;
      }
      const chart = await patientService.getPatientChart(ctx, pat.id);
      const inPeriodEncounters = chart.encounters.filter((e) => {
        const d = (e.period?.start ?? '').slice(0, 10);
        if (!d) return true;
        return d >= criteria.periodStart && d <= criteria.periodEnd;
      });
      if (inPeriodEncounters.length < criteria.minEncounters) continue;
      matchedCharts.push(chart);
    }

    state.lastCohortCharts = matchedCharts;
    const evaluations = state.requirements.map((r) =>
      evaluateSingleRequirement(r, matchedCharts),
    );
    const overallCompletenessPct =
      evaluations.length > 0
        ? Math.round(
            evaluations.reduce((sum, e) => sum + e.completenessPct, 0) / evaluations.length,
          )
        : 0;

    return { charts: matchedCharts, evaluations, overallCompletenessPct };
  },

  evaluateRequirementsForCharts(
    tenantId: string,
    charts: PatientChartBundle[],
  ): { evaluations: UdsRequirementEvaluation[]; overallCompletenessPct: number } {
    const state = getOrInitState(tenantId);
    const evaluations = state.requirements.map((r) => evaluateSingleRequirement(r, charts));
    const overallCompletenessPct =
      evaluations.length > 0
        ? Math.round(
            evaluations.reduce((sum, e) => sum + e.completenessPct, 0) / evaluations.length,
          )
        : 0;
    return { evaluations, overallCompletenessPct };
  },

  deidentifyCohort(tenantId: string): {
    previews: UdsDeidentifiedPatientPreview[];
    bundle: FhirBundle;
  } {
    const state = getOrInitState(tenantId);
    if (state.lastCohortCharts.length === 0) {
      throw new AppError({
        message: 'Build a UDS+ cohort before running de-identification.',
        statusCode: 400,
        code: 'EMPTY_COHORT',
      });
    }

    const previews: UdsDeidentifiedPatientPreview[] = [];
    const entries: NonNullable<FhirBundle['entry']> = [];
    const cfg = state.profileConfig;

    for (const ch of state.lastCohortCharts) {
      const { pseudonymId, dateShiftDays } = getOrCreatePseudonym(tenantId, ch.patient.id);
      const safePat = deidentifyPatientResource(ch.patient.resource, pseudonymId, dateShiftDays, [
        cfg.udsPatientProfile,
        cfg.usCorePatientProfile,
      ]);

      entries.push({ fullUrl: `urn:uuid:${pseudonymId}`, resource: safePat });
      let countForPatient = 1;

      for (const enc of ch.encounters) {
        const encId = `${pseudonymId}-enc-${countForPatient}`;
        entries.push({
          fullUrl: `urn:uuid:${encId}`,
          resource: {
            ...enc,
            id: encId,
            identifier: undefined,
            meta: { profile: [cfg.udsEncounterProfile] },
            subject: rewritePatientReference(enc.subject, pseudonymId),
            participant: undefined,
            period: enc.period
              ? {
                  start: shiftIsoDate(enc.period.start, dateShiftDays),
                  end: shiftIsoDate(enc.period.end, dateShiftDays),
                }
              : undefined,
          },
        });
        countForPatient += 1;
      }

      for (const cond of ch.conditions) {
        const condId = `${pseudonymId}-cond-${countForPatient}`;
        entries.push({
          fullUrl: `urn:uuid:${condId}`,
          resource: {
            ...cond,
            id: condId,
            identifier: undefined,
            meta: { profile: [cfg.udsConditionProfile] },
            subject: { reference: `Patient/${pseudonymId}` },
            encounter: undefined,
            onsetDateTime: shiftIsoDate(cond.onsetDateTime, dateShiftDays),
            recordedDate: shiftIsoDate(cond.recordedDate, dateShiftDays),
          },
        });
        countForPatient += 1;
      }

      for (const obs of ch.observations) {
        const obsId = `${pseudonymId}-obs-${countForPatient}`;
        entries.push({
          fullUrl: `urn:uuid:${obsId}`,
          resource: {
            ...obs,
            id: obsId,
            identifier: undefined,
            meta: { profile: [cfg.udsObservationProfile] },
            subject: rewritePatientReference(obs.subject, pseudonymId),
            encounter: undefined,
            effectiveDateTime: shiftIsoDate(obs.effectiveDateTime, dateShiftDays),
            issued: shiftIsoDate(obs.issued, dateShiftDays),
          },
        });
        countForPatient += 1;
      }

      previews.push({
        originalPatientId: ch.patient.id,
        pseudonymId,
        dateShiftDays,
        before: ch.patient.resource,
        after: safePat,
        resourceCount: countForPatient,
      });
    }

    const measureReport: FhirMeasureReport = {
      resourceType: 'MeasureReport',
      id: nextUdsId('mr-uds'),
      status: 'complete',
      type: 'summary',
      measure: 'http://fhir.org/guides/hrsa/uds-plus/Measure/uds-plus-patient-summary',
      date: new Date().toISOString(),
      period: {
        start: state.criteria.periodStart,
        end: state.criteria.periodEnd,
      },
      group: [
        {
          code: { text: 'UDS+ De-Identified Cohort Summary' },
          population: [
            {
              code: { coding: [{ code: 'initial-population', display: 'Initial Population' }] },
              count: previews.length,
            },
          ],
        },
      ],
    };

    entries.unshift({
      fullUrl: `urn:uuid:${measureReport.id}`,
      resource: measureReport,
    });

    const bundle: FhirBundle = {
      resourceType: 'Bundle',
      id: nextUdsId('bundle-uds'),
      meta: {
        profile: ['http://fhir.org/guides/hrsa/uds-plus/StructureDefinition/uds-plus-deidentified-bundle'],
        lastUpdated: new Date().toISOString(),
      },
      type: 'collection',
      timestamp: new Date().toISOString(),
      total: entries.length,
      entry: entries,
    };

    state.lastDeidentifiedPreviews = previews;
    state.lastDeidentifiedBundle = bundle;
    return { previews, bundle };
  },

  async validateCohortAgainstProfiles(
    ctx: FhirRequestContext,
  ): Promise<{ findings: UdsValidationFinding[]; passedCount: number; errorCount: number; warningCount: number }> {
    const state = getOrInitState(ctx.tenantId);
    if (!state.lastDeidentifiedBundle) {
      this.deidentifyCohort(ctx.tenantId);
    }

    const client = getFhirClient();
    const findings: UdsValidationFinding[] = [];
    let passedCount = 0;

    for (const preview of state.lastDeidentifiedPreviews) {
      const profileUrl = state.profileConfig.udsPatientProfile;
      const outcome = await client.operation<FhirOperationOutcome>(ctx, '$validate', {
        resourceType: 'Patient',
        resource: preview.after as FhirResource,
        params: { profile: profileUrl },
      });

      const hasOpError = (outcome.issue ?? []).some(
        (i) => i.severity === 'error' || i.severity === 'fatal',
      );
      if (hasOpError) {
        for (const issue of outcome.issue ?? []) {
          findings.push({
            id: nextUdsId('val'),
            patientId: preview.originalPatientId,
            pseudonymId: preview.pseudonymId,
            resourceType: 'Patient',
            profileUrl,
            severity: issue.severity === 'fatal' ? 'error' : issue.severity,
            message: issue.diagnostics ?? 'FHIR $validate error',
            fixActionLabel: 'Fix Patient in M4',
          });
        }
      } else {
        passedCount += 1;
      }

      // Check UDS+ IG specific required elements (US Core Race/Ethnicity, postalCode)
      const hasRaceExt = (preview.after.extension ?? []).some((e) =>
        e.url.includes('us-core-race'),
      );
      if (!hasRaceExt) {
        findings.push({
          id: nextUdsId('val'),
          patientId: preview.originalPatientId,
          pseudonymId: preview.pseudonymId,
          resourceType: 'Patient',
          profileUrl: state.profileConfig.usCorePatientProfile,
          severity: 'warning',
          message: 'Missing us-core-race / us-core-ethnicity extension required by UDS+ Table 3B.',
          fixActionLabel: 'Add Demographics in M4',
        });
      }
      if (!preview.after.address?.[0]?.postalCode) {
        findings.push({
          id: nextUdsId('val'),
          patientId: preview.originalPatientId,
          pseudonymId: preview.pseudonymId,
          resourceType: 'Patient',
          profileUrl,
          severity: 'warning',
          message: 'Missing generalized 3-digit postalCode required for geographic stratification.',
          fixActionLabel: 'Add ZIP in M4',
        });
      }
    }

    state.lastValidationFindings = findings;
    return {
      findings,
      passedCount,
      errorCount: findings.filter((f) => f.severity === 'error').length,
      warningCount: findings.filter((f) => f.severity === 'warning').length,
    };
  },

  async submitDeidentifiedBundle(
    ctx: FhirRequestContext,
    actor: { name: string; role: RoleName },
    options?: { simulateRejection?: boolean },
  ): Promise<UdsSubmissionRecord> {
    const state = getOrInitState(ctx.tenantId);
    if (!state.lastDeidentifiedBundle) {
      this.deidentifyCohort(ctx.tenantId);
    }

    const bundle = state.lastDeidentifiedBundle!;
    const client = getFhirClient();
    const mrEntry = bundle.entry?.find((e) => e.resource?.resourceType === 'MeasureReport');
    let savedMrId: string | undefined;
    if (mrEntry?.resource) {
      const saved = await client.create<FhirMeasureReport>(
        ctx,
        mrEntry.resource as FhirMeasureReport,
      );
      savedMrId = saved.id;
    }

    const now = new Date().toISOString();
    const record: UdsSubmissionRecord = {
      id: nextUdsId('sub-uds'),
      submissionNumber: `UDS-${new Date().getFullYear()}-${String(state.submissions.length + 1).padStart(3, '0')}`,
      createdAt: now,
      reportingPeriod: `${state.criteria.periodStart} to ${state.criteria.periodEnd}`,
      cohortSize: state.lastDeidentifiedPreviews.length,
      resourceCount: bundle.entry?.length ?? 0,
      status: options?.simulateRejection ? 'Rejected' : 'Acknowledged',
      ackId: options?.simulateRejection ? undefined : `HRSA-ACK-${nextUdsId('ok').toUpperCase()}`,
      rejectionReason: options?.simulateRejection
        ? 'HRSA Stub Rejection: 1 or more Patient records missing US Core Race extension.'
        : undefined,
      bundleJson: JSON.stringify(bundle, null, 2),
      measureReportId: savedMrId,
    };

    state.submissions.unshift(record);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'MeasureReport',
      resourceId: savedMrId,
      outcomeDesc: `UDS+ submission ${record.submissionNumber} (${record.status}) — ${record.cohortSize} de-identified patients`,
    });

    return record;
  },

  resubmitBundle(
    tenantId: string,
    submissionId: string,
  ): UdsSubmissionRecord {
    const state = getOrInitState(tenantId);
    const sub = state.submissions.find((s) => s.id === submissionId);
    if (!sub) {
      throw new AppError({ message: 'Submission record not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    sub.status = 'Resubmitted';
    sub.ackId = `HRSA-RESUB-${nextUdsId('ok').toUpperCase()}`;
    sub.rejectionReason = undefined;
    return sub;
  },
};
