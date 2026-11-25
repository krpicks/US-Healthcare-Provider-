import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  History,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Drawer,
  Input,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  TextArea,
  useToast,
} from '../../components';
import { Guard } from '../../app/Guard';
import { useAuth, usePermission } from '../../app/AuthContext';
import {
  fhirRequestLog,
  getFhirClient,
  type FhirPagedResult,
  type FhirRequestLogEntry,
  type FhirSearchParams,
} from '../../fhir';
import { auditService } from '../../services';
import { useTenantContext } from '../../tenancy';
import {
  ALL_FHIR_RESOURCE_TYPES,
  type FhirBundle,
  type FhirOperationOutcome,
  type FhirResource,
  type FhirResourceType,
} from '../../types';

interface ParamRow {
  id: string;
  key: string;
  value: string;
}

const SAMPLE_TX_BUNDLE = JSON.stringify(
  {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      {
        fullUrl: 'urn:uuid:tx-pat-demo',
        resource: {
          resourceType: 'Patient',
          active: true,
          name: [{ family: 'TransactionDemo', given: ['Sam'] }],
          gender: 'other',
          birthDate: '1992-05-05',
        },
        request: { method: 'POST', url: 'Patient' },
      },
      {
        fullUrl: 'urn:uuid:tx-obs-demo',
        resource: {
          resourceType: 'Observation',
          status: 'final',
          code: {
            coding: [
              { system: 'http://loinc.org', code: '8480-6', display: 'Systolic BP' },
            ],
          },
          subject: { reference: 'urn:uuid:tx-pat-demo' },
          valueQuantity: { value: 118, unit: 'mmHg' },
        },
        request: { method: 'POST', url: 'Observation' },
      },
    ],
  },
  null,
  2,
);

