import { eventBus } from '../../events';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { auditService } from '../../services/auditService';
import { settingsService } from '../../services/settingsService';
import {
  AppError,
  type FhirBundle,
  type FhirComposition,
  type FhirCondition,
  type FhirDocumentReference,
  type FhirEncounter,
  type FhirMedicationRequest,
  type FhirObservation,
  type FhirOperationOutcome,
  type FhirPatient,
  type RoleName,
} from '../../types';
import { patientService, type PatientChartBundle } from '../m4-patients/patientService';

export type EcrTriggerCodeSystem = 'SNOMED' | 'LOINC' | 'ICD-10-CM' | 'RxNorm';

export interface EcrTriggerCode {
  id: string;
  system: string;
  systemLabel: EcrTriggerCodeSystem;
  code: string;
  display: string;
  conditionGroup: string;
  resourceTypes: Array<'Condition' | 'Observation' | 'Encounter' | 'MedicationRequest'>;
  requiresPositiveResult?: boolean;
  active: boolean;
}

export interface EcrTriggerValueSet {
  version: string;
  effectiveDate: string;
  lastUpdated: string;
  codes: EcrTriggerCode[];
}

export type EcrCaseStatus =
  | 'Triggered'
  | 'Data retrieved'
  | 'eICR created'
  | 'Submitted'
  | 'Acknowledged'
  | 'RR received'
  | 'Closed';

export type ReportabilityDetermination =
  | 'Reportable'
  | 'May be reportable'
  | 'Not reportable';

export interface EcrTriggerLogEntry {
  id: string;
  timestamp: string;
  patientId: string;
  patientName: string;
  sourceResourceType: 'Condition' | 'Observation' | 'Encounter' | 'MedicationRequest' | 'PatientChart';
  sourceResourceId: string;
  matchedCode: string;
  matchedDisplay: string;
  conditionGroup: string;
  triggered: boolean;
  caseId?: string;
}

export interface ReportabilityResponseRecord {
  id: string;
  receivedAt: string;
  determination: ReportabilityDetermination;
  jurisdiction: string;
  ruleSummary: string;
  documentReferenceId?: string;
  phaReviewer?: string;
}

export interface EcrCaseRecord {
  id: string;
  caseNumber: string;
  tenantId: string;
  patientId: string;
  patientName: string;
  mrn: string;
  conditionGroup: string;
  matchedTriggers: string[];
  status: EcrCaseStatus;
  versionNumber: number;
  createdAt: string;
  updatedAt: string;
  eicrBundle?: FhirBundle;
  validationOutcome?: FhirOperationOutcome;
  validationPassed?: boolean;
  submissionAckId?: string;
  submittedVia?: 'eCRNow Live' | 'eCRNow Built-in Stub';
  fallbackWarning?: string;
  reportabilityResponse?: ReportabilityResponseRecord;
  phaStatus: 'Not Submitted' | 'Pending PHA Review' | 'Accepted' | 'Rejected';
  phaNotes?: string;
  history: Array<{ timestamp: string; status: EcrCaseStatus; note: string; actor: string }>;
}

export interface EcrNowAdapterConfig {
  enabledLive: boolean;
  baseUrl: string;
  triggerPath: string;
  submitPath: string;
  statusPath: string;
  defaultJurisdiction: string;
}

export interface EcrTenantState {
  valueSet: EcrTriggerValueSet;
  adapterConfig: EcrNowAdapterConfig;
  triggerLog: EcrTriggerLogEntry[];
  cases: EcrCaseRecord[];
}

