import { useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  Play,
  Printer,
  Upload,
} from 'lucide-react';
import { Guard, useAuth } from '../../app';
import {
  Button,
  Input,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  TextArea,
  useToast,
  type SemanticTone,
} from '../../components';
import { useTenantContext } from '../../tenancy';
import {
  COMMON_CONFORMANCE_FIXES,
  SAMPLE_INFERNO_JSON,
  conformanceService,
  type TriageCauseCategory,
  type TriageStatus,
} from './conformanceService';

function checkTone(status: 'Pass' | 'Warn' | 'Fail'): SemanticTone {
  if (status === 'Pass') return 'success';
  if (status === 'Warn') return 'warning';
  return 'danger';
}

function triageTone(status: TriageStatus): SemanticTone {
  if (status === 'Resolved') return 'success';
  if (status === 'Investigating') return 'warning';
  if (status === 'Waived') return 'neutral';
  return 'danger';
}

export function ConformancePage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'probes' | 'inferno' | 'trends' | 'triage' | 'report'>('probes');
  const [importFormat, setImportFormat] = useState<'JSON' | 'CSV'>('JSON');
  const [importText, setImportText] = useState(SAMPLE_INFERNO_JSON);
  const [showTrendTable, setShowTrendTable] = useState(false);
  const [tick, setTick] = useState(0);

  const state = conformanceService.getState(activeTenant.id);
  const latestRun = state.runs[state.runs.length - 1];

  const handleRunProbes = async () => {
    const checks = await conformanceService.runBuiltInChecks(fhirContext);
    setTick((t) => t + 1);
    const failed = checks.filter((c) => c.status === 'Fail').length;
    showToast(
      `Executed ${checks.length} built-in FHIR R4 probes (${checks.length - failed} pass/warn, ${failed} fail).`,
      failed > 0 ? 'warning' : 'success',
    );
  };

  const handleImport = (content: string, fmt: 'JSON' | 'CSV' | 'Sample') => {
    try {
      const { run, createdTriageCount } = conformanceService.importInfernoResults(
        activeTenant.id,
        content,
        fmt,
        user.name,
      );
      setTick((t) => t + 1);
      showToast(
        `Imported Inferno run (${run.passRatePct}% pass rate). Created ${createdTriageCount} triage card(s).`,
        createdTriageCount > 0 ? 'warning' : 'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed.', 'error');
    }
  };

  const handleFileUpload = async (file: File | null) => {
    if (!file) return;
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.json') && !ext.endsWith('.csv')) {
      showToast('Only .json and .csv Inferno result files are permitted.', 'error');
      return;
    }
    const text = await file.text();
    const detected: 'JSON' | 'CSV' = ext.endsWith('.csv') ? 'CSV' : 'JSON';
    setImportFormat(detected);
    setImportText(text);
    handleImport(text, detected);
  };

  const reportMarkdown = conformanceService.generateConformanceReportMarkdown(activeTenant.id);

  return (
    <Guard moduleId="m15-conformance" action="view">
      <div className="space-y-6" data-tick={tick}>
        <PageHeader
          kicker="M15 · FHIR Conformance & Inferno"
          title="FHIR Conformance & Inferno Dashboard"
          description="Automated built-in FHIR R4 conformance probes, Inferno test kit configuration, JSON/CSV result importer with pass-rate trend history, failure triage board, common fix catalogue, and printable report."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => handleImport(SAMPLE_INFERNO_JSON, 'Sample')}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                Import Sample Inferno Run
              </Button>
              <Button onClick={() => void handleRunProbes()}>
                <Play className="h-4 w-4" aria-hidden="true" />
                Run Built-in Checks
              </Button>
            </div>
          }
        />

        {/* KPI Strip */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500">Latest Inferno Pass Rate</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {latestRun ? `${latestRun.passRatePct}%` : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {latestRun
                ? `${latestRun.passCount} pass · ${latestRun.failCount} fail · ${latestRun.skipCount} skip`
                : 'No runs imported'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500">Built-In R4 Probes</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {state.builtInChecks.filter((c) => c.status === 'Pass').length}/{state.builtInChecks.length || 6}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {state.lastBuiltInRunAt ? `Ran ${state.lastBuiltInRunAt.slice(0, 16).replace('T', ' ')}` : 'Not run yet'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500">Open Failure Triage</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-rose-700 dark:text-rose-400">
              {state.triageItems.filter((t) => t.status !== 'Resolved').length}
            </div>
            <div className="mt-1 text-xs text-slate-500">{state.triageItems.length} total cards</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500">Imported Inferno Runs</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {state.runs.length}
            </div>
            <div className="mt-1 text-xs text-slate-500">{state.config.igVersion} target</div>
          </div>
        </div>

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'probes', label: `Built-In Probes (${state.builtInChecks.length || 6})` },
            { id: 'inferno', label: 'Inferno Config & Import' },
            { id: 'trends', label: `Run History & Trends (${state.runs.length})` },
            { id: 'triage', label: `Failure Triage & Fixes (${state.triageItems.length})` },
            { id: 'report', label: 'Printable Report' },
          ]}
        />

        {tab === 'probes' && (
          <div className="space-y-4">
            {state.builtInChecks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                Click &quot;Run Built-in Checks&quot; to probe fhirVersion 4.0.1, CapabilityStatement, search parameters, $validate, meta.profile claims, and reference integrity.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {state.builtInChecks.map((chk) => (
                  <div
                    key={chk.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {chk.name}
                      </h2>
                      <SemanticStatus tone={checkTone(chk.status)} label={chk.status} />
                    </div>
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{chk.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'inferno' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Inferno Configuration Card
                </h2>
                <a
                  href={state.config.infernoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Open Inferno
                </a>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Inferno Base URL"
                  value={state.config.infernoUrl}
                  onChange={(e) => {
                    conformanceService.updateConfig(activeTenant.id, { infernoUrl: e.target.value });
                    setTick((t) => t + 1);
                  }}
                />
                <Input
                  label="Target FHIR Base URL"
                  value={state.config.targetFhirBase}
                  onChange={(e) => {
                    conformanceService.updateConfig(activeTenant.id, { targetFhirBase: e.target.value });
                    setTick((t) => t + 1);
                  }}
                />
                <Input
                  label="Test Suite"
                  value={state.config.testSuite}
                  onChange={(e) => {
                    conformanceService.updateConfig(activeTenant.id, { testSuite: e.target.value });
                    setTick((t) => t + 1);
                  }}
                />
                <Input
                  label="IG Version"
                  value={state.config.igVersion}
                  onChange={(e) => {
                    conformanceService.updateConfig(activeTenant.id, { igVersion: e.target.value });
                    setTick((t) => t + 1);
                  }}
                />
              </div>
              <Input
                label="Test Patient IDs (comma-separated)"
                value={state.config.patientIds}
                onChange={(e) => {
                  conformanceService.updateConfig(activeTenant.id, { patientIds: e.target.value });
                  setTick((t) => t + 1);
                }}
              />

              <div>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-500">
                  <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
                  Manual Execution Steps Checklist
                </h3>
                <ul className="mt-2 space-y-2">
                  {state.config.manualChecklist.map((item) => (
                    <li key={item.id}>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={item.done}
                          onChange={() => {
                            conformanceService.toggleChecklistItem(activeTenant.id, item.id);
                            setTick((t) => t + 1);
                          }}
                        />
                        <span className={item.done ? 'line-through opacity-60' : ''}>
                          {item.label}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Import Inferno Result File (JSON / CSV)
              </h2>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-36">
                  <Select
                    label="Format"
                    value={importFormat}
                    onChange={(e) => setImportFormat(e.target.value as 'JSON' | 'CSV')}
                    options={[
                      { value: 'JSON', label: 'JSON' },
                      { value: 'CSV', label: 'CSV' },
                    ]}
                  />
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  Upload .json / .csv
                  <input
                    type="file"
                    accept=".json,.csv,application/json,text/csv"
                    className="sr-only"
                    onChange={(e) => void handleFileUpload(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              <TextArea
                label="Paste Inferno JSON or CSV Payload"
                rows={10}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <Button className="w-full" onClick={() => handleImport(importText, importFormat)}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Validate &amp; Import Inferno Results
              </Button>
            </div>
          </div>
        )}

        {tab === 'trends' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Inferno Pass-Rate Trend
                  </h2>
                  <p className="text-xs text-slate-500">
                    Accessible visual bar chart with data table toggle showing pass rate across imported runs.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowTrendTable((v) => !v)}
                >
                  {showTrendTable ? 'Show Chart View' : 'Show Table View'}
                </Button>
              </div>

              {!showTrendTable ? (
                <div className="mt-4 space-y-3" role="img" aria-label="Inferno pass rate trend chart across runs">
                  {state.runs.map((run) => (
                    <div key={run.id} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {run.suiteName} ({run.importedAt.slice(0, 10)})
                        </span>
                        <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {run.passRatePct}% ({run.passCount}P / {run.failCount}F / {run.skipCount}S / {run.omitCount}O)
                        </span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div
                          className={`h-full ${run.passRatePct >= 90 ? 'bg-emerald-600' : run.passRatePct >= 75 ? 'bg-amber-500' : 'bg-rose-600'}`}
                          style={{ width: `${run.passRatePct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Suite</th>
                        <th className="px-3 py-2">Pass</th>
                        <th className="px-3 py-2">Fail</th>
                        <th className="px-3 py-2">Skip</th>
                        <th className="px-3 py-2">Omit</th>
                        <th className="px-3 py-2">Pass Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {state.runs.map((r) => (
                        <tr key={r.id}>
                          <td className="px-3 py-2 font-mono text-xs">{r.importedAt.slice(0, 10)}</td>
                          <td className="px-3 py-2">{r.suiteName}</td>
                          <td className="px-3 py-2 tabular-nums text-emerald-700 dark:text-emerald-400">{r.passCount}</td>
                          <td className="px-3 py-2 tabular-nums text-rose-700 dark:text-rose-400">{r.failCount}</td>
                          <td className="px-3 py-2 tabular-nums">{r.skipCount}</td>
                          <td className="px-3 py-2 tabular-nums">{r.omitCount}</td>
                          <td className="px-3 py-2 font-semibold tabular-nums">{r.passRatePct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'triage' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-7">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Failure Triage Board ({state.triageItems.length})
              </h2>
              {state.triageItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                  No failed tests in triage. Import the sample Inferno run to generate triage cards automatically.
                </div>
              ) : (
                state.triageItems.map((item) => (
                  <div
                    key={item.id}
                    className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-xs text-slate-500">{item.testId}</div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {item.title}
                        </div>
                        <div className="mt-1 text-xs text-rose-700 dark:text-rose-400">
                          {item.errorMessage}
                        </div>
                      </div>
                      <SemanticStatus tone={triageTone(item.status)} label={item.status} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Select
                        label="Probable Cause"
                        value={item.causeCategory}
                        onChange={(e) => {
                          conformanceService.updateTriageItem(activeTenant.id, item.id, {
                            causeCategory: e.target.value as TriageCauseCategory,
                          });
                          setTick((t) => t + 1);
                        }}
                        options={[
                          { value: 'data', label: 'data' },
                          { value: 'profile claim', label: 'profile claim' },
                          { value: 'CapabilityStatement', label: 'CapabilityStatement' },
                          { value: 'search parameter', label: 'search parameter' },
                          { value: 'auth', label: 'auth' },
                          { value: 'server config', label: 'server config' },
                        ]}
                      />
                      <Select
                        label="Status"
                        value={item.status}
                        onChange={(e) => {
                          conformanceService.updateTriageItem(activeTenant.id, item.id, {
                            status: e.target.value as TriageStatus,
                          });
                          setTick((t) => t + 1);
                        }}
                        options={[
                          { value: 'Open', label: 'Open' },
                          { value: 'Investigating', label: 'Investigating' },
                          { value: 'Resolved', label: 'Resolved' },
                          { value: 'Waived', label: 'Waived' },
                        ]}
                      />
                      <Input
                        label="Owner"
                        value={item.owner}
                        onChange={(e) => {
                          conformanceService.updateTriageItem(activeTenant.id, item.id, {
                            owner: e.target.value,
                          });
                          setTick((t) => t + 1);
                        }}
                      />
                    </div>
                    <Input
                      label="Remediation Notes"
                      value={item.notes}
                      onChange={(e) => {
                        conformanceService.updateTriageItem(activeTenant.id, item.id, {
                          notes: e.target.value,
                        });
                        setTick((t) => t + 1);
                      }}
                      placeholder="Record PR / config fix details..."
                    />
                  </div>
                ))
              )}
            </div>

            <div className="space-y-3 lg:col-span-5">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Catalogue of Common Conformance Fixes
              </h2>
              {COMMON_CONFORMANCE_FIXES.map((fix) => (
                <div
                  key={fix.id}
                  className="rounded-lg border border-slate-200 bg-white p-3.5 text-xs dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="font-semibold text-blue-700 dark:text-blue-400">
                    Cause: {fix.causeCategory}
                  </div>
                  <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                    {fix.symptom}
                  </div>
                  <div className="mt-1 text-slate-600 dark:text-slate-300">
                    <strong>Fix:</strong> {fix.fixSteps}
                  </div>
                  <div className="mt-0.5 text-slate-500">
                    <strong>Verify:</strong> {fix.verification}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'report' && (
          <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Printable Conformance Summary Report
              </h2>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(reportMarkdown);
                    showToast('Copied Markdown report to clipboard.', 'success');
                  }}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy Markdown
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const blob = new Blob([reportMarkdown], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `conformance-report-${activeTenant.code}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Download .md
                </Button>
                <Button size="sm" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                  Print
                </Button>
              </div>
            </div>
            <pre className="whitespace-pre-wrap rounded bg-slate-50 p-4 font-mono text-xs text-slate-800 dark:bg-slate-950 dark:text-slate-200">
              {reportMarkdown}
            </pre>
          </div>
        )}
      </div>
    </Guard>
  );
}
