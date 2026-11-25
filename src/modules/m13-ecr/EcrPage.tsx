import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Download,
  FileCode2,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Guard, useAuth } from '../../app';
import {
  Button,
  Input,
  Modal,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  TextArea,
  useToast,
  type SemanticTone,
} from '../../components';
import { useTenantContext } from '../../tenancy';
import { patientService, type PatientSummaryRow } from '../m4-patients/patientService';
import {
  ecrService,
  type EcrCaseStatus,
  type EcrTriggerCodeSystem,
  type ReportabilityDetermination,
} from './ecrService';

function statusTone(status: EcrCaseStatus): SemanticTone {
  switch (status) {
    case 'RR received':
    case 'Closed':
      return 'success';
    case 'Triggered':
    case 'Data retrieved':
      return 'warning';
    case 'eICR created':
    case 'Submitted':
    case 'Acknowledged':
      return 'info';
  }
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/fhir+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function EcrPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'workflow' | 'triggers' | 'log' | 'adapter' | 'pha'>('workflow');
  const [patients, setPatients] = useState<PatientSummaryRow[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [tick, setTick] = useState(0);

  // Add trigger code form
  const [newSys, setNewSys] = useState<EcrTriggerCodeSystem>('SNOMED');
  const [newCode, setNewCode] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [newGroup, setNewGroup] = useState('Measles');
  const [newResourceType, setNewResourceType] = useState<'Condition' | 'Observation' | 'Encounter' | 'MedicationRequest'>('Condition');
  const [newRequiresPos, setNewRequiresPos] = useState(false);

  // PHA decision notes
  const [phaNotes, setPhaNotes] = useState('Confirmed jurisdiction reportable condition per RCTC rules.');
  const [bundleModalJson, setBundleModalJson] = useState<string | null>(null);

  const state = ecrService.getState(activeTenant.id);

  useEffect(() => {
    let mounted = true;
    void patientService.listPatients(fhirContext).then((list) => {
      if (!mounted) return;
      setPatients(list);
      if (list[0]) setSelectedPatientId(list[0].id);
    });
    const st = ecrService.getState(activeTenant.id);
    setSelectedCaseId(st.cases[0]?.id ?? '');
    return () => {
      mounted = false;
    };
  }, [activeTenant.id, fhirContext]);

  const activeCase = state.cases.find((c) => c.id === selectedCaseId) ?? state.cases[0];

  const handleEvaluatePatient = async () => {
    if (!selectedPatientId) return;
    try {
      const res = await ecrService.evaluatePatientTriggers(fhirContext, selectedPatientId, {
        name: user.name,
        role: user.role,
      });
      setTick((t) => t + 1);
      if (res.triggered && res.createdCase) {
        setSelectedCaseId(res.createdCase.id);
        showToast(
          `CaseTriggered (${res.createdCase.caseNumber}): ${res.createdCase.conditionGroup}`,
          'warning',
        );
      } else {
        showToast('No reportable trigger codes matched for selected patient.', 'info');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Trigger evaluation failed.', 'error');
    }
  };

  const handleScanAll = async () => {
    try {
      const res = await ecrService.scanAllTenantPatients(fhirContext, {
        name: user.name,
        role: user.role,
      });
      setTick((t) => t + 1);
      if (res.casesCreated[0]) setSelectedCaseId(res.casesCreated[0].id);
      showToast(
        `Scanned ${res.scanned} patient(s) — ${res.casesCreated.length} eCR case(s) triggered.`,
        res.casesCreated.length > 0 ? 'success' : 'info',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Batch scan failed.', 'error');
    }
  };

  const handleBuildEicr = async (caseId: string) => {
    try {
      const updated = await ecrService.buildAndValidateEicr(fhirContext, caseId, {
        name: user.name,
        role: user.role,
      });
      setTick((t) => t + 1);
      showToast(
        `eICR v${updated.versionNumber} built & validated (${updated.validationPassed ? 'Valid' : 'Issues found'}).`,
        updated.validationPassed ? 'success' : 'warning',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'eICR build failed.', 'error');
    }
  };

  const handleSubmitEicr = async (caseId: string, autoRr: boolean) => {
    try {
      const updated = await ecrService.submitEicr(
        fhirContext,
        caseId,
        { name: user.name, role: user.role },
        autoRr ? { autoReceiveStubRr: true, simulatedDetermination: 'Reportable' } : undefined,
      );
      setTick((t) => t + 1);
      if (updated.fallbackWarning) {
        showToast(updated.fallbackWarning, 'warning');
      }
      showToast(
        autoRr
          ? `Submitted & received RR (${updated.reportabilityResponse?.determination}).`
          : `Submitted via ${updated.submittedVia}. Ready in PHA Stub Inbox.`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'eICR submission failed.', 'error');
    }
  };

  const handlePhaDecision = async (
    caseId: string,
    accept: boolean,
    determination: ReportabilityDetermination,
  ) => {
    try {
      await ecrService.processPhaDecisionAndRrIntake(
        fhirContext,
        caseId,
        {
          accept,
          determination,
          ruleSummary: phaNotes.trim() || `PHA marked ${determination}`,
          phaReviewer: `${user.name} (PHA Stub)`,
        },
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      showToast(`PHA decision recorded (${determination}) and DocumentReference attached.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PHA decision failed.', 'error');
    }
  };

  const handleAddTrigger = () => {
    const sysUrlMap: Record<EcrTriggerCodeSystem, string> = {
      SNOMED: 'http://snomed.info/sct',
      LOINC: 'http://loinc.org',
      'ICD-10-CM': 'http://hl7.org/fhir/sid/icd-10-cm',
      RxNorm: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    };
    try {
      ecrService.addTriggerCode(activeTenant.id, {
        system: sysUrlMap[newSys],
        systemLabel: newSys,
        code: newCode,
        display: newDisplay,
        conditionGroup: newGroup,
        resourceTypes: [newResourceType],
        requiresPositiveResult: newResourceType === 'Observation' ? newRequiresPos : false,
        active: true,
      });
      setNewCode('');
      setNewDisplay('');
      setTick((t) => t + 1);
      showToast('Added custom trigger code to tenant RCTC value set.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to add trigger code.', 'error');
    }
  };

  const pendingPha = state.cases.filter((c) => c.phaStatus === 'Pending PHA Review');
  const rrCount = state.cases.filter((c) => Boolean(c.reportabilityResponse)).length;

  return (
    <Guard moduleId="m13-ecr" action="view">
      <div className="space-y-6" data-tick={tick}>
        <PageHeader
          kicker="M13 · Electronic Case Reporting (eCR)"
          title="Electronic Case Reporting & eCRNow"
          description="Editable RCTC trigger code value sets, clinical trigger engine, FHIR eICR Composition document builder with $validate, configurable eCRNow adapter/stub, RR DocumentReference intake, and Public Health Authority inbox."
          actions={
            <Button onClick={() => void handleScanAll()}>
              <Play className="h-4 w-4" aria-hidden="true" />
              Scan All Tenant Patients
            </Button>
          }
        />

        {/* KPI Strip */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Trigger Codes</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {state.valueSet.codes.filter((c) => c.active).length}
            </div>
            <div className="mt-1 text-xs text-slate-500">v{state.valueSet.version}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Triggered eCR Cases</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {state.cases.length}
            </div>
            <div className="mt-1 text-xs text-slate-500">{state.triggerLog.length} trigger evaluations</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Reportability Responses</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {rrCount}
            </div>
            <div className="mt-1 text-xs text-slate-500">{pendingPha.length} awaiting PHA review</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">eCRNow Mode</div>
            <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {state.adapterConfig.enabledLive ? 'Live + Stub Fallback' : 'Built-in Stub'}
            </div>
            <div className="mt-1 truncate font-mono text-xs text-slate-500">{state.adapterConfig.baseUrl}</div>
          </div>
        </div>

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'workflow', label: `Case Workflow & eICR (${state.cases.length})` },
            { id: 'triggers', label: `Trigger Codes (${state.valueSet.codes.length})` },
            { id: 'log', label: `Trigger Log (${state.triggerLog.length})` },
            { id: 'adapter', label: 'eCRNow Adapter Config' },
            { id: 'pha', label: `PHA Stub Inbox (${pendingPha.length})` },
          ]}
        />

        {tab === 'workflow' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Run On-Demand Patient Trigger Check
                </h2>
                <div className="mt-3 space-y-3">
                  <Select
                    label="M4 Patient"
                    value={selectedPatientId}
                    onChange={(e) => setSelectedPatientId(e.target.value)}
                    options={patients.map((p) => ({
                      value: p.id,
                      label: `${p.fullName} (${p.mrn || p.id})`,
                    }))}
                  />
                  <Button className="w-full" onClick={() => void handleEvaluatePatient()}>
                    <Activity className="h-4 w-4" aria-hidden="true" />
                    Evaluate Trigger Engine
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  eCR Cases ({state.cases.length})
                </h2>
                <div className="mt-3 space-y-2">
                  {state.cases.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No cases triggered yet. Evaluate Jane Doe (COVID-19 positive) or click &quot;Scan All Tenant Patients&quot;.
                    </p>
                  ) : (
                    state.cases.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCaseId(c.id)}
                        className={`w-full rounded-md border p-3 text-left transition ${
                          activeCase?.id === c.id
                            ? 'border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/30'
                            : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {c.caseNumber} · v{c.versionNumber}
                          </span>
                          <SemanticStatus tone={statusTone(c.status)} label={c.status} />
                        </div>
                        <div className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-200">
                          {c.patientName}
                        </div>
                        <div className="text-xs text-slate-500">{c.conditionGroup}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-8">
              {activeCase ? (
                <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
                    <div>
                      <div className="font-mono text-xs text-slate-500">
                        {activeCase.caseNumber} · Patient/{activeCase.patientId} · Version {activeCase.versionNumber}
                      </div>
                      <h2 className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {activeCase.patientName} — {activeCase.conditionGroup}
                      </h2>
                      <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        Triggers: {activeCase.matchedTriggers.join(' · ')}
                      </div>
                    </div>
                    <SemanticStatus tone={statusTone(activeCase.status)} label={activeCase.status} />
                  </div>

                  {/* Action Bar */}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void handleBuildEicr(activeCase.id)}>
                      <FileCode2 className="h-4 w-4" aria-hidden="true" />
                      Build &amp; $validate eICR
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void handleSubmitEicr(activeCase.id, false)}
                      disabled={activeCase.status === 'Closed'}
                    >
                      <Send className="h-4 w-4" aria-hidden="true" />
                      Submit to PHA Stub
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void handleSubmitEicr(activeCase.id, true)}
                      disabled={activeCase.status === 'Closed'}
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Submit + Auto Stub RR
                    </Button>
                    {activeCase.eicrBundle && (
                      <>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setBundleModalJson(JSON.stringify(activeCase.eicrBundle, null, 2))
                          }
                        >
                          Preview eICR JSON
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            downloadJson(
                              `${activeCase.caseNumber}-v${activeCase.versionNumber}-eicr.json`,
                              activeCase.eicrBundle,
                            )
                          }
                        >
                          <Download className="h-4 w-4" aria-hidden="true" />
                          Download eICR
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        await ecrService.createFollowUpUpdate(fhirContext, activeCase.id, {
                          name: user.name,
                          role: user.role,
                        });
                        setTick((t) => t + 1);
                        showToast('Generated follow-up eICR version.', 'info');
                      }}
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      Follow-Up Update
                    </Button>
                    {activeCase.status !== 'Closed' && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          ecrService.closeCase(
                            activeTenant.id,
                            activeCase.id,
                            'Case reporting lifecycle verified and closed.',
                            `${user.name} (${user.role})`,
                          );
                          setTick((t) => t + 1);
                          showToast(`Closed ${activeCase.caseNumber}.`, 'success');
                        }}
                      >
                        Close Case
                      </Button>
                    )}
                  </div>

                  {/* Validation Outcome & RR Summary */}
                  {activeCase.validationOutcome && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
                      <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                        FHIR $validate Result: {activeCase.validationPassed ? 'PASSED' : 'ISSUES DETECTED'} (
                        {activeCase.eicrBundle?.entry?.length ?? 0} Bundle entries with Composition)
                      </div>
                      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-slate-600 dark:text-slate-300">
                        {(activeCase.validationOutcome.issue ?? []).map((iss, i) => (
                          <li key={i}>
                            [{iss.severity}] {iss.diagnostics ?? iss.code}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {activeCase.reportabilityResponse && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
                      <div className="font-semibold text-emerald-900 dark:text-emerald-200">
                        Reportability Response (RR): {activeCase.reportabilityResponse.determination}
                      </div>
                      <div className="mt-1 text-emerald-800 dark:text-emerald-300">
                        Jurisdiction: {activeCase.reportabilityResponse.jurisdiction} · Attached{' '}
                        <span className="font-mono">
                          DocumentReference/{activeCase.reportabilityResponse.documentReferenceId}
                        </span>
                      </div>
                      <div className="mt-0.5 text-emerald-700 dark:text-emerald-400">
                        {activeCase.reportabilityResponse.ruleSummary}
                      </div>
                    </div>
                  )}

                  {/* Workflow History */}
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Workflow Audit Trail
                    </h3>
                    <ol className="mt-2 space-y-2 border-l-2 border-slate-200 pl-4 dark:border-slate-800">
                      {activeCase.history.map((h, idx) => (
                        <li key={idx} className="text-xs">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {h.status}{' '}
                            <span className="font-normal text-slate-500">
                              · {h.timestamp.slice(0, 19).replace('T', ' ')} · {h.actor}
                            </span>
                          </div>
                          <div className="text-slate-600 dark:text-slate-300">{h.note}</div>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700">
                  Select an eCR case on the left or run the trigger engine on a reportable patient.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'triggers' && (
          <div className="space-y-4">
            <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-3">
              <Input
                label="RCTC ValueSet Version"
                value={state.valueSet.version}
                onChange={(e) => {
                  ecrService.updateValueSetMetadata(activeTenant.id, { version: e.target.value });
                  setTick((t) => t + 1);
                }}
              />
              <Input
                label="Effective Date"
                type="date"
                value={state.valueSet.effectiveDate}
                onChange={(e) => {
                  ecrService.updateValueSetMetadata(activeTenant.id, { effectiveDate: e.target.value });
                  setTick((t) => t + 1);
                }}
              />
              <div className="flex flex-col justify-end text-xs text-slate-500">
                Last updated: <span className="font-mono">{state.valueSet.lastUpdated}</span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Add Custom Trigger Code
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <Select
                  label="Code System"
                  value={newSys}
                  onChange={(e) => setNewSys(e.target.value as EcrTriggerCodeSystem)}
                  options={[
                    { value: 'SNOMED', label: 'SNOMED CT' },
                    { value: 'LOINC', label: 'LOINC' },
                    { value: 'ICD-10-CM', label: 'ICD-10-CM' },
                    { value: 'RxNorm', label: 'RxNorm' },
                  ]}
                />
                <Input label="Code" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="e.g., B05.9" />
                <Input label="Display" value={newDisplay} onChange={(e) => setNewDisplay(e.target.value)} placeholder="Condition / Lab name" />
                <Input label="Condition Group" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
                <Select
                  label="FHIR Resource"
                  value={newResourceType}
                  onChange={(e) => setNewResourceType(e.target.value as typeof newResourceType)}
                  options={[
                    { value: 'Condition', label: 'Condition' },
                    { value: 'Observation', label: 'Observation' },
                    { value: 'Encounter', label: 'Encounter' },
                    { value: 'MedicationRequest', label: 'MedicationRequest' },
                  ]}
                />
                <div className="flex items-end">
                  <Button className="w-full" onClick={handleAddTrigger}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add Code
                  </Button>
                </div>
              </div>
              {newResourceType === 'Observation' && (
                <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={newRequiresPos}
                    onChange={(e) => setNewRequiresPos(e.target.checked)}
                  />
                  Require Positive / Detected Observation result
                </label>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                  <tr>
                    <th className="px-4 py-3">Group</th>
                    <th className="px-4 py-3">System / Code</th>
                    <th className="px-4 py-3">Display</th>
                    <th className="px-4 py-3">Resources</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {state.valueSet.codes.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        {c.conditionGroup}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {c.systemLabel}:{c.code}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                        {c.display}
                        {c.requiresPositiveResult && (
                          <span className="ml-1.5 text-amber-700 dark:text-amber-400">(Positive only)</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs">{c.resourceTypes.join(', ')}</td>
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Toggle ${c.code}`}
                          checked={c.active}
                          onChange={(e) => {
                            ecrService.updateTriggerCode(activeTenant.id, c.id, { active: e.target.checked });
                            setTick((t) => t + 1);
                          }}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            ecrService.deleteTriggerCode(activeTenant.id, c.id);
                            setTick((t) => t + 1);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'log' && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Source Resource</th>
                  <th className="px-4 py-3">Code / Detail</th>
                  <th className="px-4 py-3">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {state.triggerLog.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">
                      No trigger evaluations recorded yet.
                    </td>
                  </tr>
                ) : (
                  state.triggerLog.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                        {entry.timestamp.slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        {entry.patientName}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {entry.sourceResourceType}/{entry.sourceResourceId}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <span className="font-mono">{entry.matchedCode}</span> — {entry.matchedDisplay}
                      </td>
                      <td className="px-4 py-2.5">
                        <SemanticStatus
                          tone={entry.triggered ? 'warning' : 'neutral'}
                          label={entry.triggered ? 'Triggered' : 'No Match'}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'adapter' && (
          <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Configurable eCRNow Adapter Paths
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Endpoint paths vary across eCRNow releases. Configure your local eCRNow instance (default port 8080) or keep Built-in Stub enabled for deterministic offline simulation.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="eCRNow Base URL"
                value={state.adapterConfig.baseUrl}
                onChange={(e) => {
                  ecrService.updateAdapterConfig(activeTenant.id, { baseUrl: e.target.value });
                  setTick((t) => t + 1);
                }}
              />
              <Input
                label="PHA Jurisdiction Name"
                value={state.adapterConfig.defaultJurisdiction}
                onChange={(e) => {
                  ecrService.updateAdapterConfig(activeTenant.id, {
                    defaultJurisdiction: e.target.value,
                  });
                  setTick((t) => t + 1);
                }}
              />
              <Input
                label="Trigger Launch Path"
                value={state.adapterConfig.triggerPath}
                onChange={(e) => {
                  ecrService.updateAdapterConfig(activeTenant.id, { triggerPath: e.target.value });
                  setTick((t) => t + 1);
                }}
              />
              <Input
                label="eICR Submit Path"
                value={state.adapterConfig.submitPath}
                onChange={(e) => {
                  ecrService.updateAdapterConfig(activeTenant.id, { submitPath: e.target.value });
                  setTick((t) => t + 1);
                }}
              />
              <Input
                label="Status / RR Poll Path"
                value={state.adapterConfig.statusPath}
                onChange={(e) => {
                  ecrService.updateAdapterConfig(activeTenant.id, { statusPath: e.target.value });
                  setTick((t) => t + 1);
                }}
              />
              <div className="flex items-end pb-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={state.adapterConfig.enabledLive}
                    onChange={(e) => {
                      ecrService.updateAdapterConfig(activeTenant.id, {
                        enabledLive: e.target.checked,
                      });
                      setTick((t) => t + 1);
                    }}
                  />
                  Attempt Live eCRNow HTTP POST (auto-fallback to stub on error)
                </label>
              </div>
            </div>
          </div>
        )}

        {tab === 'pha' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <TextArea
                label="PHA Determination Rule Summary / Notes"
                rows={2}
                value={phaNotes}
                onChange={(e) => setPhaNotes(e.target.value)}
              />
            </div>

            {state.cases.filter((c) => c.phaStatus !== 'Not Submitted').length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                No eICRs submitted to the Public Health Authority stub yet.
              </div>
            ) : (
              <div className="space-y-3">
                {state.cases
                  .filter((c) => c.phaStatus !== 'Not Submitted')
                  .map((c) => (
                    <div
                      key={c.id}
                      className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {c.caseNumber} (v{c.versionNumber}) · {c.patientName} — {c.conditionGroup}
                          </div>
                          <div className="text-xs text-slate-500">
                            Ack: {c.submissionAckId} · Channel: {c.submittedVia}
                          </div>
                        </div>
                        <SemanticStatus
                          tone={
                            c.phaStatus === 'Accepted'
                              ? 'success'
                              : c.phaStatus === 'Rejected'
                                ? 'danger'
                                : 'warning'
                          }
                          label={c.phaStatus}
                        />
                      </div>

                      {c.phaStatus === 'Pending PHA Review' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => void handlePhaDecision(c.id, true, 'Reportable')}
                          >
                            Accept — Reportable
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handlePhaDecision(c.id, true, 'May be reportable')}
                          >
                            Accept — May Be Reportable
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => void handlePhaDecision(c.id, false, 'Not reportable')}
                          >
                            Reject — Not Reportable
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        <Modal
          open={Boolean(bundleModalJson)}
          onClose={() => setBundleModalJson(null)}
          title="FHIR eICR Document Bundle (JSON)"
        >
          <pre className="max-h-[60vh] overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-100">
            {bundleModalJson}
          </pre>
        </Modal>
      </div>
    </Guard>
  );
}