const DEFAULT_TRIGGER_CODES: EcrTriggerCode[] = [
  {
    id: 'trig-covid-snomed',
    system: 'http://snomed.info/sct',
    systemLabel: 'SNOMED',
    code: '840539006',
    display: 'Disease caused by severe acute respiratory syndrome coronavirus 2 (COVID-19)',
    conditionGroup: 'COVID-19',
    resourceTypes: ['Condition', 'Encounter'],
    active: true,
  },
  {
    id: 'trig-covid-loinc',
    system: 'http://loinc.org',
    systemLabel: 'LOINC',
    code: '94500-6',
    display: 'SARS-CoV-2 RNA [Presence] in Respiratory specimen by NAA with probe detection',
    conditionGroup: 'COVID-19',
    resourceTypes: ['Observation'],
    requiresPositiveResult: true,
    active: true,
  },
  {
    id: 'trig-covid-icd10',
    system: 'http://hl7.org/fhir/sid/icd-10-cm',
    systemLabel: 'ICD-10-CM',
    code: 'U07.1',
    display: 'COVID-19, virus identified',
    conditionGroup: 'COVID-19',
    resourceTypes: ['Condition', 'Encounter'],
    active: true,
  },
  {
    id: 'trig-chlamydia-snomed',
    system: 'http://snomed.info/sct',
    systemLabel: 'SNOMED',
    code: '240589008',
    display: 'Chlamydia trachomatis infection',
    conditionGroup: 'Chlamydia',
    resourceTypes: ['Condition'],
    active: true,
  },
  {
    id: 'trig-chlamydia-loinc',
    system: 'http://loinc.org',
    systemLabel: 'LOINC',
    code: '21613-5',
    display: 'Chlamydia trachomatis DNA [Presence] in Specimen by NAA',
    conditionGroup: 'Chlamydia',
    resourceTypes: ['Observation'],
    requiresPositiveResult: true,
    active: true,
  },
  {
    id: 'trig-chlamydia-icd10',
    system: 'http://hl7.org/fhir/sid/icd-10-cm',
    systemLabel: 'ICD-10-CM',
    code: 'A56.00',
    display: 'Chlamydial infection of lower genitourinary tract, unspecified',
    conditionGroup: 'Chlamydia',
    resourceTypes: ['Condition'],
    active: true,
  },
  {
    id: 'trig-hepc-snomed',
    system: 'http://snomed.info/sct',
    systemLabel: 'SNOMED',
    code: '50711007',
    display: 'Viral hepatitis C',
    conditionGroup: 'Hepatitis C',
    resourceTypes: ['Condition'],
    active: true,
  },
  {
    id: 'trig-hepc-loinc',
    system: 'http://loinc.org',
    systemLabel: 'LOINC',
    code: '16128-1',
    display: 'Hepatitis C virus Ab [Presence] in Serum',
    conditionGroup: 'Hepatitis C',
    resourceTypes: ['Observation'],
    requiresPositiveResult: true,
    active: true,
  },
  {
    id: 'trig-hepc-icd10',
    system: 'http://hl7.org/fhir/sid/icd-10-cm',
    systemLabel: 'ICD-10-CM',
    code: 'B18.2',
    display: 'Chronic viral hepatitis C',
    conditionGroup: 'Hepatitis C',
    resourceTypes: ['Condition'],
    active: true,
  },
  {
    id: 'trig-measles-snomed',
    system: 'http://snomed.info/sct',
    systemLabel: 'SNOMED',
    code: '14189004',
    display: 'Measles (rubeola)',
    conditionGroup: 'Measles',
    resourceTypes: ['Condition'],
    active: true,
  },
  {
    id: 'trig-measles-loinc',
    system: 'http://loinc.org',
    systemLabel: 'LOINC',
    code: '5244-9',
    display: 'Measles virus IgM Ab [Presence] in Serum',
    conditionGroup: 'Measles',
    resourceTypes: ['Observation'],
    requiresPositiveResult: true,
    active: true,
  },
  {
    id: 'trig-measles-icd10',
    system: 'http://hl7.org/fhir/sid/icd-10-cm',
    systemLabel: 'ICD-10-CM',
    code: 'B05.9',
    display: 'Measles without complication',
    conditionGroup: 'Measles',
    resourceTypes: ['Condition'],
    active: true,
  },
];

const storeByTenant = new Map<string, EcrTenantState>();
let seqCounter = 100;

