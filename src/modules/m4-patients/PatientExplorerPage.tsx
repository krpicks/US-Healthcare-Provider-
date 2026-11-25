import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Database,
  Eye,
  EyeOff,
  FileBarChart2,
  Plus,
} from 'lucide-react';
import {
  Button,
  DataTable,
  Input,
  Modal,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  Timeline,
  useToast,
  type DataTableColumn,
} from '../../components';
import { Guard } from '../../app/Guard';
import { useAuth, usePermission } from '../../app/AuthContext';
import { maskSensitiveValue } from '../../rules';
import { auditService } from '../../services';
import { useTenantContext } from '../../tenancy';
import type { FhirBundle } from '../../types';
import {
  CLINICAL_CODE_PICKERS,
  patientService,
  type CodeOption,
  type PatientChartBundle,
  type PatientSummaryRow,
} from './patientService';

export function PatientExplorerPage() {
  const { activeTenant, fhirContext, seedReady } = useTenantContext();
  const { user, canUnmask } = useAuth();
  const { notify } = useToast();
  const canCreate = usePermission('m4-patients', 'create');

  const [patients, setPatients] = useState<PatientSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [genderFilter, setGenderFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('');

  // Chart state
  const [chart, setChart] = useState<PatientChartBundle | null>(null);
  const [chartTab, setChartTab] = useState('summary');
  const [unmasked, setUnmasked] = useState(false);
  const [everythingResult, setEverythingResult] = useState<{
    bundle: FhirBundle;
    usedFallback: boolean;
  } | null>(null);
  const [ecrPreview, setEcrPreview] = useState<{
    triggered: boolean;
    matches: string[];
  } | null>(null);
  const [udsIncluded, setUdsIncluded] = useState(false);

  // New Patient modal
  const [newPatOpen, setNewPatOpen] = useState(false);
  const [patForm, setPatForm] = useState({
    given: '',
    family: '',
    mrn: '',
    birthDate: '1988-03-15',
    gender: 'female' as 'male' | 'female' | 'other' | 'unknown',
    city: 'Albany',
    state: 'NY',
    phone: '',
  });

  // Add Clinical Resource modal
  const [clinModalKind, setClinModalKind] = useState<
    'Encounter' | 'Condition' | 'Observation' | 'Procedure' | null
  >(null);
  const [clinCodeIdx, setClinCodeIdx] = useState(0);
  const [clinDate, setClinDate] = useState('2026-11-24');
  const [clinValueText, setClinValueText] = useState('Detected');
  const [clinValueNum, setClinValueNum] = useState('');

  // Synthetic generator count
  const [seedCount, setSeedCount] = useState(3);

  const loadPatients = useCallback(async () => {
    setLoading(true);
    try {
      const list = await patientService.listPatients(fhirContext);
      setPatients(list);
    } finally {
      setLoading(false);
    }
  }, [fhirContext]);

  useEffect(() => {
    if (seedReady) {
      void loadPatients();
      setChart(null);
    }
  }, [seedReady, loadPatients]);

  const filteredPatients = useMemo(() => {
    return patients.filter((p) => {
      if (genderFilter !== 'all' && p.gender !== genderFilter) return false;
      if (
        cityFilter.trim() &&
        !p.city.toLowerCase().includes(cityFilter.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [patients, genderFilter, cityFilter]);

  const openChart = async (patientId: string) => {
    const loaded = await patientService.getPatientChart(fhirContext, patientId);
    setChart(loaded);
    setChartTab('summary');
    setUnmasked(false);
    setEverythingResult(null);
    setEcrPreview(null);
    setUdsIncluded(false);
  };

  const handleLoadEverything = async () => {
    if (!chart) return;
    const res = await patientService.fetchEverythingWithFallback(
      fhirContext,
      chart.patient.id,
    );
    setEverythingResult(res);
  };

  const handleCreatePatient = async () => {
    try {
      const res = await patientService.createPatientConditional(
        fhirContext,
        patForm,
        { name: user.name, role: user.role },
      );
      notify({
        title: res.created
          ? `Patient ${res.patient.fullName} created`
          : `Matched existing patient with MRN ${res.patient.mrn}`,
        variant: 'success',
      });
      setNewPatOpen(false);
      await loadPatients();
    } catch (err) {
      notify({
        title: 'Unable to create patient',
        description: err instanceof Error ? err.message : 'Validation error',
        variant: 'error',
      });
    }
  };

  const handleAddClinicalResource = async () => {
    if (!chart || !clinModalKind) return;
    const pool: CodeOption[] =
      clinModalKind === 'Encounter'
        ? CLINICAL_CODE_PICKERS.encounters
        : clinModalKind === 'Condition'
          ? CLINICAL_CODE_PICKERS.conditions
          : clinModalKind === 'Observation'
            ? CLINICAL_CODE_PICKERS.observations
            : CLINICAL_CODE_PICKERS.procedures;
    const codeOption = pool[clinCodeIdx] ?? pool[0];

    await patientService.addClinicalResource(
      fhirContext,
      chart.patient.id,
      chart.patient.fullName,
      clinModalKind,
      {
        codeOption,
        date: `${clinDate}T12:00:00Z`,
        status: clinModalKind === 'Condition' ? 'active' : clinModalKind === 'Observation' ? 'final' : clinModalKind === 'Encounter' ? 'finished' : 'completed',
        valueText: clinValueText,
        valueNumeric: clinValueNum || undefined,
      },
      { name: user.name, role: user.role },
    );
    notify({ title: `Added ${clinModalKind} (${codeOption.code})`, variant: 'success' });
    setClinModalKind(null);
    await openChart(chart.patient.id);
  };

  const columns: DataTableColumn<PatientSummaryRow>[] = [
    {
      key: 'name',
      header: 'Patient Name',
      sortable: true,
      sortValue: (p) => p.fullName,
      render: (p) => <span className="font-medium text-slate-900 dark:text-slate-100">{p.fullName}</span>,
    },
    {
      key: 'mrn',
      header: 'MRN',
      sortable: true,
      sortValue: (p) => p.mrn,
      render: (p) => <span className="font-mono text-xs">{p.mrn || '—'}</span>,
    },
    {
      key: 'dob',
      header: 'Birth Date (Masked)',
      sortable: true,
      sortValue: (p) => p.birthDate,
      render: (p) => <span className="font-mono text-xs">{maskSensitiveValue(p.birthDate, 'dob')}</span>,
    },
    {
      key: 'gender',
      header: 'Gender',
      render: (p) => <span className="capitalize text-xs">{p.gender}</span>,
    },
    {
      key: 'city',
      header: 'City / State',
      sortable: true,
      sortValue: (p) => p.city,
      render: (p) => <span className="text-xs text-slate-600 dark:text-slate-400">{p.city}, {p.state}</span>,
    },
  ];

  // Patient Chart View
  if (chart) {
    const timelineItems = patientService.buildClinicalTimeline(chart);
    return (
      <Guard moduleId="m4-patients" action="view" moduleName="Patient Chart" showForbiddenPage>
        <div className="space-y-6">
          <PageHeader
            kicker={`M4 · Patient Chart · ${chart.patient.mrn} · Patient/${chart.patient.id}`}
            title={chart.patient.fullName}
            description={`${chart.patient.gender} · DOB ${unmasked ? chart.patient.birthDate : maskSensitiveValue(chart.patient.birthDate, 'dob')} · ${chart.patient.city}, ${chart.patient.state}`}
            actions={
              <>
                <Button onClick={() => setChart(null)}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span>All Patients</span>
                </Button>
                <Button
                  onClick={() => {
                    const res = patientService.evaluateQuickEcrPreview(
                      chart,
                      activeTenant.codeSets.triggerCodes,
                    );
                    setEcrPreview(res);
                    notify({
                      title: res.triggered
                        ? 'eCR Reportable Trigger Matched'
                        : 'No eCR trigger codes matched',
                      description: res.triggered
                        ? `${res.matches.length} clinical match(es) ready for M13 eCR.`
                        : 'Checked against tenant trigger value set.',
                      variant: res.triggered ? 'info' : 'success',
                    });
                  }}
                >
                  <Activity className="h-4 w-4" aria-hidden="true" />
                  <span>Check eCR triggers</span>
                </Button>
                <Button
                  variant={udsIncluded ? 'primary' : 'secondary'}
                  onClick={() => {
                    setUdsIncluded((v) => !v);
                    notify({
                      title: !udsIncluded
                        ? 'Included in UDS+ preview cohort'
                        : 'Removed from UDS+ preview cohort',
                      variant: 'info',
                    });
                  }}
                >
                  <FileBarChart2 className="h-4 w-4" aria-hidden="true" />
                  <span>{udsIncluded ? 'In UDS+ Preview' : 'Include in UDS+ preview'}</span>
                </Button>
              </>
            }
          />

          {ecrPreview && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900">
              <SemanticStatus
                label={ecrPreview.triggered ? 'eCR Trigger Fired (M13 Ready)' : 'No eCR Trigger Match'}
                tone={ecrPreview.triggered ? 'warning' : 'success'}
              />
              {ecrPreview.matches.length > 0 && (
                <p className="mt-1 font-mono text-slate-700 dark:text-slate-300">
                  Matches: {ecrPreview.matches.join(' · ')}
                </p>
              )}
            </div>
          )}

          {canCreate && (
            <div className="flex flex-wrap items-center gap-2">
              {(['Encounter', 'Condition', 'Observation', 'Procedure'] as const).map(
                (kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    onClick={() => {
                      setClinModalKind(kind);
                      setClinCodeIdx(0);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Add {kind}</span>
                  </Button>
                ),
              )}
              {canUnmask && (
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!unmasked) {
                      await auditService.record({
                        ctx: fhirContext,
                        actorName: user.name,
                        actorRole: user.role,
                        action: 'unmask',
                        resourceType: 'Patient',
                        resourceId: chart.patient.id,
                        outcomeDesc: `Unmasked DOB/SSN on Patient/${chart.patient.id}`,
                      });
                    }
                    setUnmasked((v) => !v);
                  }}
                >
                  {unmasked ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                  <span>{unmasked ? 'Mask PHI' : 'Unmask PHI'}</span>
                </Button>
              )}
            </div>
          )}

          <Tabs
            activeTab={chartTab}
            onChange={(id) => {
              setChartTab(id);
              if (id === 'everything' && !everythingResult) {
                void handleLoadEverything();
              }
            }}
            tabs={[
              { id: 'summary', label: 'Summary' },
              { id: 'timeline', label: 'Timeline', count: timelineItems.length },
              { id: 'labs', label: 'Labs', count: chart.observations.length },
              { id: 'conditions', label: 'Conditions', count: chart.conditions.length },
              { id: 'encounters', label: 'Encounters', count: chart.encounters.length },
              { id: 'raw', label: 'Raw FHIR' },
              { id: 'everything', label: 'Everything ($everything)' },
            ]}
          />

          <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            {chartTab === 'summary' && (
              <div className="space-y-6">
                <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-slate-500">MRN</dt>
                    <dd className="mt-1 font-mono">{chart.patient.mrn}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Date of Birth</dt>
                    <dd className="mt-1 font-mono">{unmasked ? chart.patient.birthDate : maskSensitiveValue(chart.patient.birthDate, 'dob')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">SSN (Synthetic)</dt>
                    <dd className="mt-1 font-mono">{unmasked ? (chart.patient.ssn ?? '—') : maskSensitiveValue(chart.patient.ssn, 'ssn')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Clinical Records</dt>
                    <dd className="mt-1 font-mono tabular-nums">
                      {chart.encounters.length} enc · {chart.conditions.length} cond · {chart.observations.length} obs
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {chartTab === 'timeline' && (
              <Timeline
                items={timelineItems.map((t) => ({
                  id: t.id,
                  timestamp: t.date || new Date().toISOString(),
                  title: `${t.resourceType}: ${t.title}`,
                  subtitle: `Status: ${t.status}`,
                  detail: t.detail,
                }))}
              />
            )}

            {chartTab === 'labs' && (
              <div className="divide-y divide-slate-200 text-xs dark:divide-slate-800">
                {chart.observations.length === 0 ? (
                  <p className="text-slate-500">No laboratory observations recorded.</p>
                ) : (
                  chart.observations.map((o) => (
                    <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {o.code.text ?? o.code.coding?.[0]?.display}
                        </p>
                        <p className="font-mono text-slate-500">
                          LOINC {o.code.coding?.[0]?.code} · {o.effectiveDateTime?.slice(0, 10)}
                        </p>
                      </div>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {o.valueCodeableConcept?.coding?.[0]?.display ??
                          o.valueCodeableConcept?.text ??
                          (o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit ?? ''}` : o.valueString)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {chartTab === 'conditions' && (
              <div className="divide-y divide-slate-200 text-xs dark:divide-slate-800">
                {chart.conditions.length === 0 ? (
                  <p className="text-slate-500">No conditions recorded.</p>
                ) : (
                  chart.conditions.map((c) => (
                    <div key={c.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {c.code?.text ?? c.code?.coding?.[0]?.display}
                        </p>
                        <p className="font-mono text-slate-500">
                          {c.code?.coding?.[0]?.code} · Recorded {c.recordedDate?.slice(0, 10)}
                        </p>
                      </div>
                      <SemanticStatus
                        label={c.clinicalStatus?.coding?.[0]?.code ?? 'active'}
                        tone="warning"
                      />
                    </div>
                  ))
                )}
              </div>
            )}

            {chartTab === 'encounters' && (
              <div className="divide-y divide-slate-200 text-xs dark:divide-slate-800">
                {chart.encounters.length === 0 ? (
                  <p className="text-slate-500">No encounters recorded.</p>
                ) : (
                  chart.encounters.map((e) => (
                    <div key={e.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {e.type?.[0]?.text ?? e.class.display} ({e.class.code})
                        </p>
                        <p className="font-mono text-slate-500">
                          {e.period?.start?.slice(0, 19).replace('T', ' ')}
                        </p>
                      </div>
                      <SemanticStatus label={e.status} tone="info" />
                    </div>
                  ))
                )}
              </div>
            )}

            {chartTab === 'raw' && (
              <pre className="max-h-[30rem] overflow-auto rounded-md bg-slate-950 p-4 font-mono text-xs text-slate-100">
                {JSON.stringify(chart.patient.resource, null, 2)}
              </pre>
            )}

            {chartTab === 'everything' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">
                    {everythingResult
                      ? `Loaded ${everythingResult.bundle.total ?? 0} resources via ${everythingResult.usedFallback ? '_revinclude fallback' : 'Patient/$everything'}`
                      : 'Loading $everything bundle...'}
                  </span>
                  <Button size="sm" onClick={() => void handleLoadEverything()}>
                    Refresh $everything
                  </Button>
                </div>
                {everythingResult && (
                  <pre className="max-h-[28rem] overflow-auto rounded-md bg-slate-950 p-4 font-mono text-xs text-slate-100">
                    {JSON.stringify(everythingResult.bundle, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>

          <Modal
            open={Boolean(clinModalKind)}
            title={`Add ${clinModalKind ?? ''} Resource`}
            onClose={() => setClinModalKind(null)}
            footer={
              <>
                <Button onClick={() => setClinModalKind(null)}>Cancel</Button>
                <Button variant="primary" onClick={() => void handleAddClinicalResource()}>
                  Save {clinModalKind}
                </Button>
              </>
            }
          >
            {clinModalKind && (
              <div className="space-y-4">
                <Select
                  label="Code Picker (SNOMED / LOINC / ICD-10-CM)"
                  value={String(clinCodeIdx)}
                  options={(
                    clinModalKind === 'Encounter'
                      ? CLINICAL_CODE_PICKERS.encounters
                      : clinModalKind === 'Condition'
                        ? CLINICAL_CODE_PICKERS.conditions
                        : clinModalKind === 'Observation'
                          ? CLINICAL_CODE_PICKERS.observations
                          : CLINICAL_CODE_PICKERS.procedures
                  ).map((c, idx) => ({
                    value: String(idx),
                    label: `${c.code} — ${c.display}`,
                  }))}
                  onChange={(e) => setClinCodeIdx(Number(e.target.value))}
                />
                <Input label="Clinical Date" type="date" value={clinDate} onChange={(e) => setClinDate(e.target.value)} />
                {clinModalKind === 'Observation' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Coded Result Text" value={clinValueText} onChange={(e) => setClinValueText(e.target.value)} hint="Use 'Detected' for positive SNOMED 260373001" />
                    <Input label="Or Numeric Value" value={clinValueNum} onChange={(e) => setClinValueNum(e.target.value)} />
                  </div>
                )}
              </div>
            )}
          </Modal>
        </div>
      </Guard>
    );
  }

  return (
    <Guard
      moduleId="m4-patients"
      action="view"
      moduleName="Patient & Clinical Data Explorer (M4)"
      showForbiddenPage
    >
      <div className="space-y-6">
        <PageHeader
          kicker={`M4 · Tenant ${activeTenant.code} · ${patients.length} Synthetic Patients`}
          title="Patient & Clinical Data Explorer"
          description="Search synthetic patients, conditionally create records by MRN, explore clinical charts and Patient/$everything bundles, and seed reportable-condition cases for eCR and UDS+."
          actions={
            canCreate ? (
              <Button variant="primary" onClick={() => setNewPatOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>New Patient</span>
              </Button>
            ) : undefined
          }
        />

        {/* Synthetic Seed Tool */}
        {canCreate && (
          <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Synthetic Clinical Seed Tool
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Load Jane Doe (MRN-1001, COVID-19 SNOMED 840539006, SARS-CoV-2 RNA LOINC 94500-6 Detected) or generate N synthetic patients with reportable conditions (COVID-19, Chlamydia, Hepatitis C).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  await patientService.loadSampleJaneDoeBundle(fhirContext, {
                    name: user.name,
                    role: user.role,
                  });
                  notify({ title: 'Jane Doe (MRN-1001) clinical bundle loaded', variant: 'success' });
                  await loadPatients();
                }}
              >
                <Database className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Load Jane Doe Bundle</span>
              </Button>
              <input
                type="number"
                aria-label="Number of synthetic patients to generate"
                min={1}
                max={25}
                value={seedCount}
                onChange={(e) => setSeedCount(Number(e.target.value))}
                className="h-8 w-16 rounded border border-slate-300 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
              />
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  const res = await patientService.generateSyntheticPatients(
                    fhirContext,
                    seedCount,
                    { name: user.name, role: user.role },
                  );
                  notify({
                    title: `Generated ${res.patientsCreated} synthetic patients`,
                    description: `${res.reportableCasesCreated} reportable-condition cases included.`,
                    variant: 'success',
                  });
                  await loadPatients();
                }}
              >
                Generate Synthetic Patients
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            aria-label="Filter by gender"
            value={genderFilter}
            options={[
              { value: 'all', label: 'All genders' },
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
              { value: 'other', label: 'Other' },
              { value: 'unknown', label: 'Unknown' },
            ]}
            onChange={(e) => setGenderFilter(e.target.value)}
          />
          <Input
            aria-label="Filter by city"
            placeholder="Filter by city..."
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
          />
        </div>

        <DataTable
          rows={filteredPatients}
          columns={columns}
          getRowKey={(p) => p.id}
          loading={loading}
          onRowClick={(p) => void openChart(p.id)}
          searchPlaceholder="Search patients by name, MRN, or city..."
          searchText={(p) => `${p.fullName} ${p.mrn} ${p.city} ${p.birthDate}`}
        />

        <Modal
          open={newPatOpen}
          title="New Synthetic Patient (Conditional Create on MRN)"
          onClose={() => setNewPatOpen(false)}
          footer={
            <>
              <Button onClick={() => setNewPatOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => void handleCreatePatient()}>
                Save Patient
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="First Name" required value={patForm.given} onChange={(e) => setPatForm({ ...patForm, given: e.target.value })} />
            <Input label="Last Name" required value={patForm.family} onChange={(e) => setPatForm({ ...patForm, family: e.target.value })} />
            <Input label="MRN" required placeholder="MRN-1002" value={patForm.mrn} onChange={(e) => setPatForm({ ...patForm, mrn: e.target.value })} />
            <Input label="Birth Date" type="date" value={patForm.birthDate} onChange={(e) => setPatForm({ ...patForm, birthDate: e.target.value })} />
            <Select
              label="Gender"
              value={patForm.gender}
              options={['female', 'male', 'other', 'unknown'].map((g) => ({ value: g, label: g }))}
              onChange={(e) => setPatForm({ ...patForm, gender: e.target.value as 'male' | 'female' | 'other' | 'unknown' })}
            />
            <Input label="City" value={patForm.city} onChange={(e) => setPatForm({ ...patForm, city: e.target.value })} />
            <Input label="State" value={patForm.state} onChange={(e) => setPatForm({ ...patForm, state: e.target.value })} />
            <Input label="Phone" value={patForm.phone} onChange={(e) => setPatForm({ ...patForm, phone: e.target.value })} />
          </div>
        </Modal>
      </div>
    </Guard>
  );
}
