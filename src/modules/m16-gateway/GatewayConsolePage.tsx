import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
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
  type SemanticTone,
} from '../../components';
import { useTenantContext } from '../../tenancy';
import {
  FIELD_MAPPINGS,
  GATEWAY_ENDPOINTS,
  RESILIENCE_POLICIES,
  gatewayService,
  type FailureSimulationMode,
  type ServiceHealthStatus,
} from './gatewayService';

function healthTone(status: ServiceHealthStatus): SemanticTone {
  if (status === 'Up') return 'success';
  if (status === 'Degraded') return 'warning';
  return 'danger';
}

export function GatewayConsolePage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'tryit' | 'health' | 'auth' | 'mappings' | 'contracts'>('tryit');
  const [selectedEndpointId, setSelectedEndpointId] = useState(GATEWAY_ENDPOINTS[0].id);
  const [pathParamVal, setPathParamVal] = useState('oig-leie');
  const [bodyJson, setBodyJson] = useState('{}');
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Auth simulator inputs (in-memory only)
  const [clientId, setClientId] = useState('providerlink-gateway-client');
  const [clientSecret, setClientSecret] = useState('');
  const [scope, setScope] = useState('system/Practitioner.write system/Patient.read');

  const state = gatewayService.getState(activeTenant.id);
  const activeSpec =
    GATEWAY_ENDPOINTS.find((e) => e.id === selectedEndpointId) ?? GATEWAY_ENDPOINTS[0];

  useEffect(() => {
    setPathParamVal(
      activeSpec.samplePathParams ? Object.values(activeSpec.samplePathParams)[0] ?? '' : '',
    );
    setBodyJson(
      activeSpec.sampleBody ? JSON.stringify(activeSpec.sampleBody, null, 2) : '{}',
    );
  }, [activeSpec]);

  // 30-second health polling
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      await gatewayService.pollServiceHealth(fhirContext);
      if (mounted) setTick((t) => t + 1);
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 30_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [fhirContext]);

  // 1-second auth countdown ticker
  useEffect(() => {
    if (!state.authSession) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.authSession]);

  const handleTryIt = async () => {
    let parsedBody: Record<string, unknown> | undefined;
    if (activeSpec.method !== 'GET') {
      try {
        parsedBody = JSON.parse(bodyJson || '{}') as Record<string, unknown>;
      } catch {
        showToast('Request body must be valid JSON.', 'error');
        return;
      }
    }
    const pathParamKey = activeSpec.samplePathParams
      ? Object.keys(activeSpec.samplePathParams)[0]
      : undefined;
    const resp = await gatewayService.invokeEndpoint(activeTenant.id, activeSpec.id, {
      pathParams: pathParamKey ? { [pathParamKey]: pathParamVal } : undefined,
      body: parsedBody,
    });
    setTick((t) => t + 1);
    showToast(
      `${resp.method} ${activeSpec.path} → HTTP ${resp.status} (${resp.latencyMs}ms, attempts: ${resp.attempts})`,
      resp.status >= 400 ? 'error' : 'success',
    );
  };

  const handleIssueToken = () => {
    try {
      gatewayService.simulateClientCredentialsAuth(activeTenant.id, {
        clientId,
        clientSecret,
        scope,
        ttlSeconds: 300,
      });
      setClientSecret('');
      setNowMs(Date.now());
      setTick((t) => t + 1);
      showToast('Simulated Bearer token issued (secret kept in memory only).', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to simulate token.', 'error');
    }
  };

  const handleRunContracts = async () => {
    const results = await gatewayService.runContractTests(activeTenant.id);
    setTick((t) => t + 1);
    const passed = results.filter((r) => r.passed).length;
    showToast(
      `Contract test suite: ${passed}/${results.length} endpoints passed.`,
      passed === results.length ? 'success' : 'warning',
    );
  };

  const remainingSec = state.authSession
    ? Math.max(0, Math.ceil((state.authSession.expiresAt - nowMs) / 1000))
    : 0;

  return (
    <Guard moduleId="m16-gateway" action="view">
      <div className="space-y-6" data-tick={tick}>
        <PageHeader
          kicker="M16 · Integration Gateway (.NET)"
          title="Integration Gateway Console (.NET)"
          description="Try-It console for /api/v1 & RFC 7807 gateway endpoints, 30-second live health polling (Gateway, FHIR, eCRNow), in-memory client-credentials simulator, field mappings, Polly resilience failure simulator, and contract test runner."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={async () => {
                  await gatewayService.pollServiceHealth(fhirContext);
                  setTick((t) => t + 1);
                  showToast('Health poll completed.', 'info');
                }}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Poll Health Now
              </Button>
              <Button onClick={() => void handleRunContracts()}>
                <Play className="h-4 w-4" aria-hidden="true" />
                Run Contract Tests
              </Button>
            </div>
          }
        />

        {/* Gateway Mode & Resilience Control Bar */}
        <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-3">
          <Select
            label="Gateway Execution Mode"
            value={state.liveMode ? 'live' : 'mock'}
            onChange={(e) => {
              gatewayService.setLiveMode(activeTenant.id, e.target.value === 'live');
              setTick((t) => t + 1);
            }}
            options={[
              { value: 'mock', label: 'Mock Gateway Responses (Default)' },
              { value: 'live', label: 'Live .NET Gateway HTTP (localhost:5000)' },
            ]}
          />
          <Select
            label="Resilience Failure Simulator"
            value={state.failureSimulation}
            onChange={(e) => {
              gatewayService.setFailureSimulation(
                activeTenant.id,
                e.target.value as FailureSimulationMode,
              );
              setTick((t) => t + 1);
            }}
            options={[
              { value: 'None', label: 'None (Healthy)' },
              { value: 'Transient503', label: 'Transient 503 (Retry recovers on attempt 2)' },
              { value: 'Timeout504', label: 'Timeout 504 (Exhausts 3 retries)' },
              { value: 'SustainedOutage', label: 'Sustained Outage (Opens Circuit Breaker after 3)' },
            ]}
          />
          <div className="flex items-end justify-between rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
            <div>
              <div className="text-xs text-slate-500">Circuit Breaker State</div>
              <div className="mt-0.5">
                <SemanticStatus
                  tone={state.circuitState === 'Closed' ? 'success' : 'danger'}
                  label={`${state.circuitState} (${state.consecutiveFailures}/3 fails)`}
                />
              </div>
            </div>
            {state.circuitState !== 'Closed' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  gatewayService.resetCircuitBreaker(activeTenant.id);
                  setTick((t) => t + 1);
                }}
              >
                Reset
              </Button>
            )}
          </div>
        </div>

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'tryit', label: `Try-It Endpoints (${GATEWAY_ENDPOINTS.length})` },
            { id: 'health', label: 'Health Dashboard (30s Poll)' },
            { id: 'auth', label: 'Client-Credentials Auth' },
            { id: 'mappings', label: 'Mappings & Resilience' },
            { id: 'contracts', label: `Contract Tests (${state.contractResults.length})` },
          ]}
        />

        {tab === 'tryit' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-2 lg:col-span-5">
              {GATEWAY_ENDPOINTS.map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => setSelectedEndpointId(ep.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    activeSpec.id === ep.id
                      ? 'border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/30'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white dark:bg-slate-700">
                      {ep.method}
                    </span>
                    <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {ep.path}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{ep.summary}</p>
                </button>
              ))}
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-7">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                <div>
                  <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {activeSpec.method} {activeSpec.path}
                  </span>
                  <div className="text-xs text-slate-500">{activeSpec.summary}</div>
                </div>
                <Button onClick={() => void handleTryIt()}>
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Send Request
                </Button>
              </div>

              {activeSpec.samplePathParams && (
                <Input
                  label={`Path Parameter (${Object.keys(activeSpec.samplePathParams)[0]})`}
                  value={pathParamVal}
                  onChange={(e) => setPathParamVal(e.target.value)}
                />
              )}

              {activeSpec.method !== 'GET' && (
                <TextArea
                  label="JSON Request Body"
                  rows={5}
                  value={bodyJson}
                  onChange={(e) => setBodyJson(e.target.value)}
                />
              )}

              {state.lastResponse && (
                <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <SemanticStatus
                        tone={state.lastResponse.status < 400 ? 'success' : 'danger'}
                        label={`HTTP ${state.lastResponse.status}`}
                      />
                      <span className="font-mono text-slate-500">
                        {state.lastResponse.latencyMs}ms · Attempts: {state.lastResponse.attempts} ·{' '}
                        {state.lastResponse.modeUsed}
                      </span>
                    </div>
                    <span className="font-mono text-slate-500">
                      X-Correlation-Id: {state.lastResponse.correlationId}
                    </span>
                  </div>
                  <pre className="max-h-72 overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-100">
                    {JSON.stringify(state.lastResponse.body, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'health' && (
          <div className="grid gap-4 md:grid-cols-3">
            {state.health.map((item) => (
              <div
                key={item.serviceId}
                className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-blue-600" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {item.serviceName}
                    </h2>
                  </div>
                  <SemanticStatus tone={healthTone(item.status)} label={item.status} />
                </div>
                <div className="mt-2 truncate font-mono text-xs text-slate-500">{item.url}</div>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{item.reason}</p>
                <div className="mt-3 flex justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500 dark:border-slate-800">
                  <span>Latency: {item.latencyMs}ms</span>
                  <span>Checked {item.checkedAt.slice(11, 19)} UTC</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'auth' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  <strong>Security Notice:</strong> Real OAuth2 client secrets belong strictly in the backend .NET Integration Gateway / Key Vault and must never be shipped in browser bundles or persisted to localStorage. This simulator stores your test secret in session memory only.
                </span>
              </div>

              <Input label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
              <Input
                label="In-Memory Client Secret (never saved to localStorage)"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Enter synthetic test secret"
              />
              <Input label="Requested SMART / Gateway Scopes" value={scope} onChange={(e) => setScope(e.target.value)} />
              <div className="flex gap-2">
                <Button onClick={handleIssueToken}>
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  Simulate Token Exchange
                </Button>
                {state.authSession && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      gatewayService.clearAuthSession(activeTenant.id);
                      setTick((t) => t + 1);
                    }}
                  >
                    Revoke Session Token
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Active Simulated Bearer Session
              </h2>
              {state.authSession ? (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Client ID</span>
                    <span className="font-mono font-semibold">{state.authSession.clientId}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Scopes</span>
                    <span className="font-mono">{state.authSession.scope}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Expiry Countdown</span>
                    <SemanticStatus
                      tone={remainingSec > 60 ? 'success' : remainingSec > 0 ? 'warning' : 'danger'}
                      label={remainingSec > 0 ? `${remainingSec}s remaining` : 'Expired'}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-slate-500">Simulated JWT (Preview)</div>
                    <div className="break-all rounded bg-slate-950 p-2.5 font-mono text-[11px] text-slate-200">
                      {state.authSession.accessToken}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  No active simulated token. Enter any synthetic secret and click &quot;Simulate Token Exchange&quot;.
                </p>
              )}
            </div>
          </div>
        )}

        {tab === 'mappings' && (
          <div className="space-y-6">
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                  <tr>
                    <th className="px-4 py-3">Pipeline</th>
                    <th className="px-4 py-3">Source Field</th>
                    <th className="px-4 py-3">Target FHIR Element</th>
                    <th className="px-4 py-3">Transformation &amp; Validation Rule</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {FIELD_MAPPINGS.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                        <div>{m.pipeline}</div>
                        <div className="text-xs font-normal text-slate-500">{m.sourceSystem}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{m.sourceField}</td>
                      <td className="px-4 py-3 font-mono text-xs text-blue-700 dark:text-blue-400">
                        {m.fhirTarget}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div>{m.transformation}</div>
                        <div className="mt-0.5 text-slate-500">Rule: {m.validationRule}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {RESILIENCE_POLICIES.map((pol) => (
                <div
                  key={pol.policy}
                  className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
                    {pol.policy}
                  </div>
                  <div className="mt-2 font-mono text-xs text-blue-700 dark:text-blue-400">
                    {pol.configuration}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">
                    {pol.appliesTo}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'contracts' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Verifies HTTP status code, <span className="font-mono">X-Correlation-Id</span>, and required JSON contract keys across all /api/v1 endpoints.
              </p>
              <Button onClick={() => void handleRunContracts()}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Run Contract Suite
              </Button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                  <tr>
                    <th className="px-4 py-3">Endpoint</th>
                    <th className="px-4 py-3">Expected / Actual</th>
                    <th className="px-4 py-3">JSON Shape</th>
                    <th className="px-4 py-3">Latency</th>
                    <th className="px-4 py-3">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {state.contractResults.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">
                        Click &quot;Run Contract Suite&quot; to verify endpoint statuses and JSON schemas.
                      </td>
                    </tr>
                  ) : (
                    state.contractResults.map((r) => (
                      <tr key={r.endpointId}>
                        <td className="px-4 py-3 font-mono text-xs">
                          {r.method} {r.path}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {r.expectedStatus} / {r.actualStatus}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {r.missingKeys.length === 0
                            ? 'All required keys present'
                            : `Missing: ${r.missingKeys.join(', ')}`}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{r.latencyMs}ms</td>
                        <td className="px-4 py-3">
                          <SemanticStatus
                            tone={r.passed ? 'success' : 'danger'}
                            label={r.passed ? 'PASS' : 'FAIL'}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Guard>
  );
}