function nextId(prefix: string): string {
  seqCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${seqCounter}`;
}

function getOrInitState(tenantId: string): EcrTenantState {
  const existing = storeByTenant.get(tenantId);
  if (existing) return existing;

  const settings = settingsService.load();
  const initial: EcrTenantState = {
    valueSet: {
      version: '2026.1.0-RCTC',
      effectiveDate: '2026-01-01',
      lastUpdated: '2026-03-01',
      codes: DEFAULT_TRIGGER_CODES.map((c) => ({ ...c, resourceTypes: [...c.resourceTypes] })),
    },
    adapterConfig: {
      enabledLive: false,
      baseUrl: settings.ecrNowBaseUrl || 'http://localhost:8080',
      triggerPath: '/api/launchPatient',
      submitPath: '/api/eicr',
      statusPath: '/api/eicr/status',
      defaultJurisdiction: 'State Department of Health (Synthetic PHA)',
    },
    triggerLog: [],
    cases: [],
  };
  storeByTenant.set(tenantId, initial);
  return initial;
}

function isObservationPositive(obs: FhirObservation): boolean {
  const code = obs.valueCodeableConcept?.coding?.[0]?.code ?? '';
  const text = (
    obs.valueCodeableConcept?.text ??
    obs.valueCodeableConcept?.coding?.[0]?.display ??
    obs.valueString ??
    ''
  ).toLowerCase();

  if (code === '260373001' || code === '10828004' || code === '11214006') {
    return true;
  }
  if (
    text.includes('detected') ||
    text.includes('positive') ||
    text.includes('reactive')
  ) {
    return !text.includes('not detected') && !text.includes('negative') && !text.includes('non-reactive');
  }
  return false;
}

function extractCodesFromResource(
  resource: FhirCondition | FhirObservation | FhirEncounter | FhirMedicationRequest,
): Array<{ code: string; display: string }> {
  const out: Array<{ code: string; display: string }> = [];
  if (resource.resourceType === 'Condition' || resource.resourceType === 'Observation') {
    for (const c of resource.code?.coding ?? []) {
      if (c.code) out.push({ code: c.code, display: c.display ?? resource.code?.text ?? c.code });
    }
  } else if (resource.resourceType === 'Encounter') {
    for (const rc of resource.reasonCode ?? []) {
      for (const c of rc.coding ?? []) {
        if (c.code) out.push({ code: c.code, display: c.display ?? rc.text ?? c.code });
      }
    }
  } else if (resource.resourceType === 'MedicationRequest') {
    for (const c of resource.medicationCodeableConcept?.coding ?? []) {
      if (c.code) {
        out.push({
          code: c.code,
          display: c.display ?? resource.medicationCodeableConcept?.text ?? c.code,
        });
      }
    }
  }
  return out;
}

function buildEicrDocumentBundle(
  chart: PatientChartBundle,
  ecrCase: EcrCaseRecord,
): FhirBundle {
  const now = new Date().toISOString();
  const compId = `comp-eicr-${ecrCase.id}-v${ecrCase.versionNumber}`;
  const patRef = `Patient/${chart.patient.id}`;
  const primaryEnc = chart.encounters[0];

  const composition: FhirComposition = {
    resourceType: 'Composition',
    id: compId,
    meta: {
      profile: ['http://hl7.org/fhir/us/ecr/StructureDefinition/eicr-composition'],
    },
    identifier: {
      system: 'urn:providerlink:eicr:set-id',
      value: `${ecrCase.caseNumber}-v${ecrCase.versionNumber}`,
    },
    status: 'final',
    type: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '55751-2',
          display: 'Public health Case report',
        },
      ],
      text: 'Electronic Initial Case Report (eICR)',
    },
    subject: { reference: patRef, display: chart.patient.fullName },
    encounter: primaryEnc?.id ? { reference: `Encounter/${primaryEnc.id}` } : undefined,
    date: now,
    author: [{ display: 'ProviderLink eCR Engine (Synthetic EHR)' }],
    title: `Initial Public Health Case Report — ${ecrCase.conditionGroup} (v${ecrCase.versionNumber})`,
    section: [
      {
        title: 'Reason for Visit',
        code: {
          coding: [{ system: 'http://loinc.org', code: '29299-5', display: 'Reason for visit Narrative' }],
        },
        text: {
          status: 'generated',
          div: `<div xmlns="http://www.w3.org/1999/xhtml">Reportable trigger detected for ${ecrCase.conditionGroup}: ${ecrCase.matchedTriggers.join('; ')}</div>`,
        },
        entry: primaryEnc?.id ? [{ reference: `Encounter/${primaryEnc.id}` }] : undefined,
      },
      {
        title: 'Problems',
        code: {
          coding: [{ system: 'http://loinc.org', code: '11450-4', display: 'Problem list - Reported' }],
        },
        text: {
          status: 'generated',
          div: `<div xmlns="http://www.w3.org/1999/xhtml">${chart.conditions.length} active condition(s) included.</div>`,
        },
        entry: chart.conditions
          .filter((c) => c.id)
          .map((c) => ({ reference: `Condition/${c.id}` })),
      },
      {
        title: 'Results',
        code: {
          coding: [{ system: 'http://loinc.org', code: '30954-2', display: 'Relevant diagnostic tests/laboratory data' }],
        },
        text: {
          status: 'generated',
          div: `<div xmlns="http://www.w3.org/1999/xhtml">${chart.observations.length} laboratory/clinical observation(s) included.</div>`,
        },
        entry: chart.observations
          .filter((o) => o.id)
          .map((o) => ({ reference: `Observation/${o.id}` })),
      },
      {
        title: 'Encounters',
        code: {
          coding: [{ system: 'http://loinc.org', code: '46240-8', display: 'History of hospitalizations+Outpatient visits' }],
        },
        text: {
          status: 'generated',
          div: `<div xmlns="http://www.w3.org/1999/xhtml">${chart.encounters.length} encounter(s) included.</div>`,
        },
        entry: chart.encounters
          .filter((e) => e.id)
          .map((e) => ({ reference: `Encounter/${e.id}` })),
      },
    ],
  };

  const entries: NonNullable<FhirBundle['entry']> = [
    { fullUrl: `urn:uuid:${compId}`, resource: composition },
    { fullUrl: `urn:uuid:patient-${chart.patient.id}`, resource: chart.patient.resource },
    ...chart.encounters.map((e) => ({
      fullUrl: `urn:uuid:encounter-${e.id ?? nextId('enc')}`,
      resource: e,
    })),
    ...chart.conditions.map((c) => ({
      fullUrl: `urn:uuid:condition-${c.id ?? nextId('cond')}`,
      resource: c,
    })),
    ...chart.observations.map((o) => ({
      fullUrl: `urn:uuid:observation-${o.id ?? nextId('obs')}`,
      resource: o,
    })),
    ...chart.medications.map((m) => ({
      fullUrl: `urn:uuid:med-${m.id ?? nextId('med')}`,
      resource: m,
    })),
  ];

  return {
    resourceType: 'Bundle',
    id: `bundle-eicr-${ecrCase.id}-v${ecrCase.versionNumber}`,
    meta: {
      profile: ['http://hl7.org/fhir/us/ecr/StructureDefinition/eicr-document-bundle'],
      lastUpdated: now,
    },
    type: 'document',
    timestamp: now,
    entry: entries,
  };
}

export const ecrService = {
  getState(tenantId: string): EcrTenantState {
    return getOrInitState(tenantId);
  },

  resetForTests(): void {
    storeByTenant.clear();
  },

  addTriggerCode(
    tenantId: string,
    input: Omit<EcrTriggerCode, 'id'>,
  ): EcrTriggerCode {
    if (!input.code.trim() || !input.display.trim()) {
      throw new AppError({
        message: 'Trigger code and display are required.',
        statusCode: 400,
        code: 'INVALID_TRIGGER_CODE',
      });
    }
    const state = getOrInitState(tenantId);
    const created: EcrTriggerCode = {
      ...input,
      id: nextId('trig'),
      code: input.code.trim(),
      display: input.display.trim(),
      conditionGroup: input.conditionGroup.trim() || 'General Reportable',
    };
    state.valueSet.codes.unshift(created);
    state.valueSet.lastUpdated = new Date().toISOString().slice(0, 10);
    return created;
  },

  updateTriggerCode(
    tenantId: string,
    codeId: string,
    patch: Partial<Omit<EcrTriggerCode, 'id'>>,
  ): EcrTriggerCode {
    const state = getOrInitState(tenantId);
    const target = state.valueSet.codes.find((c) => c.id === codeId);
    if (!target) {
      throw new AppError({ message: 'Trigger code not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    Object.assign(target, patch);
    state.valueSet.lastUpdated = new Date().toISOString().slice(0, 10);
    return target;
  },

  deleteTriggerCode(tenantId: string, codeId: string): void {
    const state = getOrInitState(tenantId);
    state.valueSet.codes = state.valueSet.codes.filter((c) => c.id !== codeId);
    state.valueSet.lastUpdated = new Date().toISOString().slice(0, 10);
  },

  updateValueSetMetadata(
    tenantId: string,
    patch: Partial<Pick<EcrTriggerValueSet, 'version' | 'effectiveDate'>>,
  ): EcrTriggerValueSet {
    const state = getOrInitState(tenantId);
    if (patch.version) state.valueSet.version = patch.version.trim();
    if (patch.effectiveDate) state.valueSet.effectiveDate = patch.effectiveDate;
    state.valueSet.lastUpdated = new Date().toISOString().slice(0, 10);
    return state.valueSet;
  },

  updateAdapterConfig(
    tenantId: string,
    patch: Partial<EcrNowAdapterConfig>,
  ): EcrNowAdapterConfig {
    const state = getOrInitState(tenantId);
    Object.assign(state.adapterConfig, patch);
    return state.adapterConfig;
  },

  async evaluatePatientTriggers(
    ctx: FhirRequestContext,
    patientId: string,
    actor: { name: string; role: RoleName },
  ): Promise<{ triggered: boolean; logEntries: EcrTriggerLogEntry[]; createdCase?: EcrCaseRecord }> {
    const state = getOrInitState(ctx.tenantId);
    const chart = await patientService.getPatientChart(ctx, patientId);
    const activeCodes = state.valueSet.codes.filter((c) => c.active);
    const now = new Date().toISOString();

    const resourcesToCheck: Array<
      FhirCondition | FhirObservation | FhirEncounter | FhirMedicationRequest
    > = [
      ...chart.conditions,
      ...chart.observations,
      ...chart.encounters,
      ...chart.medications,
    ];

    const matchedLabels: string[] = [];
    const matchedGroups = new Set<string>();
    const newLogs: EcrTriggerLogEntry[] = [];

    for (const res of resourcesToCheck) {
      const codes = extractCodesFromResource(res);
      for (const found of codes) {
        const trigger = activeCodes.find(
          (t) =>
            t.code.toLowerCase() === found.code.toLowerCase() &&
            t.resourceTypes.includes(res.resourceType),
        );
        if (!trigger) continue;

        if (
          res.resourceType === 'Observation' &&
          trigger.requiresPositiveResult &&
          !isObservationPositive(res)
        ) {
          newLogs.push({
            id: nextId('tlog'),
            timestamp: now,
            patientId: chart.patient.id,
            patientName: chart.patient.fullName,
            sourceResourceType: 'Observation',
            sourceResourceId: res.id ?? 'unknown',
            matchedCode: trigger.code,
            matchedDisplay: `${trigger.display} (Non-positive result — suppressed)`,
            conditionGroup: trigger.conditionGroup,
            triggered: false,
          });
          continue;
        }

        matchedGroups.add(trigger.conditionGroup);
        matchedLabels.push(`${res.resourceType} ${trigger.systemLabel}:${trigger.code} (${trigger.conditionGroup})`);
        newLogs.push({
          id: nextId('tlog'),
          timestamp: now,
          patientId: chart.patient.id,
          patientName: chart.patient.fullName,
          sourceResourceType: res.resourceType,
          sourceResourceId: res.id ?? 'unknown',
          matchedCode: trigger.code,
          matchedDisplay: trigger.display,
          conditionGroup: trigger.conditionGroup,
          triggered: true,
        });
      }
    }

    if (matchedLabels.length === 0) {
      const noMatchLog: EcrTriggerLogEntry = {
        id: nextId('tlog'),
        timestamp: now,
        patientId: chart.patient.id,
        patientName: chart.patient.fullName,
        sourceResourceType: 'PatientChart',
        sourceResourceId: chart.patient.id,
        matchedCode: 'NONE',
        matchedDisplay: 'No reportable trigger codes matched',
        conditionGroup: 'None',
        triggered: false,
      };
      state.triggerLog.unshift(noMatchLog);
      return { triggered: false, logEntries: [noMatchLog] };
    }

    const conditionGroup = Array.from(matchedGroups).join(', ');
    const caseId = nextId('ecr');
    const caseNumber = `ECR-${new Date().getFullYear()}-${String(state.cases.length + 1).padStart(4, '0')}`;

    const newCase: EcrCaseRecord = {
      id: caseId,
      caseNumber,
      tenantId: ctx.tenantId,
      patientId: chart.patient.id,
      patientName: chart.patient.fullName,
      mrn: chart.patient.mrn,
      conditionGroup,
      matchedTriggers: matchedLabels,
      status: 'Triggered',
      versionNumber: 1,
      createdAt: now,
      updatedAt: now,
      phaStatus: 'Not Submitted',
      history: [
        {
          timestamp: now,
          status: 'Triggered',
          note: `Matched ${matchedLabels.length} trigger(s): ${matchedLabels.join('; ')}`,
          actor: `${actor.name} (${actor.role})`,
        },
      ],
    };

    newLogs.forEach((l) => {
      if (l.triggered) l.caseId = caseId;
    });
    state.triggerLog.unshift(...newLogs);
    state.cases.unshift(newCase);

    eventBus.publish({
      type: 'CaseTriggered',
      tenantId: ctx.tenantId,
      sourceModule: 'M13',
      payload: {
        caseId: newCase.id,
        caseNumber: newCase.caseNumber,
        patientId: chart.patient.id,
        conditionGroup,
        matchedCount: matchedLabels.length,
      },
    });

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Composition',
      resourceId: newCase.id,
      outcomeDesc: `eCR CaseTriggered (${caseNumber}) for Patient/${chart.patient.id}: ${conditionGroup}`,
    });

    return { triggered: true, logEntries: newLogs, createdCase: newCase };
  },

  async scanAllTenantPatients(
    ctx: FhirRequestContext,
    actor: { name: string; role: RoleName },
  ): Promise<{ scanned: number; casesCreated: EcrCaseRecord[] }> {
    const patients = await patientService.listPatients(ctx);
    const created: EcrCaseRecord[] = [];
    for (const p of patients) {
      const res = await this.evaluatePatientTriggers(ctx, p.id, actor);
      if (res.createdCase) created.push(res.createdCase);
    }
    return { scanned: patients.length, casesCreated: created };
  },

  async buildAndValidateEicr(
    ctx: FhirRequestContext,
    caseId: string,
    actor: { name: string; role: RoleName },
  ): Promise<EcrCaseRecord> {
    const state = getOrInitState(ctx.tenantId);
    const ecrCase = state.cases.find((c) => c.id === caseId);
    if (!ecrCase) {
      throw new AppError({ message: 'eCR case not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const chart = await patientService.getPatientChart(ctx, ecrCase.patientId);
    const now = new Date().toISOString();
    ecrCase.status = 'Data retrieved';
    ecrCase.history.push({
      timestamp: now,
      status: 'Data retrieved',
      note: `Retrieved Patient, ${chart.encounters.length} Encounter(s), ${chart.conditions.length} Condition(s), ${chart.observations.length} Observation(s).`,
      actor: `${actor.name} (${actor.role})`,
    });

    const bundle = buildEicrDocumentBundle(chart, ecrCase);
    const client = getFhirClient();
    const outcome = await client.operation<FhirOperationOutcome>(ctx, '$validate', {
      resourceType: 'Bundle',
      resource: bundle,
    });

    const hasError = (outcome.issue ?? []).some(
      (i) => i.severity === 'error' || i.severity === 'fatal',
    );
    ecrCase.eicrBundle = bundle;
    ecrCase.validationOutcome = outcome;
    ecrCase.validationPassed = !hasError;
    ecrCase.status = 'eICR created';
    ecrCase.updatedAt = now;
    ecrCase.history.push({
      timestamp: now,
      status: 'eICR created',
      note: `Built eICR Document Bundle v${ecrCase.versionNumber} (${bundle.entry?.length ?? 0} entries); $validate ${hasError ? 'reported issues' : 'passed'}.`,
      actor: `${actor.name} (${actor.role})`,
    });

    eventBus.publish({
      type: 'EicrGenerated',
      tenantId: ctx.tenantId,
      sourceModule: 'M13',
      payload: {
        caseId: ecrCase.id,
        caseNumber: ecrCase.caseNumber,
        versionNumber: ecrCase.versionNumber,
        validationPassed: ecrCase.validationPassed,
        entryCount: bundle.entry?.length ?? 0,
      },
    });

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Bundle',
      resourceId: bundle.id,
      outcomeDesc: `Generated & validated eICR v${ecrCase.versionNumber} for ${ecrCase.caseNumber}`,
    });

    return ecrCase;
  },

  async submitEicr(
    ctx: FhirRequestContext,
    caseId: string,
    actor: { name: string; role: RoleName },
    options?: { autoReceiveStubRr?: boolean; simulatedDetermination?: ReportabilityDetermination },
  ): Promise<EcrCaseRecord> {
    const state = getOrInitState(ctx.tenantId);
    const ecrCase = state.cases.find((c) => c.id === caseId);
    if (!ecrCase) {
      throw new AppError({ message: 'eCR case not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    if (!ecrCase.eicrBundle) {
      await this.buildAndValidateEicr(ctx, caseId, actor);
    }

    const now = new Date().toISOString();
    const cfg = state.adapterConfig;
    let submittedVia: 'eCRNow Live' | 'eCRNow Built-in Stub' = 'eCRNow Built-in Stub';
    let fallbackWarning: string | undefined;

    if (cfg.enabledLive && cfg.baseUrl.trim()) {
      try {
        const url = `${cfg.baseUrl.replace(/\/$/, '')}${cfg.submitPath.startsWith('/') ? cfg.submitPath : `/${cfg.submitPath}`}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/fhir+json' },
          body: JSON.stringify(ecrCase.eicrBundle),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        submittedVia = 'eCRNow Live';
      } catch (err) {
        fallbackWarning = `Live eCRNow unreachable (${err instanceof Error ? err.message : 'network error'}). Submitted to built-in eCRNow stub.`;
      }
    }

    ecrCase.submissionAckId = `ACK-${nextId('ecrnow').toUpperCase()}`;
    ecrCase.submittedVia = submittedVia;
    ecrCase.fallbackWarning = fallbackWarning;
    ecrCase.status = 'Acknowledged';
    ecrCase.phaStatus = 'Pending PHA Review';
    ecrCase.updatedAt = now;
    ecrCase.history.push(
      {
        timestamp: now,
        status: 'Submitted',
        note: `Submitted eICR v${ecrCase.versionNumber} via ${submittedVia}.`,
        actor: `${actor.name} (${actor.role})`,
      },
      {
        timestamp: now,
        status: 'Acknowledged',
        note: `Acknowledgement received (${ecrCase.submissionAckId}). Queued in PHA Stub.`,
        actor: 'eCRNow Adapter',
      },
    );

    if (options?.autoReceiveStubRr) {
      await this.processPhaDecisionAndRrIntake(
        ctx,
        caseId,
        {
          accept: options.simulatedDetermination !== 'Not reportable',
          determination: options.simulatedDetermination ?? 'Reportable',
          ruleSummary: `Matched jurisdiction rule for ${ecrCase.conditionGroup} (${cfg.defaultJurisdiction}).`,
          phaReviewer: 'Automated eCRNow Stub',
        },
        actor,
      );
    }

    return ecrCase;
  },

  async processPhaDecisionAndRrIntake(
    ctx: FhirRequestContext,
    caseId: string,
    decision: {
      accept: boolean;
      determination: ReportabilityDetermination;
      ruleSummary: string;
      phaReviewer: string;
    },
    actor: { name: string; role: RoleName },
  ): Promise<EcrCaseRecord> {
    const state = getOrInitState(ctx.tenantId);
    const ecrCase = state.cases.find((c) => c.id === caseId);
    if (!ecrCase) {
      throw new AppError({ message: 'eCR case not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const now = new Date().toISOString();
    const client = getFhirClient();
    const rrPayload = {
      caseNumber: ecrCase.caseNumber,
      determination: decision.determination,
      jurisdiction: state.adapterConfig.defaultJurisdiction,
      ruleSummary: decision.ruleSummary,
      receivedAt: now,
    };

    const docRef = await client.create<FhirDocumentReference>(ctx, {
      resourceType: 'DocumentReference',
      status: 'current',
      docStatus: 'final',
      type: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '88085-6',
            display: 'Reportability response report Document Public health',
          },
        ],
        text: `Reportability Response (${decision.determination})`,
      },
      subject: { reference: `Patient/${ecrCase.patientId}`, display: ecrCase.patientName },
      date: now,
      description: `${decision.determination} — ${decision.ruleSummary}`,
      content: [
        {
          attachment: {
            contentType: 'application/json',
            title: `RR-${ecrCase.caseNumber}-v${ecrCase.versionNumber}.json`,
            data: typeof btoa === 'function' ? btoa(JSON.stringify(rrPayload)) : undefined,
          },
        },
      ],
    });

    ecrCase.phaStatus = decision.accept ? 'Accepted' : 'Rejected';
    ecrCase.phaNotes = decision.ruleSummary;
    ecrCase.reportabilityResponse = {
      id: nextId('rr'),
      receivedAt: now,
      determination: decision.determination,
      jurisdiction: state.adapterConfig.defaultJurisdiction,
      ruleSummary: decision.ruleSummary,
      documentReferenceId: docRef.id,
      phaReviewer: decision.phaReviewer,
    };
    ecrCase.status = 'RR received';
    ecrCase.updatedAt = now;
    ecrCase.history.push({
      timestamp: now,
      status: 'RR received',
      note: `PHA ${ecrCase.phaStatus} (${decision.determination}). Attached DocumentReference/${docRef.id}.`,
      actor: decision.phaReviewer,
    });

    eventBus.publish({
      type: 'ReportabilityResponseReceived',
      tenantId: ctx.tenantId,
      sourceModule: 'M13',
      payload: {
        caseId: ecrCase.id,
        caseNumber: ecrCase.caseNumber,
        patientId: ecrCase.patientId,
        determination: decision.determination,
        documentReferenceId: docRef.id,
      },
    });

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'DocumentReference',
      resourceId: docRef.id,
      outcomeDesc: `RR intake completed (${decision.determination}) for ${ecrCase.caseNumber}`,
    });

    return ecrCase;
  },

  async createFollowUpUpdate(
    ctx: FhirRequestContext,
    caseId: string,
    actor: { name: string; role: RoleName },
  ): Promise<EcrCaseRecord> {
    const state = getOrInitState(ctx.tenantId);
    const ecrCase = state.cases.find((c) => c.id === caseId);
    if (!ecrCase) {
      throw new AppError({ message: 'eCR case not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    ecrCase.versionNumber += 1;
    ecrCase.phaStatus = 'Not Submitted';
    return this.buildAndValidateEicr(ctx, caseId, actor);
  },

  closeCase(
    tenantId: string,
    caseId: string,
    reason: string,
    actorLabel: string,
  ): EcrCaseRecord {
    const state = getOrInitState(tenantId);
    const ecrCase = state.cases.find((c) => c.id === caseId);
    if (!ecrCase) {
      throw new AppError({ message: 'eCR case not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    const now = new Date().toISOString();
    ecrCase.status = 'Closed';
    ecrCase.updatedAt = now;
    ecrCase.history.push({
      timestamp: now,
      status: 'Closed',
      note: reason.trim() || 'Case reporting workflow completed and closed.',
      actor: actorLabel,
    });
    return ecrCase;
  },
};
