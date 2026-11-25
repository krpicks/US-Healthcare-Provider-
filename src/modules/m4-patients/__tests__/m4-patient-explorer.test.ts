import { beforeEach, describe, expect, it } from 'vitest';
import { mockFhirClient } from '../../../fhir';
import { settingsService } from '../../../services';
import { CLINICAL_CODE_PICKERS, patientService } from '../patientService';

describe('M4 Patient & Clinical Data Explorer', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const actor = { name: 'Samira Ali', role: 'IntegrationEngineer' as const };

  beforeEach(() => {
    settingsService.reset();
    mockFhirClient.clearTenantStore(ctx.tenantId);
  });

  it('performs idempotent conditional create of a Patient by MRN', async () => {
    const first = await patientService.createPatientConditional(
      ctx,
      {
        given: 'Jordan',
        family: 'Ellis',
        mrn: 'MRN-4201',
        birthDate: '1991-09-12',
        gender: 'female',
        city: 'Albany',
        state: 'NY',
      },
      actor,
    );
    expect(first.created).toBe(true);

    const second = await patientService.createPatientConditional(
      ctx,
      {
        given: 'Jordan',
        family: 'Ellis',
        mrn: 'MRN-4201',
        birthDate: '1991-09-12',
        gender: 'female',
        city: 'Albany',
        state: 'NY',
      },
      actor,
    );
    expect(second.created).toBe(false);
    expect(second.patient.id).toBe(first.patient.id);
  });

  it('loads the Jane Doe (MRN-1001) COVID-19 FHIR bundle and evaluates eCR trigger preview', async () => {
    await patientService.loadSampleJaneDoeBundle(ctx, actor);

    const patients = await patientService.listPatients(ctx);
    const jane = patients.find((p) => p.mrn === 'MRN-1001');
    expect(jane).toBeDefined();

    const chart = await patientService.getPatientChart(ctx, jane!.id);
    expect(chart.encounters.length).toBeGreaterThanOrEqual(1);
    expect(chart.conditions.some((c) => c.code?.coding?.[0]?.code === '840539006')).toBe(true);
    expect(chart.observations.some((o) => o.code?.coding?.[0]?.code === '94500-6')).toBe(true);
    expect(chart.procedures.length).toBeGreaterThanOrEqual(1);

    const timeline = patientService.buildClinicalTimeline(chart);
    expect(timeline.length).toBeGreaterThanOrEqual(4);

    const ecrPreview = patientService.evaluateQuickEcrPreview(chart, [
      { system: 'http://snomed.info/sct', code: '840539006', display: 'COVID-19' },
      { system: 'http://loinc.org', code: '94500-6', display: 'SARS-CoV-2 RNA' },
    ]);
    expect(ecrPreview.triggered).toBe(true);
    expect(ecrPreview.matches.length).toBeGreaterThanOrEqual(2);
  });

  it('retrieves Patient $everything bundle and supports adding clinical resources', async () => {
    await patientService.loadSampleJaneDoeBundle(ctx, actor);
    const jane = (await patientService.listPatients(ctx)).find((p) => p.mrn === 'MRN-1001')!;

    await patientService.addClinicalResource(
      ctx,
      jane.id,
      jane.fullName,
      'Observation',
      {
        codeOption: CLINICAL_CODE_PICKERS.observations[3],
        date: '2026-11-24',
        status: 'final',
        valueNumeric: '6.4',
        valueUnit: '%',
      },
      actor,
    );

    const { bundle, usedFallback } = await patientService.fetchEverythingWithFallback(
      ctx,
      jane.id,
    );
    expect(usedFallback).toBe(false);
    expect((bundle.entry?.length ?? 0) >= 6).toBe(true);
  });

  it('generates N synthetic patients including reportable-condition test cases', async () => {
    const result = await patientService.generateSyntheticPatients(ctx, 5, actor);
    expect(result.patientsCreated).toBe(5);
    expect(result.reportableCasesCreated).toBeGreaterThanOrEqual(3);

    const patients = await patientService.listPatients(ctx);
    expect(patients).toHaveLength(5);
  });
});