export function FhirExplorerPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user } = useAuth();
  const { notify } = useToast();
  const canEdit = usePermission('m2-fhir', 'edit');

  const [activeTab, setActiveTab] = useState('search');
  const [resourceType, setResourceType] =
    useState<FhirResourceType>('Practitioner');
  const [paramRows, setParamRows] = useState<ParamRow[]>([
    { id: 'p-1', key: '_count', value: '10' },
  ]);
  const [searchResult, setSearchResult] =
    useState<FhirPagedResult<FhirResource> | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // JSON Editor + $validate
  const [editorJson, setEditorJson] = useState(
    JSON.stringify(
      {
        resourceType: 'Patient',
        active: true,
        name: [{ use: 'official', given: ['Alex'], family: 'Sample' }],
        gender: 'female',
        birthDate: '1990-01-15',
      },
      null,
      2,
    ),
  );
  const [validationOutcome, setValidationOutcome] =
    useState<FhirOperationOutcome | null>(null);

  // History Drawer
  const [historyDrawerTitle, setHistoryDrawerTitle] = useState('');
  const [historyBundle, setHistoryBundle] = useState<FhirBundle | null>(null);

  // Transaction Runner
  const [txJson, setTxJson] = useState(SAMPLE_TX_BUNDLE);
  const [txResponse, setTxResponse] = useState<string | null>(null);

  // Request Log
  const [requestLogs, setRequestLogs] = useState<FhirRequestLogEntry[]>(() =>
    fhirRequestLog.getEntries(activeTenant.id),
  );

  useEffect(() => {
    setRequestLogs(fhirRequestLog.getEntries(activeTenant.id));
    return fhirRequestLog.subscribe(() => {
      setRequestLogs(fhirRequestLog.getEntries(activeTenant.id));
    });
  }, [activeTenant.id]);

  const executeSearch = useCallback(async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const client = getFhirClient();
      const params: FhirSearchParams = {};
      for (const row of paramRows) {
        const k = row.key.trim();
        const v = row.value.trim();
        if (!k || !v) continue;
        if (k in params) {
          const prev = params[k];
          params[k] = Array.isArray(prev) ? [...prev, v] : [String(prev), v];
        } else {
          params[k] = v;
        }
      }
      const res = await client.search(fhirContext, resourceType, params);
      setSearchResult(res);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }, [fhirContext, resourceType, paramRows]);

  useEffect(() => {
    void executeSearch();
  }, [executeSearch]);

  const handleValidateEditor = async (): Promise<boolean> => {
    try {
      const parsed = JSON.parse(editorJson) as FhirResource;
      const client = getFhirClient();
      const outcome = await client.operation<FhirOperationOutcome>(
        fhirContext,
        '$validate',
        { resourceType: parsed.resourceType, resource: parsed },
      );
      setValidationOutcome(outcome);
      const hasErr = outcome.issue.some(
        (i) => i.severity === 'error' || i.severity === 'fatal',
      );
      notify({
        title: hasErr ? 'FHIR $validate found issues' : 'FHIR $validate passed',
        variant: hasErr ? 'error' : 'success',
      });
      return !hasErr;
    } catch (err) {
      notify({
        title: 'Invalid JSON',
        description: err instanceof Error ? err.message : 'Unable to parse JSON.',
        variant: 'error',
      });
      return false;
    }
  };

  const handleSaveEditor = async () => {
    const valid = await handleValidateEditor();
    if (!valid) return;
    try {
      const parsed = JSON.parse(editorJson) as FhirResource;
      const client = getFhirClient();
      const saved = parsed.id
        ? await client.update(fhirContext, parsed)
        : await client.create(fhirContext, parsed);
      setEditorJson(JSON.stringify(saved, null, 2));
      await auditService.record({
        ctx: fhirContext,
        actorName: user.name,
        actorRole: user.role,
        action: parsed.id ? 'update' : 'create',
        resourceType: saved.resourceType,
        resourceId: saved.id,
        outcomeDesc: `Saved ${saved.resourceType}/${saved.id} via FHIR Explorer`,
      });
      notify({
        title: `Saved ${saved.resourceType}/${saved.id} (v${saved.meta?.versionId ?? '1'})`,
        variant: 'success',
      });
      void executeSearch();
    } catch (err) {
      notify({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Error saving resource',
        variant: 'error',
      });
    }
  };

  const handleInspectHistory = async (res: FhirResource) => {
    if (!res.id) return;
    const client = getFhirClient();
    const hist = await client.history(fhirContext, res.resourceType, res.id);
    setHistoryDrawerTitle(`${res.resourceType}/${res.id} Version History`);
    setHistoryBundle(hist);
  };

  const handleRunTransaction = async () => {
    try {
      const parsed = JSON.parse(txJson) as FhirBundle;
      const client = getFhirClient();
      const resp = await client.transaction(fhirContext, parsed);
      setTxResponse(JSON.stringify(resp, null, 2));
      await auditService.record({
        ctx: fhirContext,
        actorName: user.name,
        actorRole: user.role,
        action: 'create',
        resourceType: 'Bundle',
        outcomeDesc: `Executed FHIR transaction bundle (${resp.entry?.length ?? 0} entries)`,
      });
      notify({
        title: 'Transaction Bundle committed',
        description: `${resp.entry?.length ?? 0} entries processed with urn:uuid resolution.`,
        variant: 'success',
      });
    } catch (err) {
      notify({
        title: 'Transaction failed',
        description: err instanceof Error ? err.message : 'Invalid bundle',
        variant: 'error',
      });
    }
  };

  return (
    <Guard
      moduleId="m2-fhir"
      action="view"
      moduleName="FHIR Explorer (M2)"
      showForbiddenPage
    >
      <div className="space-y-6">
        <PageHeader
          kicker={`M2 · Mode: ${getFhirClient().mode.toUpperCase()} · Tenant: ${activeTenant.code}`}
          title="FHIR R4 Explorer & Request Console"
          description="Query tenant-scoped FHIR R4 resources with parameter rows and paging, validate and save JSON payloads with $validate, inspect version history, execute transaction bundles, and monitor request logs."
        />

        <Tabs
          activeTab={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: 'search', label: 'Search & Browse' },
            { id: 'editor', label: 'JSON Editor & $validate' },
            { id: 'transaction', label: 'Transaction Bundle' },
            { id: 'logs', label: 'Request Log', count: requestLogs.length },
          ]}
        />

        {activeTab === 'search' && (
          <div className="space-y-5">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-64">
                  <Select
                    label="Resource Type"
                    value={resourceType}
                    options={ALL_FHIR_RESOURCE_TYPES.map((t) => ({
                      value: t,
                      label: t,
                    }))}
                    onChange={(e) =>
                      setResourceType(e.target.value as FhirResourceType)
                    }
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    setParamRows((rows) => [
                      ...rows,
                      { id: `p-${Date.now()}`, key: '', value: '' },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add parameter</span>
                </Button>
                <Button
                  variant="primary"
                  disabled={searching}
                  onClick={() => void executeSearch()}
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  <span>{searching ? 'Searching...' : 'Run Search'}</span>
                </Button>
              </div>

              <div className="space-y-2">
                {paramRows.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center gap-2">
                    <input
                      aria-label="Search parameter name"
                      placeholder="Param (e.g. name, identifier, _sort, _include)"
                      value={row.key}
                      onChange={(e) =>
                        setParamRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id ? { ...r, key: e.target.value } : r,
                          ),
                        )
                      }
                      className="h-9 w-56 rounded-md border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                    <input
                      aria-label="Search parameter value"
                      placeholder="Value (e.g. ge2026-01-01, system|code)"
                      value={row.value}
                      onChange={(e) =>
                        setParamRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id ? { ...r, value: e.target.value } : r,
                          ),
                        )
                      }
                      className="h-9 flex-1 min-w-48 rounded-md border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                    <button
                      type="button"
                      aria-label="Remove search parameter"
                      onClick={() =>
                        setParamRows((prev) => prev.filter((r) => r.id !== row.id))
                      }
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {searchError && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {searchError}
              </div>
            )}

            {searchResult && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-mono tabular-nums">
                    Total matches: {searchResult.total} · Entries returned:{' '}
                    {searchResult.bundle.entry?.length ?? 0}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={viewMode === 'table' ? 'primary' : 'secondary'}
                      onClick={() => setViewMode('table')}
                    >
                      Table
                    </Button>
                    <Button
                      size="sm"
                      variant={viewMode === 'json' ? 'primary' : 'secondary'}
                      onClick={() => setViewMode('json')}
                    >
                      Raw JSON
                    </Button>
                    {searchResult.hasNext && searchResult.nextPage && (
                      <Button
                        size="sm"
                        onClick={async () => {
                          const next = await searchResult.nextPage!();
                          setSearchResult(next);
                        }}
                      >
                        Next Page
                      </Button>
                    )}
                  </div>
                </div>

                {viewMode === 'table' ? (
                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                            <th className="px-4 py-2.5">Resource</th>
                            <th className="px-4 py-2.5">Version</th>
                            <th className="px-4 py-2.5">Last Updated</th>
                            <th className="px-4 py-2.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {(searchResult.bundle.entry ?? []).map((entry, idx) => {
                            const res = entry.resource;
                            if (!res) return null;
                            return (
                              <tr key={`${res.resourceType}-${res.id}-${idx}`}>
                                <td className="px-4 py-2.5 font-mono text-slate-900 dark:text-slate-100">
                                  {res.resourceType}/{res.id}
                                  {entry.search?.mode === 'include' && (
                                    <span className="ml-2 text-slate-400">(included)</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                                  v{res.meta?.versionId ?? '1'}
                                </td>
                                <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                                  {res.meta?.lastUpdated?.slice(0, 19).replace('T', ' ') ?? '—'}
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  <div className="inline-flex items-center gap-2">
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        setEditorJson(JSON.stringify(res, null, 2));
                                        setValidationOutcome(null);
                                        setActiveTab('editor');
                                      }}
                                    >
                                      Edit JSON
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => void handleInspectHistory(res)}
                                    >
                                      <History className="h-3.5 w-3.5" aria-hidden="true" />
                                      <span>History</span>
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <pre className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 font-mono text-xs text-slate-100 dark:border-slate-800">
                    {JSON.stringify(searchResult.bundle, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'editor' && (
          <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <TextArea
              label="FHIR R4 Resource JSON"
              rows={16}
              value={editorJson}
              onChange={(e) => setEditorJson(e.target.value)}
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void handleValidateEditor()}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>Run $validate</span>
              </Button>
              {canEdit && (
                <Button variant="primary" onClick={() => void handleSaveEditor()}>
                  Validate & Save Resource
                </Button>
              )}
            </div>
            {validationOutcome && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-950">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  OperationOutcome ({validationOutcome.issue.length} issue(s))
                </p>
                <ul className="mt-2 space-y-1.5">
                  {validationOutcome.issue.map((iss, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <SemanticStatus
                        label={iss.severity}
                        tone={
                          iss.severity === 'error' || iss.severity === 'fatal'
                            ? 'danger'
                            : iss.severity === 'warning'
                              ? 'warning'
                              : 'success'
                        }
                      />
                      <span className="text-slate-700 dark:text-slate-300">
                        {iss.diagnostics}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeTab === 'transaction' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <TextArea
                label="Transaction Bundle JSON (supports urn:uuid reference resolution)"
                rows={18}
                value={txJson}
                onChange={(e) => setTxJson(e.target.value)}
                className="font-mono text-xs"
              />
              {canEdit && (
                <Button variant="primary" onClick={() => void handleRunTransaction()}>
                  <Play className="h-4 w-4" aria-hidden="true" />
                  <span>Execute Transaction</span>
                </Button>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Transaction Response
              </h2>
              <pre className="mt-2 max-h-[28rem] overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-100">
                {txResponse ?? '// Run a transaction bundle to inspect resolved fullUrls and responses.'}
              </pre>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span>
                Showing last {requestLogs.length} FHIR requests for {activeTenant.code} (payload bodies excluded by default).
              </span>
              <Button
                size="sm"
                onClick={() => fhirRequestLog.clear(activeTenant.id)}
              >
                Clear log
              </Button>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                      <th className="px-4 py-2.5">Time</th>
                      <th className="px-4 py-2.5">Method</th>
                      <th className="px-4 py-2.5">URL</th>
                      <th className="px-4 py-2.5 text-right">Status</th>
                      <th className="px-4 py-2.5 text-right">Duration</th>
                      <th className="px-4 py-2.5">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {requestLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="px-4 py-2 font-mono tabular-nums text-slate-500">
                          {log.timestamp.slice(11, 19)}
                        </td>
                        <td className="px-4 py-2 font-mono font-semibold">
                          {log.method}
                        </td>
                        <td className="max-w-md truncate px-4 py-2 font-mono text-slate-800 dark:text-slate-200">
                          {log.url}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          <SemanticStatus
                            label={String(log.status)}
                            tone={log.status >= 200 && log.status < 300 ? 'success' : 'danger'}
                          />
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {log.durationMs}ms
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                          {log.outcomeSummary ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <Drawer
          open={Boolean(historyBundle)}
          title={historyDrawerTitle}
          subtitle={historyBundle ? `${historyBundle.total ?? 0} version(s)` : undefined}
          onClose={() => setHistoryBundle(null)}
        >
          {historyBundle && (
            <div className="space-y-4">
              {(historyBundle.entry ?? []).map((entry, idx) => (
                <div
                  key={idx}
                  className="rounded-md border border-slate-200 p-3 dark:border-slate-800"
                >
                  <p className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Version {entry.resource?.meta?.versionId ?? '?'} ·{' '}
                    {entry.resource?.meta?.lastUpdated?.slice(0, 19).replace('T', ' ')}
                  </p>
                  <pre className="mt-2 max-h-60 overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-100">
                    {JSON.stringify(entry.resource, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </Drawer>
      </div>
    </Guard>
  );
}
