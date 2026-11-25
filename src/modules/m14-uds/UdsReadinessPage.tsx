import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Filter,
  Plus,
  RefreshCw,
  Send,
  Shield,
  Trash2,
} from 'lucide-react';
import { Guard, useAuth } from '../../app';
import {
  Button,
  Input,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  useToast,
  type SemanticTone,
} from '../../components';
import { useTenantContext } from '../../tenancy';
import {
  udsService,
  type UdsAvailability,
  type UdsRequirementCategory,
  type UdsRequirementEvaluation,
} from './udsService';

function availabilityTone(av: UdsAvailability): SemanticTone {
  if (av === 'Present') return 'success';
  if (av === 'Partial') return 'warning';
  return 'danger';
}

function downloadJsonString(filename: string, rawJson: string) {
  const blob = new Blob([rawJson], { type: 'application/fhir+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function UdsReadinessPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'scorecard' | 'cohort' | 'validate' | 'submissions' | 'config'>('scorecard');
  const [evaluations, setEvaluations] = useState<UdsRequirementEvaluation[]>([]);
  const [overallPct, setOverallPct] = useState(0);
  const [selectedPreviewIdx, setSelectedPreviewIdx] = useState(0);
  const [tick, setTick] = useState(0);

  // Cohort filter form
  const state = udsService.getState(activeTenant.id);
  const [periodStart, setPeriodStart] = useState(state.criteria.periodStart);
  const [periodEnd, setPeriodEnd] = useState(state.criteria.periodEnd);
  const [minEncounters, setMinEncounters] = useState(state.criteria.minEncounters);
  const [stateFilter, setStateFilter] = useState(state.criteria.stateFilter);
  const [genderFilter, setGenderFilter] = useState(state.criteria.genderFilter);

  // Add requirement form
  const [reqCat, setReqCat] = useState<UdsRequirementCategory>('SDOH');
  const [reqName, setReqName] = useState('');
  const [reqPath, setReqPath] = useState('');
  const [reqProfile, setReqProfile] = useState('uds-plus-observation');

  const runCohortRefresh = async () => {
    const res = await udsService.buildCohort(fhirContext, {
      periodStart,
      periodEnd,
      minEncounters,
      stateFilter,
      genderFilter,
    });
    setEvaluations(res.evaluations);
    setOverallPct(res.overallCompletenessPct);
    setTick((t) => t + 1);
    return res;
  };

  useEffect(() => {
    void runCohortRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id, fhirContext]);

  const handleDeidentify = () => {
    try {
      const res = udsService.deidentifyCohort(activeTenant.id);
      setSelectedPreviewIdx(0);
      setTick((t) => t + 1);
      showToast(
        `De-identified ${res.previews.length} patient(s) with salted-hash pseudonyms & consistent date shifts (in-memory only).`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'De-identification failed.', 'error');
    }
  };

  const handleValidate = async () => {
    try {
      const res = await udsService.validateCohortAgainstProfiles(fhirContext);
      setTick((t) => t + 1);
      showToast(
        `Profile $validate complete: ${res.passedCount} passed, ${res.errorCount} error(s), ${res.warningCount} warning(s).`,
        res.errorCount > 0 ? 'error' : res.warningCount > 0 ? 'warning' : 'success',
      );
      setTab('validate');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Validation failed.', 'error');
    }
  };

  const handleSubmitBundle = async (simulateRejection: boolean) => {
    try {
      const rec = await udsService.submitDeidentifiedBundle(
        fhirContext,
        { name: user.name, role: user.role },
        { simulateRejection },
      );
      setTick((t) => t + 1);
      showToast(
        `Submission ${rec.submissionNumber}: ${rec.status}`,
        rec.status === 'Rejected' ? 'error' : 'success',
      );
      setTab('submissions');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Submission failed.', 'error');
    }
  };

  const handleAddRequirement = () => {
    try {
      udsService.addRequirement(activeTenant.id, {
        category: reqCat,
        name: reqName,
        fhirPath: reqPath,
        igProfile: reqProfile,
        required: true,
        notes: 'Custom IG requirement added by tenant.',
      });
      setReqName('');
      setReqPath('');
      const refreshed = udsService.evaluateRequirementsForCharts(
        activeTenant.id,
        state.lastCohortCharts,
      );
      setEvaluations(refreshed.evaluations);
      setOverallPct(refreshed.overallCompletenessPct);
      setTick((t) => t + 1);
      showToast('Added UDS+ requirement to editable checklist.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to add requirement.', 'error');
    }
  };

  const activePreview = state.lastDeidentifiedPreviews[selectedPreviewIdx];

  return (
    <Guard moduleId="m14-uds" action="view">
      <div className="space-y-6" data-tick={tick}>
        <PageHeader
          kicker="M14 · UDS+ Reporting Readiness"
          title="HRSA UDS+ Reporting Readiness"
          description="Editable UDS+ IG checklist and completeness scorecard, cohort builder, in-memory de-identification (date shift, 3-digit ZIP, salted pseudonyms), profile $validate with M4 fix links, and submission bundle workflow."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={handleDeidentify}>
                <Shield className="h-4 w-4" aria-hidden="true" />
                De-Identify Cohort
              </Button>
              <Button onClick={() => void handleValidate()}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Run Profile $validate
              </Button>
            </div>
          }
        />

        {/* KPI Strip */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">UDS+ Completeness Score</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {overallPct}%
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${overallPct}%` }}
                aria-label={`Overall completeness ${overallPct} percent`}
              />
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Cohort Size</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {state.lastCohortCharts.length}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {periodStart} to {periodEnd}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">De-Identified Records</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {state.lastDeidentifiedPreviews.length}
            </div>
            <div className="mt-1 text-xs text-slate-500">Pseudonym map kept in memory only</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Validation Gaps / Submissions</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {state.lastValidationFindings.length} / {state.submissions.length}
            </div>
            <div className="mt-1 text-xs text-slate-500">Findings · HRSA submissions</div>
          </div>
        </div>

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'scorecard', label: `Requirements & Scorecard (${evaluations.length})` },
            { id: 'cohort', label: `Cohort & De-Identification (${state.lastCohortCharts.length})` },
            { id: 'validate', label: `Profile $validate & Fixes (${state.lastValidationFindings.length})` },
            { id: 'submissions', label: `Submission Bundle & History (${state.submissions.length})` },
            { id: 'config', label: 'UDS+ / US Core Profiles' },
          ]}
        />

        {tab === 'scorecard' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Add Editable IG Requirement
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Select
                  label="Category"
                  value={reqCat}
                  onChange={(e) => setReqCat(e.target.value as UdsRequirementCategory)}
                  options={[
                    { value: 'Demographics', label: 'Demographics' },
                    { value: 'SDOH', label: 'SDOH' },
                    { value: 'Encounters', label: 'Encounters' },
                    { value: 'Diagnoses', label: 'Diagnoses' },
                    { value: 'Labs', label: 'Labs' },
                    { value: 'Vitals', label: 'Vitals' },
                    { value: 'Immunizations', label: 'Immunizations' },
                    { value: 'Measure Inputs', label: 'Measure Inputs' },
                  ]}
                />
                <Input label="Element Name" value={reqName} onChange={(e) => setReqName(e.target.value)} placeholder="e.g., Housing Status" />
                <Input label="Source FHIR Path" value={reqPath} onChange={(e) => setReqPath(e.target.value)} placeholder="Observation.code(71802-3)" />
                <Input label="IG Profile" value={reqProfile} onChange={(e) => setReqProfile(e.target.value)} />
                <div className="flex items-end">
                  <Button className="w-full" onClick={handleAddRequirement}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add Element
                  </Button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                  <tr>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Data Element</th>
                    <th className="px-4 py-3">FHIR Path</th>
                    <th className="px-4 py-3">Availability</th>
                    <th className="px-4 py-3">Completeness</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {evaluations.map((ev) => (
                    <tr key={ev.requirement.id}>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                        {ev.requirement.category}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {ev.requirement.name}
                        </div>
                        <div className="text-xs text-slate-500">{ev.requirement.notes}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                        {ev.requirement.fhirPath}
                      </td>
                      <td className="px-4 py-3">
                        <SemanticStatus
                          tone={availabilityTone(ev.availability)}
                          label={ev.availability}
                        />
                      </td>
                      <td className="px-4 py-3 tabular-nums text-xs">
                        {ev.completenessPct}% ({ev.presentCount}/{ev.cohortSize})
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            udsService.deleteRequirement(activeTenant.id, ev.requirement.id);
                            const next = udsService.evaluateRequirementsForCharts(
                              activeTenant.id,
                              state.lastCohortCharts,
                            );
                            setEvaluations(next.evaluations);
                            setOverallPct(next.overallCompletenessPct);
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

        {tab === 'cohort' && (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-6">
              <Input label="Period Start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              <Input label="Period End" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              <Input
                label="Min Encounters"
                type="number"
                min={0}
                value={minEncounters}
                onChange={(e) => setMinEncounters(Number(e.target.value))}
              />
              <Input label="State Filter" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} placeholder="All" />
              <Select
                label="Gender"
                value={genderFilter}
                onChange={(e) => setGenderFilter(e.target.value as typeof genderFilter)}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'female', label: 'Female' },
                  { value: 'male', label: 'Male' },
                  { value: 'other', label: 'Other' },
                ]}
              />
              <div className="flex items-end gap-2">
                <Button
                  className="w-full"
                  onClick={async () => {
                    const res = await runCohortRefresh();
                    showToast(`Cohort refreshed: ${res.charts.length} patient(s) matched.`, 'info');
                  }}
                >
                  <Filter className="h-4 w-4" aria-hidden="true" />
                  Apply
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    De-Identification Before &amp; After Preview
                  </h2>
                  <p className="text-xs text-slate-500">
                    Strips names, contacts, MRNs, SSNs, and exact street addresses; generalizes ZIP to 3 digits; applies consistent per-patient date shift and salted-hash pseudonym kept strictly in memory.
                  </p>
                </div>
                <Button onClick={handleDeidentify}>
                  <Shield className="h-4 w-4" aria-hidden="true" />
                  Run De-Identification
                </Button>
              </div>

              {state.lastDeidentifiedPreviews.length > 0 && activePreview ? (
                <div className="mt-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="w-72">
                      <Select
                        label="Inspect Cohort Patient"
                        value={String(selectedPreviewIdx)}
                        onChange={(e) => setSelectedPreviewIdx(Number(e.target.value))}
                        options={state.lastDeidentifiedPreviews.map((p, idx) => ({
                          value: String(idx),
                          label: `Patient/${p.originalPatientId} → ${p.pseudonymId} (shift ${p.dateShiftDays > 0 ? '+' : ''}${p.dateShiftDays}d)`,
                        }))}
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-semibold text-rose-700 dark:text-rose-400">
                        BEFORE (Identified Source FHIR Patient)
                      </div>
                      <pre className="max-h-80 overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-100">
                        {JSON.stringify(activePreview.before, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        AFTER (De-Identified UDS+ Patient · Pseudonym {activePreview.pseudonymId})
                      </div>
                      <pre className="max-h-80 overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-100">
                        {JSON.stringify(activePreview.after, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-xs text-slate-500">
                  Click &quot;Run De-Identification&quot; to inspect before/after JSON transformations.
                </p>
              )}
            </div>
          </div>
        )}

        {tab === 'validate' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Validates de-identified resources via <span className="font-mono">$validate</span> against configured UDS+ and US Core profile URLs.
              </p>
              <Button onClick={() => void handleValidate()}>Re-Run $validate</Button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                  <tr>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Pseudonym / Resource</th>
                    <th className="px-4 py-3">Profile &amp; Diagnostic</th>
                    <th className="px-4 py-3">Remediation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {state.lastValidationFindings.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-500">
                        No validation gaps reported. Run Profile $validate to inspect cohort records.
                      </td>
                    </tr>
                  ) : (
                    state.lastValidationFindings.map((f) => (
                      <tr key={f.id}>
                        <td className="px-4 py-3">
                          <SemanticStatus
                            tone={f.severity === 'error' ? 'danger' : 'warning'}
                            label={f.severity.toUpperCase()}
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {f.resourceType}/{f.pseudonymId}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="font-medium text-slate-900 dark:text-slate-100">{f.message}</div>
                          <div className="font-mono text-slate-500">{f.profileUrl}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Button size="sm" variant="secondary" onClick={() => navigate('/patients')}>
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            {f.fixActionLabel}
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'submissions' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <Button onClick={() => void handleSubmitBundle(false)}>
                <Send className="h-4 w-4" aria-hidden="true" />
                Build &amp; Submit UDS+ Bundle (Accept Stub)
              </Button>
              <Button variant="secondary" onClick={() => void handleSubmitBundle(true)}>
                Simulate HRSA Rejection
              </Button>
              {state.lastDeidentifiedBundle && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    downloadJsonString(
                      `uds-plus-deidentified-${activeTenant.code}.json`,
                      JSON.stringify(state.lastDeidentifiedBundle, null, 2),
                    )
                  }
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download Current Bundle JSON
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {state.submissions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                  No UDS+ submissions yet. Build and submit a de-identified collection Bundle above.
                </div>
              ) : (
                state.submissions.map((sub) => (
                  <div
                    key={sub.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {sub.submissionNumber} · {sub.cohortSize} patients · {sub.resourceCount} FHIR resources
                        </div>
                        <div className="text-xs text-slate-500">
                          Period: {sub.reportingPeriod} · MeasureReport/{sub.measureReportId ?? '—'}
                          {sub.ackId ? ` · Ack: ${sub.ackId}` : ''}
                        </div>
                        {sub.rejectionReason && (
                          <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                            {sub.rejectionReason}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <SemanticStatus
                          tone={
                            sub.status === 'Acknowledged' || sub.status === 'Resubmitted'
                              ? 'success'
                              : sub.status === 'Rejected'
                                ? 'danger'
                                : 'info'
                          }
                          label={sub.status}
                        />
                        {sub.status === 'Rejected' && (
                          <Button
                            size="sm"
                            onClick={() => {
                              udsService.resubmitBundle(activeTenant.id, sub.id);
                              setTick((t) => t + 1);
                              showToast(`Resubmitted ${sub.submissionNumber}.`, 'success');
                            }}
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            Resubmit
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => downloadJsonString(`${sub.submissionNumber}.json`, sub.bundleJson)}
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          JSON
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'config' && (
          <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2">
            <Input
              label="IG Version Label"
              value={state.profileConfig.igVersion}
              onChange={(e) => {
                udsService.updateProfileConfig(activeTenant.id, { igVersion: e.target.value });
                setTick((t) => t + 1);
              }}
            />
            <Input
              label="UDS+ Patient Profile URL"
              value={state.profileConfig.udsPatientProfile}
              onChange={(e) => {
                udsService.updateProfileConfig(activeTenant.id, {
                  udsPatientProfile: e.target.value,
                });
                setTick((t) => t + 1);
              }}
            />
            <Input
              label="US Core Patient Profile URL"
              value={state.profileConfig.usCorePatientProfile}
              onChange={(e) => {
                udsService.updateProfileConfig(activeTenant.id, {
                  usCorePatientProfile: e.target.value,
                });
                setTick((t) => t + 1);
              }}
            />
            <Input
              label="UDS+ Encounter Profile URL"
              value={state.profileConfig.udsEncounterProfile}
              onChange={(e) => {
                udsService.updateProfileConfig(activeTenant.id, {
                  udsEncounterProfile: e.target.value,
                });
                setTick((t) => t + 1);
              }}
            />
          </div>
        )}
      </div>
    </Guard>
  );
}
