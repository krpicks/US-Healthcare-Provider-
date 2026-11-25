import { getFhirClient, type FhirRequestContext } from '../../fhir';
import {
  MRN_SYSTEM,
  SENSITIVE_SSN_EXT_URL,
  buildSampleClinicalBundle,
} from '../../mock-data';
import { auditService } from '../../services/auditService';
import {
  AppError,
  type FhirBundle,
  type FhirCondition,
  type FhirEncounter,
  type FhirMedicationRequest,
  type FhirObservation,
  type FhirPatient,
  type FhirProcedure,
  type RoleName,
} from '../../types';

export interface CodeOption {
  system: string;
  code: string;
  display: string;
}

export const CLINICAL_CODE_PICKERS = {
  conditions: [
    { system: 'http://snomed.info/sct', code: '840539006', display: 'COVID-19 (SARS-CoV-2 disease)' },
    { system: 'http://snomed.info/sct', code: '240589008', display: 'Chlamydia trachomatis infection' },
    { system: 'http://snomed.info/sct', code: '50711007', display: 'Viral hepatitis C' },
    { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9', display: 'Type 2 diabetes mellitus without complications' },
    { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I10', display: 'Essential (primary) hypertension' },
  ] as CodeOption[],
  observations: [
    { system: 'http://loinc.org', code: '94500-6', display: 'SARS-CoV-2 RNA [Presence] PCR' },
    { system: 'http://loinc.org', code: '21613-5', display: 'Chlamydia trachomatis DNA [Presence]' },
    { system: 'http://loinc.org', code: '16128-1', display: 'Hepatitis C virus Ab [Presence]' },
    { system: 'http://loinc.org', code: '4548-4', display: 'Hemoglobin A1c/Hemoglobin.total (%)' },
    { system: 'http://loinc.org', code: '8480-6', display: 'Systolic blood pressure (mmHg)' },
  ] as CodeOption[],
  procedures: [
    { system: 'http://snomed.info/sct', code: '258500001', display: 'Nasopharyngeal swab' },
    { system: 'http://snomed.info/sct', code: '33879002', display: 'Administration of vaccine' },
    { system: 'http://snomed.info/sct', code: '71388002', display: 'Preventive wellness screening' },
  ] as CodeOption[],
  encounters: [
    { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'Ambulatory' },
    { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'EMER', display: 'Emergency' },
    { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: 'Inpatient encounter' },
    { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'VR', display: 'Virtual / Telehealth' },
  ] as CodeOption[],
  medications: [
    { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '860975', display: 'Metformin HCl 500 MG Extended Release' },
    { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '314076', display: 'Lisinopril 10 MG Oral Tablet' },
    { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '197361', display: 'Amlodipine 5 MG Oral Tablet' },
  ] as CodeOption[],
};

export interface PatientSummaryRow {
  id: string;
  resource: FhirPatient;
  fullName: string;
  mrn: string;
  birthDate: string;
  gender: string;
  city: string;
  state: string;
  ssn?: string;
}

export interface PatientChartBundle {
  patient: PatientSummaryRow;
  encounters: FhirEncounter[];
  conditions: FhirCondition[];
  observations: FhirObservation[];
  procedures: FhirProcedure[];
  medications: FhirMedicationRequest[];
}

export interface TimelineClinicalItem {
  id: string;
  resourceType: string;
  date: string;
  title: string;
  status: string;
  detail: string;
}

export function mapPatientToRow(p: FhirPatient): PatientSummaryRow {
  const nameObj = p.name?.[0];
  const fullName =
    nameObj?.text ||
    [...(nameObj?.given ?? []), nameObj?.family ?? ''].filter(Boolean).join(' ') ||
    'Unnamed Patient';
  const mrn =
    p.identifier?.find((i) => i.system === MRN_SYSTEM)?.value ??
    p.identifier?.[0]?.value ??
    '';
  const addr = p.address?.[0];
  const ssn = p.extension?.find((e) => e.url === SENSITIVE_SSN_EXT_URL)?.valueString;

  return {
    id: p.id ?? '',
    resource: p,
    fullName,
    mrn,
    birthDate: p.birthDate ?? '',
    gender: p.gender ?? 'unknown',
    city: addr?.city ?? '',
    state: addr?.state ?? '',
    ssn,
  };
}

const SYNTHETIC_FIRST = ['Liam', 'Noah', 'Olivia', 'Emma', 'Sophia', 'Maya', 'Lucas', 'Ethan', 'Ava', 'Chloe'];
const SYNTHETIC_LAST = ['Carter', 'Rivera', 'Kim', 'Patel', 'Brooks', 'Nguyen', 'Flores', 'Reed', 'Howard', 'Shah'];
const SYNTHETIC_CITIES = [
  { city: 'Albany', state: 'NY', zip: '12207' },
  { city: 'Syracuse', state: 'NY', zip: '13202' },
  { city: 'Rochester', state: 'NY', zip: '14604' },
  { city: 'Chicago', state: 'IL', zip: '60612' },
];

export const patientService = {
  async listPatients(ctx: FhirRequestContext): Promise<PatientSummaryRow[]> {
    const client = getFhirClient();
    const res = await client.search<FhirPatient>(ctx, 'Patient', { _count: 200 });
    return res.resources.map(mapPatientToRow);
  },

  async createPatientConditional(
    ctx: FhirRequestContext,
    input: {
      given: string;
      family: string;
      mrn: string;
      birthDate: string;
      gender: 'male' | 'female' | 'other' | 'unknown';
      city: string;
      state: string;
      phone?: string;
    },
    actor: { name: string; role: RoleName },
  ): Promise<{ patient: PatientSummaryRow; created: boolean }> {
    if (!input.given.trim() || !input.family.trim() || !input.mrn.trim()) {
      throw new AppError({
        message: 'Patient given name, family name, and MRN are required.',
        statusCode: 400,
        code: 'MISSING_FIELDS',
      });
    }
    const client = getFhirClient();
    const fullName = `${input.given.trim()} ${input.family.trim()}`;
    const patient: FhirPatient = {
      resourceType: 'Patient',
      active: true,
      identifier: [{ system: MRN_SYSTEM, value: input.mrn.trim(), use: 'usual' }],
      name: [{ use: 'official', given: [input.given.trim()], family: input.family.trim(), text: fullName }],
      gender: input.gender,
      birthDate: input.birthDate,
      telecom: input.phone ? [{ system: 'phone', value: input.phone }] : undefined,
      address: [{ city: input.city, state: input.state }],
    };

    const result = await client.conditionalCreate(ctx, patient, {
      identifier: `${MRN_SYSTEM}|${input.mrn.trim()}`,
    });

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: result.created ? 'create' : 'update',
      resourceType: 'Patient',
      resourceId: result.resource.id,
      outcomeDesc: result.created
        ? `Created Patient with MRN ${input.mrn}`
        : `Conditional create matched existing Patient MRN ${input.mrn}`,
    });

    return { patient: mapPatientToRow(result.resource), created: result.created };
  },

  async getPatientChart(
    ctx: FhirRequestContext,
    patientId: string,
  ): Promise<PatientChartBundle> {
    const client = getFhirClient();
    const pat = await client.read<FhirPatient>(ctx, 'Patient', patientId);
    const ref = `Patient/${patientId}`;

    const [enc, cond, obs, proc, med] = await Promise.all([
      client.search<FhirEncounter>(ctx, 'Encounter', { patient: ref, _count: 100 }),
      client.search<FhirCondition>(ctx, 'Condition', { patient: ref, _count: 100 }),
      client.search<FhirObservation>(ctx, 'Observation', { patient: ref, _count: 100 }),
      client.search<FhirProcedure>(ctx, 'Procedure', { patient: ref, _count: 100 }),
      client.search<FhirMedicationRequest>(ctx, 'MedicationRequest', { patient: ref, _count: 100 }),
    ]);

    return {
      patient: mapPatientToRow(pat),
      encounters: enc.resources,
      conditions: cond.resources,
      observations: obs.resources,
      procedures: proc.resources,
      medications: med.resources,
    };
  },

  buildClinicalTimeline(chart: PatientChartBundle): TimelineClinicalItem[] {
    const items: TimelineClinicalItem[] = [];

    for (const e of chart.encounters) {
      items.push({
        id: `enc-${e.id}`,
        resourceType: 'Encounter',
        date: e.period?.start ?? e.meta?.lastUpdated ?? '',
        title: e.type?.[0]?.text ?? e.type?.[0]?.coding?.[0]?.display ?? e.class.display ?? 'Encounter',
        status: e.status,
        detail: `Class: ${e.class.code ?? ''} (${e.class.display ?? ''})`,
      });
    }
    for (const c of chart.conditions) {
      const coding = c.code?.coding?.[0];
      items.push({
        id: `cond-${c.id}`,
        resourceType: 'Condition',
        date: c.recordedDate ?? c.onsetDateTime ?? c.meta?.lastUpdated ?? '',
        title: c.code?.text ?? coding?.display ?? 'Condition',
        status: c.clinicalStatus?.coding?.[0]?.code ?? 'active',
        detail: coding ? `${coding.system?.includes('snomed') ? 'SNOMED' : 'ICD-10'} ${coding.code}` : '',
      });
    }
    for (const o of chart.observations) {
      const coding = o.code?.coding?.[0];
      const val =
        o.valueCodeableConcept?.text ??
        o.valueCodeableConcept?.coding?.[0]?.display ??
        (o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit ?? ''}` : o.valueString ?? '');
      items.push({
        id: `obs-${o.id}`,
        resourceType: 'Observation',
        date: o.effectiveDateTime ?? o.issued ?? o.meta?.lastUpdated ?? '',
        title: o.code?.text ?? coding?.display ?? 'Observation',
        status: o.status,
        detail: `${coding?.code ?? ''} · Result: ${val}`,
      });
    }
    for (const p of chart.procedures) {
      const coding = p.code?.coding?.[0];
      items.push({
        id: `proc-${p.id}`,
        resourceType: 'Procedure',
        date: p.performedDateTime ?? p.performedPeriod?.start ?? p.meta?.lastUpdated ?? '',
        title: p.code?.text ?? coding?.display ?? 'Procedure',
        status: p.status,
        detail: coding ? `SNOMED ${coding.code}` : '',
      });
    }
    for (const m of chart.medications) {
      const coding = m.medicationCodeableConcept?.coding?.[0];
      items.push({
        id: `med-${m.id}`,
        resourceType: 'MedicationRequest',
        date: m.authoredOn ?? m.meta?.lastUpdated ?? '',
        title: m.medicationCodeableConcept?.text ?? coding?.display ?? 'Medication',
        status: m.status,
        detail: coding ? `RxNorm ${coding.code}` : '',
      });
    }

    return items.sort((a, b) => b.date.localeCompare(a.date));
  },

  async fetchEverythingWithFallback(
    ctx: FhirRequestContext,
    patientId: string,
  ): Promise<{ bundle: FhirBundle; usedFallback: boolean }> {
    const client = getFhirClient();
    try {
      const bundle = await client.operation<FhirBundle>(ctx, '$everything', {
        resourceType: 'Patient',
        id: patientId,
      });
      return { bundle, usedFallback: false };
    } catch {
      const rev = await client.search(ctx, 'Patient', {
        _id: patientId,
        _revinclude: [
          'Encounter:patient',
          'Condition:patient',
          'Observation:patient',
          'Procedure:patient',
          'MedicationRequest:patient',
        ],
      });
      return { bundle: rev.bundle, usedFallback: true };
    }
  },

  async addClinicalResource(
    ctx: FhirRequestContext,
    patientId: string,
    patientName: string,
    kind: 'Encounter' | 'Condition' | 'Observation' | 'Procedure',
    payload: {
      codeOption: CodeOption;
      date: string;
      status: string;
      valueText?: string;
      valueNumeric?: string;
      valueUnit?: string;
    },
    actor: { name: string; role: RoleName },
  ) {
    const client = getFhirClient();
    const subject = { reference: `Patient/${patientId}`, display: patientName };
    let created;

    if (kind === 'Encounter') {
      created = await client.create<FhirEncounter>(ctx, {
        resourceType: 'Encounter',
        status: (payload.status as FhirEncounter['status']) || 'finished',
        class: {
          system: payload.codeOption.system,
          code: payload.codeOption.code,
          display: payload.codeOption.display,
        },
        subject,
        period: { start: payload.date },
      });
    } else if (kind === 'Condition') {
      created = await client.create<FhirCondition>(ctx, {
        resourceType: 'Condition',
        clinicalStatus: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
              code: payload.status || 'active',
            },
          ],
        },
        code: {
          coding: [payload.codeOption],
          text: payload.codeOption.display,
        },
        subject,
        recordedDate: payload.date,
      });
    } else if (kind === 'Observation') {
      const isDetected = payload.valueText?.toLowerCase() === 'detected';
      created = await client.create<FhirObservation>(ctx, {
        resourceType: 'Observation',
        status: (payload.status as FhirObservation['status']) || 'final',
        code: {
          coding: [payload.codeOption],
          text: payload.codeOption.display,
        },
        subject,
        effectiveDateTime: payload.date,
        ...(payload.valueNumeric
          ? {
              valueQuantity: {
                value: Number(payload.valueNumeric),
                unit: payload.valueUnit || 'unit',
              },
            }
          : isDetected
            ? {
                valueCodeableConcept: {
                  coding: [
                    {
                      system: 'http://snomed.info/sct',
                      code: '260373001',
                      display: 'Detected',
                    },
                  ],
                  text: 'Detected',
                },
              }
            : { valueString: payload.valueText || 'Normal' }),
      });
    } else {
      created = await client.create<FhirProcedure>(ctx, {
        resourceType: 'Procedure',
        status: (payload.status as FhirProcedure['status']) || 'completed',
        code: {
          coding: [payload.codeOption],
          text: payload.codeOption.display,
        },
        subject,
        performedDateTime: payload.date,
      });
    }

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: kind,
      resourceId: created.id,
      outcomeDesc: `Added ${kind} (${payload.codeOption.code}) for Patient/${patientId}`,
    });

    return created;
  },

  async loadSampleJaneDoeBundle(
    ctx: FhirRequestContext,
    actor: { name: string; role: RoleName },
  ): Promise<FhirBundle> {
    const client = getFhirClient();
    const bundle = buildSampleClinicalBundle(ctx.tenantCode);
    const resp = await client.transaction(ctx, bundle);
    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Bundle',
      outcomeDesc: 'Loaded synthetic Jane Doe (MRN-1001) COVID-19 FHIR bundle',
    });
    return resp;
  },

  async generateSyntheticPatients(
    ctx: FhirRequestContext,
    count: number,
    actor: { name: string; role: RoleName },
  ): Promise<{ patientsCreated: number; reportableCasesCreated: number }> {
    const client = getFhirClient();
    const clamped = Math.max(1, Math.min(25, count));
    let reportableCasesCreated = 0;

    const reportableTemplates = [
      {
        label: 'COVID-19 PCR Positive',
        condCode: { system: 'http://snomed.info/sct', code: '840539006', display: 'COVID-19' },
        obsCode: { system: 'http://loinc.org', code: '94500-6', display: 'SARS-CoV-2 RNA PCR' },
      },
      {
        label: 'Chlamydia Trachomatis Positive',
        condCode: { system: 'http://snomed.info/sct', code: '240589008', display: 'Chlamydia trachomatis infection' },
        obsCode: { system: 'http://loinc.org', code: '21613-5', display: 'Chlamydia trachomatis DNA' },
      },
      {
        label: 'Hepatitis C Antibody Reactive',
        condCode: { system: 'http://snomed.info/sct', code: '50711007', display: 'Viral hepatitis C' },
        obsCode: { system: 'http://loinc.org', code: '16128-1', display: 'Hepatitis C virus Ab' },
      },
    ];

    for (let i = 0; i < clamped; i += 1) {
      const seedNum = Math.floor(2000 + Math.random() * 7900);
      const first = SYNTHETIC_FIRST[i % SYNTHETIC_FIRST.length];
      const last = SYNTHETIC_LAST[(i * 3) % SYNTHETIC_LAST.length];
      const loc = SYNTHETIC_CITIES[i % SYNTHETIC_CITIES.length];
      const patUrn = `urn:uuid:syn-pat-${i}-${seedNum}`;
      const encUrn = `urn:uuid:syn-enc-${i}-${seedNum}`;

      const entries: NonNullable<FhirBundle['entry']> = [
        {
          fullUrl: patUrn,
          resource: {
            resourceType: 'Patient',
            active: true,
            identifier: [{ system: MRN_SYSTEM, value: `MRN-${seedNum}` }],
            name: [{ use: 'official', given: [first], family: last, text: `${first} ${last}` }],
            gender: i % 2 === 0 ? 'female' : 'male',
            birthDate: `${1965 + ((i * 7) % 45)}-0${1 + (i % 9)}-${10 + (i % 18)}`,
            address: [{ city: loc.city, state: loc.state, postalCode: loc.zip }],
          },
          request: { method: 'POST', url: 'Patient' },
        },
        {
          fullUrl: encUrn,
          resource: {
            resourceType: 'Encounter',
            status: 'finished',
            class: {
              system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
              code: 'AMB',
              display: 'ambulatory',
            },
            subject: { reference: patUrn, display: `${first} ${last}` },
            period: { start: new Date().toISOString() },
          },
          request: { method: 'POST', url: 'Encounter' },
        },
      ];

      // Include reportable conditions on first 3 (or every other) generated patient
      if (i < 3 || i % 2 === 0) {
        const tpl = reportableTemplates[i % reportableTemplates.length];
        reportableCasesCreated += 1;
        entries.push(
          {
            fullUrl: `urn:uuid:syn-cond-${i}-${seedNum}`,
            resource: {
              resourceType: 'Condition',
              clinicalStatus: {
                coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
              },
              code: { coding: [tpl.condCode], text: tpl.condCode.display },
              subject: { reference: patUrn, display: `${first} ${last}` },
              encounter: { reference: encUrn },
              recordedDate: new Date().toISOString(),
            },
            request: { method: 'POST', url: 'Condition' },
          },
          {
            fullUrl: `urn:uuid:syn-obs-${i}-${seedNum}`,
            resource: {
              resourceType: 'Observation',
              status: 'final',
              code: { coding: [tpl.obsCode], text: tpl.obsCode.display },
              subject: { reference: patUrn, display: `${first} ${last}` },
              encounter: { reference: encUrn },
              effectiveDateTime: new Date().toISOString(),
              valueCodeableConcept: {
                coding: [{ system: 'http://snomed.info/sct', code: '260373001', display: 'Detected' }],
                text: 'Detected',
              },
            },
            request: { method: 'POST', url: 'Observation' },
          },
        );
      }

      await client.transaction(ctx, {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: entries,
      });
    }

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Bundle',
      outcomeDesc: `Generated ${clamped} synthetic patients (${reportableCasesCreated} reportable-condition cases)`,
    });

    return { patientsCreated: clamped, reportableCasesCreated };
  },

  evaluateQuickEcrPreview(
    chart: PatientChartBundle,
    triggerCodes: Array<{ system: string; code: string; display: string }>,
  ): { triggered: boolean; matches: string[] } {
    const codeSet = new Set(triggerCodes.map((t) => t.code));
    const matches: string[] = [];

    for (const c of chart.conditions) {
      for (const coding of c.code?.coding ?? []) {
        if (coding.code && codeSet.has(coding.code)) {
          matches.push(`Condition ${coding.code} (${coding.display ?? c.code?.text ?? ''})`);
        }
      }
    }
    for (const o of chart.observations) {
      for (const coding of o.code?.coding ?? []) {
        if (coding.code && codeSet.has(coding.code)) {
          const val = o.valueCodeableConcept?.coding?.[0]?.display ?? o.valueCodeableConcept?.text ?? '';
          matches.push(`Observation ${coding.code} (${coding.display ?? ''}: ${val})`);
        }
      }
    }
    return { triggered: matches.length > 0, matches };
  },
};
