import { useState } from 'react';
import {
  BookOpen,
  Download,
  FileWarning,
  Plus,
  Search,
  Stethoscope,
  Wrench,
} from 'lucide-react';
import { Guard } from '../../app';
import {
  Button,
  Input,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  TextArea,
  useToast,
} from '../../components';
import { useTenantContext } from '../../tenancy';
import {
  SAMPLE_OPERATION_OUTCOME,
  diagnosticsService,
  type ConnectivityDiagnosis,
  type ExplainedOutcomeIssue,
} from './diagnosticsService';

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DiagnosticsPage() {
  const { activeTenant } = useTenantContext();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'wizard' | 'kb' | 'outcome' | 'bundle' | 'log'>('wizard');
  const [tick, setTick] = useState(0);

  // Connectivity wizard inputs
  const [httpStatus, setHttpStatus] = useState('0');
  const [errMsg, setErrMsg] = useState('TypeError: Failed to fetch (CORS preflight blocked)');
  const [bodySnippet, setBodySnippet] = useState('');
  const [diagnosis, setDiagnosis] = useState<ConnectivityDiagnosis | null>(() =>
    diagnosticsService.classifyConnectivityFailure({
      httpStatus: 0,
      errorMessage: 'TypeError: Failed to fetch (CORS preflight blocked)',
    }),
  );

  // KB Search
  const [kbQuery, setKbQuery] = useState('');

  // OperationOutcome explainer
  const [outcomeJson, setOutcomeJson] = useState(SAMPLE_OPERATION_OUTCOME);
  const [explained, setExplained] = useState<ExplainedOutcomeIssue[]>(() =>
    diagnosticsService.explainOperationOutcome(SAMPLE_OPERATION_OUTCOME),
  );

  // Troubleshooting log form
  const [logSymptom, setLogSymptom] = useState('');
  const [logAction, setLogAction] = useState('');
  const [logOutcome, setLogOutcome] = useState<'Resolved' | 'Open' | 'Escalated'>('Resolved');

  const kbMatches = diagnosticsService.searchKnowledgeBase(kbQuery);
  const logEntries = diagnosticsService.getTroubleshootingLog(activeTenant.id);
  const supportBundle = diagnosticsService.buildMaskedSupportBundle(activeTenant.id);

  const handleClassify = () => {
    const res = diagnosticsService.classifyConnectivityFailure({
      httpStatus: Number(httpStatus) || 0,
      errorMessage: errMsg,
      responseBodySnippet: bodySnippet,
    });
    setDiagnosis(res);
    showToast(`Classified failure: ${res.classification}`, 'info');
  };

  const handleExplainOutcome = () => {
    try {
      const items = diagnosticsService.explainOperationOutcome(outcomeJson);
      setExplained(items);
      showToast(`Explained ${items.length} OperationOutcome issue(s).`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to parse OperationOutcome.', 'error');
    }
  };

  const handleAddLog = () => {
    try {
      diagnosticsService.addTroubleshootingLogEntry(activeTenant.id, {
        symptom: logSymptom,
        actionTaken: logAction,
        outcome: logOutcome,
      });
      setLogSymptom('');
      setLogAction('');
      setTick((t) => t + 1);
      showToast('Added entry to troubleshooting log.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Invalid log entry.', 'error');
    }
  };

  return (
    <Guard moduleId="m20-diagnostics" action="view">
      <div className="space-y-6" data-tick={tick}>
        <PageHeader
          kicker="M20 · Diagnostics & Troubleshooting"
          title="Interoperability Diagnostics & Troubleshooting"
          description="8-category connectivity failure classifier, searchable 10-article FHIR/eCRNow/Gateway knowledge base, OperationOutcome explainer, secret-masked support bundle export, and Markdown troubleshooting log."
        />

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'wizard', label: 'Connectivity Wizard' },
            { id: 'kb', label: `Knowledge Base (${kbMatches.length})` },
            { id: 'outcome', label: 'OperationOutcome Explainer' },
            { id: 'bundle', label: 'Masked Support Bundle' },
            { id: 'log', label: `Troubleshooting Log (${logEntries.length})` },
          ]}
        />

        {tab === 'wizard' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <Stethoscope className="h-4 w-4" aria-hidden="true" />
                Failure Classifier Inputs
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="HTTP Status Code (0 if network error)"
                  type="number"
                  value={httpStatus}
                  onChange={(e) => setHttpStatus(e.target.value)}
                />
                <Input
                  label="Response Body Snippet (Optional)"
                  value={bodySnippet}
                  onChange={(e) => setBodySnippet(e.target.value)}
                  placeholder="e.g., <html>Not Found</html>"
                />
              </div>
              <TextArea
                label="Error Message / Browser Console Text"
                rows={3}
                value={errMsg}
                onChange={(e) => setErrMsg(e.target.value)}
              />
              <Button onClick={handleClassify}>
                <Wrench className="h-4 w-4" aria-hidden="true" />
                Classify &amp; Diagnose
              </Button>
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Diagnostic Assessment
              </h2>
              {diagnosis && (
                <div className="space-y-3 text-xs">
                  <SemanticStatus tone="danger" label={diagnosis.classification} />
                  <div>
                    <strong className="text-slate-900 dark:text-slate-100">Probable Cause:</strong>{' '}
                    <span className="text-slate-600 dark:text-slate-300">{diagnosis.probableCause}</span>
                  </div>
                  <div>
                    <strong className="text-slate-900 dark:text-slate-100">Recommended Fix Steps:</strong>
                    <ol className="mt-1 list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                      {diagnosis.fixSteps.map((s, idx) => (
                        <li key={idx}>{s}</li>
                      ))}
                    </ol>
                  </div>
                  <div className="rounded bg-emerald-50 p-2.5 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                    <strong>Verification:</strong> {diagnosis.verification}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'kb' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <div className="flex-1">
                  <Input
                    label="Symptom Matcher / Search Knowledge Base"
                    value={kbQuery}
                    onChange={(e) => setKbQuery(e.target.value)}
                    placeholder="Paste error snippet: e.g., 8080 clash, urn:uuid, host.docker.internal, CORS, 422, meta.profile..."
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {kbMatches.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <BookOpen className="h-4 w-4 text-blue-600" aria-hidden="true" />
                    {entry.title}
                  </div>
                  <div className="mt-2 space-y-1.5 text-slate-600 dark:text-slate-300">
                    <div><strong>Symptom:</strong> {entry.symptom}</div>
                    <div><strong>Cause:</strong> {entry.cause}</div>
                    <div><strong>Fix:</strong> {entry.fix}</div>
                    <div className="text-emerald-700 dark:text-emerald-400">
                      <strong>Verification:</strong> {entry.verification}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'outcome' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <TextArea
                label="Paste FHIR OperationOutcome JSON"
                rows={12}
                value={outcomeJson}
                onChange={(e) => setOutcomeJson(e.target.value)}
              />
              <Button onClick={handleExplainOutcome}>
                <FileWarning className="h-4 w-4" aria-hidden="true" />
                Explain OperationOutcome
              </Button>
            </div>
            <div className="space-y-3 lg:col-span-6">
              {explained.map((iss, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {iss.expression} ({iss.code})
                    </span>
                    <SemanticStatus
                      tone={iss.severity === 'error' || iss.severity === 'fatal' ? 'danger' : 'warning'}
                      label={iss.severity.toUpperCase()}
                    />
                  </div>
                  <p className="mt-1.5 text-slate-600 dark:text-slate-300">{iss.diagnostics}</p>
                  <div className="mt-2 rounded bg-blue-50 p-2 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                    <strong>Plain-English Fix:</strong> {iss.plainEnglishFix}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'bundle' && (
          <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Secret-Masked Support Bundle
                </h2>
                <p className="text-xs text-slate-500">
                  All Bearer tokens, API secrets, passwords, and SSNs are automatically redacted prior to export.
                </p>
              </div>
              <Button
                onClick={() =>
                  downloadText(
                    `providerlink-support-bundle-${activeTenant.code}.json`,
                    JSON.stringify(supportBundle, null, 2),
                    'application/json',
                  )
                }
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download Support Bundle (.json)
              </Button>
            </div>
            <pre className="max-h-96 overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-100">
              {JSON.stringify(supportBundle, null, 2)}
            </pre>
          </div>
        )}

        {tab === 'log' && (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-4">
              <Input
                label="Observed Symptom"
                value={logSymptom}
                onChange={(e) => setLogSymptom(e.target.value)}
                placeholder="e.g., Gateway 503 during health poll"
              />
              <Input
                label="Action Taken"
                value={logAction}
                onChange={(e) => setLogAction(e.target.value)}
                placeholder="e.g., Reset circuit breaker and verified HAPI :8081"
              />
              <Select
                label="Outcome"
                value={logOutcome}
                onChange={(e) => setLogOutcome(e.target.value as typeof logOutcome)}
                options={[
                  { value: 'Resolved', label: 'Resolved' },
                  { value: 'Open', label: 'Open' },
                  { value: 'Escalated', label: 'Escalated' },
                ]}
              />
              <div className="flex items-end gap-2">
                <Button onClick={handleAddLog}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Entry
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    downloadText(
                      `troubleshooting-log-${activeTenant.code}.md`,
                      diagnosticsService.exportTroubleshootingLogMarkdown(activeTenant.id),
                      'text/markdown',
                    )
                  }
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  .md
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {logEntries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                  No troubleshooting log entries yet. Add an entry above to build an exportable Markdown runbook.
                </div>
              ) : (
                logEntries.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-start justify-between rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{e.symptom}</div>
                      <div className="mt-1 text-slate-600 dark:text-slate-300">{e.actionTaken}</div>
                      <div className="mt-1 font-mono text-[11px] text-slate-400">{e.timestamp}</div>
                    </div>
                    <SemanticStatus
                      tone={e.outcome === 'Resolved' ? 'success' : e.outcome === 'Open' ? 'warning' : 'danger'}
                      label={e.outcome}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </Guard>
  );
}
