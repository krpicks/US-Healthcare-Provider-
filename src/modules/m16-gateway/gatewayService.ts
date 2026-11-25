import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { settingsService } from '../../services/settingsService';
import { AppError } from '../../types';

export type GatewayHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface GatewayEndpointSpec {
  id: string;
  method: GatewayHttpMethod;
  path: string;
  summary: string;
  samplePathParams?: Record<string, string>;
  sampleBody?: Record<string, unknown>;
  expectedStatus: number;
  requiredResponseKeys: string[];
}

export interface GatewayTryItResponse {
  endpointId: string;
  method: GatewayHttpMethod;
  resolvedUrl: string;
  status: number;
  latencyMs: number;
  correlationId: string;
  modeUsed: 'Mock' | 'Live';
  attempts: number;
  circuitState: 'Closed' | 'Open' | 'Half-Open';
  body: Record<string, unknown>;
  isProblemDetails: boolean;
  timestamp: string;
}

export type ServiceHealthStatus = 'Up' | 'Degraded' | 'Down';

export interface ServiceHealthItem {
  serviceId: 'gateway' | 'fhir' | 'ecrnow';
  serviceName: string;
  url: string;
  status: ServiceHealthStatus;
  latencyMs: number;
  checkedAt: string;
  reason: string;
}

export interface ClientCredentialsSession {
  clientId: string;
  scope: string;
  accessToken: string;
  issuedAt: number;
  expiresAt: number;
}

export interface FieldMappingSpec {
  id: string;
  pipeline: string;
  sourceSystem: string;
  sourceField: string;
  fhirTarget: string;
  transformation: string;
  validationRule: string;
}

export type FailureSimulationMode =
  | 'None'
  | 'Transient503'
  | 'Timeout504'
  | 'SustainedOutage';

export interface ContractTestResult {
  endpointId: string;
  path: string;
  method: GatewayHttpMethod;
  expectedStatus: number;
  actualStatus: number;
  missingKeys: string[];
  hasCorrelationId: boolean;
  passed: boolean;
  latencyMs: number;
}

export interface GatewayTenantState {
  liveMode: boolean;
  failureSimulation: FailureSimulationMode;
  consecutiveFailures: number;
  circuitState: 'Closed' | 'Open' | 'Half-Open';
  health: ServiceHealthItem[];
  lastResponse?: GatewayTryItResponse;
  history: GatewayTryItResponse[];
  authSession?: ClientCredentialsSession;
  contractResults: ContractTestResult[];
}

export const GATEWAY_ENDPOINTS: GatewayEndpointSpec[] = [
  {
    id: 'ep-health',
    method: 'GET',
    path: '/health',
    summary: 'Liveness & downstream dependency readiness probe',
    expectedStatus: 200,
    requiredResponseKeys: ['status', 'version', 'dependencies'],
  },
  {
    id: 'ep-fhir-version',
    method: 'GET',
    path: '/api/v1/fhir-version',
    summary: 'Reads upstream HAPI FHIR CapabilityStatement fhirVersion',
    expectedStatus: 200,
    requiredResponseKeys: ['fhirVersion', 'serverName', 'status'],
  },
  {
    id: 'ep-tenants',
    method: 'POST',
    path: '/api/v1/tenants',
    summary: 'Provisions tenant partition and organization metadata',
    sampleBody: { tenantCode: 'state-medicaid-c', name: 'State Medicaid Agency C', partitionStrategy: 'path' },
    expectedStatus: 201,
    requiredResponseKeys: ['tenantId', 'tenantCode', 'status'],
  },
  {
    id: 'ep-providers-sync',
    method: 'POST',
    path: '/api/v1/providers/sync',
    summary: 'Synchronizes Practitioner + PractitionerRole transaction bundle to FHIR',
    sampleBody: { npi: '1234567893', fullName: 'Dr. Elena Vargas', status: 'Active' },
    expectedStatus: 200,
    requiredResponseKeys: ['synced', 'bundleId', 'resourceCount'],
  },
  {
    id: 'ep-validator',
    method: 'POST',
    path: '/api/v1/validators/{id}',
    summary: 'Executes external verification adapter (nppes, oig-leie, sam, license)',
    samplePathParams: { id: 'oig-leie' },
    sampleBody: { npi: '1234567893', fullName: 'Dr. Elena Vargas' },
    expectedStatus: 200,
    requiredResponseKeys: ['validatorId', 'outcome', 'checkedAt'],
  },
  {
    id: 'ep-ecr-trigger',
    method: 'GET',
    path: '/api/v1/patients/{id}/ecr-trigger',
    summary: 'Evaluates eCR trigger codes for a patient and returns eCRNow handoff status',
    samplePathParams: { id: 'pat-jane-doe-state-medicaid-a' },
    expectedStatus: 200,
    requiredResponseKeys: ['patientId', 'triggered', 'matchedCodes'],
  },
  {
    id: 'ep-mmis-loads',
    method: 'POST',
    path: '/api/v1/mmis/loads',
    summary: 'Transmits Medicaid provider load payload to downstream MMIS queue',
    sampleBody: { medicaidId: 'NY-MCD-100042', npi: '1234567893', action: 'InitialLoad' },
    expectedStatus: 202,
    requiredResponseKeys: ['ackId', 'status', 'queuedAt'],
  },
];

export const FIELD_MAPPINGS: FieldMappingSpec[] = [
  {
    id: 'map-1',
    pipeline: 'Provider Sync',
    sourceSystem: 'M5 Enrollment / MMIS Feed',
    sourceField: 'provider.npi',
    fhirTarget: 'Practitioner.identifier[system=us-npi].value',
    transformation: 'Strip non-digits; attach system http://hl7.org/fhir/sid/us-npi',
    validationRule: '10 digits + Luhn check with 80840 prefix',
  },
  {
    id: 'map-2',
    pipeline: 'Provider Sync',
    sourceSystem: 'M5 Enrollment / M3 Directory',
    sourceField: 'provider.taxonomyCode',
    fhirTarget: 'PractitionerRole.specialty.coding[nucc].code',
    transformation: 'Map to http://nucc.org/provider-taxonomy',
    validationRule: '10-character alphanumeric NUCC taxonomy code',
  },
  {
    id: 'map-3',
    pipeline: 'MMIS Load',
    sourceSystem: 'M10 MMIS Queue',
    sourceField: 'provider.medicaidId',
    fhirTarget: 'Practitioner.identifier[medicaid].value',
    transformation: 'Prefix tenant Medicaid ID format (e.g., NY-MCD-######)',
    validationRule: 'Unique per tenant; immutable once acknowledged',
  },
  {
    id: 'map-4',
    pipeline: 'eCR Trigger',
    sourceSystem: 'EHR Lab Interface',
    sourceField: 'lab.loincCode + lab.resultCode',
    fhirTarget: 'Observation.code.coding[loinc] + Observation.valueCodeableConcept',
    transformation: 'Match against RCTC value set; generate Composition eICR Bundle',
    validationRule: 'Status=final and positive/detected SNOMED qualifier',
  },
  {
    id: 'map-5',
    pipeline: 'Plan Directory',
    sourceSystem: 'M23 Plan & Network Catalog',
    sourceField: 'network.participation',
    fhirTarget: 'OrganizationAffiliation.network + InsurancePlan.network',
    transformation: 'Link active Organization/PractitionerRole to InsurancePlan',
    validationRule: 'Active enrollment status required before publishing',
  },
];

export const RESILIENCE_POLICIES = [
  {
    policy: 'Retry Policy (Polly)',
    configuration: '3 attempts · Exponential backoff (200ms, 400ms, 800ms) + jitter',
    appliesTo: 'HTTP 502/503/504, transient socket resets, idempotent GET/PUT & correlation-keyed POST',
  },
  {
    policy: 'Request Timeout',
    configuration: 'Per-attempt 5s timeout · Overall pipeline 15s timeout',
    appliesTo: 'Upstream HAPI FHIR, external exclusion registries, eCRNow adapter',
  },
  {
    policy: 'Circuit Breaker',
    configuration: 'Opens after 3 consecutive failures · 30s break duration · Half-Open single probe',
    appliesTo: 'Prevents cascading outages when downstream MMIS or FHIR server is down',
  },
];

const storeByTenant = new Map<string, GatewayTenantState>();
const CLIENT_SECRET_KEY = 'm16.gateway.clientSecret';
let gwSeq = 100;

function nextGwId(prefix: string): string {
  gwSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${gwSeq}`;
}

function getOrInitState(tenantId: string): GatewayTenantState {
  const existing = storeByTenant.get(tenantId);
  if (existing) return existing;

  const initial: GatewayTenantState = {
    liveMode: false,
    failureSimulation: 'None',
    consecutiveFailures: 0,
    circuitState: 'Closed',
    health: [],
    history: [],
    contractResults: [],
  };
  storeByTenant.set(tenantId, initial);
  return initial;
}

function resolvePath(spec: GatewayEndpointSpec, pathParams?: Record<string, string>): string {
  let path = spec.path;
  const merged = { ...(spec.samplePathParams ?? {}), ...(pathParams ?? {}) };
  Object.entries(merged).forEach(([k, v]) => {
    path = path.replace(`{${k}}`, encodeURIComponent(v));
  });
  return path;
}

function buildMockResponseBody(
  spec: GatewayEndpointSpec,
  pathParams?: Record<string, string>,
  requestBody?: Record<string, unknown>,
): Record<string, unknown> {
  const now = new Date().toISOString();
  switch (spec.id) {
    case 'ep-health':
      return {
        status: 'Healthy',
        version: '1.0.0-dotnet8',
        timestamp: now,
        dependencies: {
          hapiFhir: 'Up',
          ecrNow: 'Up',
          mmisQueue: 'Up',
        },
      };
    case 'ep-fhir-version':
      return {
        fhirVersion: '4.0.1',
        serverName: 'HAPI FHIR R4 (Gateway Proxied)',
        status: 'Connected',
      };
    case 'ep-tenants':
      return {
        tenantId: nextGwId('tenant'),
        tenantCode: String(requestBody?.tenantCode ?? 'state-medicaid-c'),
        status: 'Provisioned',
        createdAt: now,
      };
    case 'ep-providers-sync':
      return {
        synced: true,
        bundleId: nextGwId('bundle'),
        resourceCount: 3,
        npi: String(requestBody?.npi ?? '1234567893'),
      };
    case 'ep-validator':
      return {
        validatorId: pathParams?.id ?? spec.samplePathParams?.id ?? 'oig-leie',
        outcome: 'Pass',
        checkedAt: now,
        details: 'No adverse findings returned from gateway adapter.',
      };
    case 'ep-ecr-trigger':
      return {
        patientId: pathParams?.id ?? spec.samplePathParams?.id ?? 'pat-jane-doe-state-medicaid-a',
        triggered: true,
        matchedCodes: ['SNOMED:840539006', 'LOINC:94500-6'],
        checkedAt: now,
      };
    case 'ep-mmis-loads':
      return {
        ackId: `MMIS-${nextGwId('ack').toUpperCase()}`,
        status: 'Accepted',
        queuedAt: now,
      };
    default:
      return { ok: true, timestamp: now };
  }
}

export const gatewayService = {
  getState(tenantId: string): GatewayTenantState {
    return getOrInitState(tenantId);
  },

  resetForTests(): void {
    storeByTenant.clear();
    settingsService.setSessionSecret(CLIENT_SECRET_KEY, '');
  },

  setLiveMode(tenantId: string, liveMode: boolean): void {
    getOrInitState(tenantId).liveMode = liveMode;
  },

  setFailureSimulation(tenantId: string, mode: FailureSimulationMode): void {
    const state = getOrInitState(tenantId);
    state.failureSimulation = mode;
    if (mode === 'None') {
      state.consecutiveFailures = 0;
      state.circuitState = 'Closed';
    }
  },

  resetCircuitBreaker(tenantId: string): void {
    const state = getOrInitState(tenantId);
    state.consecutiveFailures = 0;
    state.circuitState = 'Closed';
  },

  async invokeEndpoint(
    tenantId: string,
    endpointId: string,
    options?: {
      pathParams?: Record<string, string>;
      body?: Record<string, unknown>;
    },
  ): Promise<GatewayTryItResponse> {
    const state = getOrInitState(tenantId);
    const spec = GATEWAY_ENDPOINTS.find((e) => e.id === endpointId);
    if (!spec) {
      throw new AppError({ message: 'Unknown gateway endpoint.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const settings = settingsService.load();
    const resolvedPath = resolvePath(spec, options?.pathParams);
    const baseUrl = (settings.gatewayBaseUrl || 'http://localhost:5000').replace(/\/$/, '');
    const resolvedUrl = `${baseUrl}${resolvedPath}`;
    const correlationId = nextGwId('corr');
    const started = performance.now();

    // Circuit Breaker check
    if (state.circuitState === 'Open' && state.failureSimulation === 'SustainedOutage') {
      const openResp: GatewayTryItResponse = {
        endpointId: spec.id,
        method: spec.method,
        resolvedUrl,
        status: 503,
        latencyMs: 2,
        correlationId,
        modeUsed: state.liveMode ? 'Live' : 'Mock',
        attempts: 0,
        circuitState: 'Open',
        isProblemDetails: true,
        timestamp: new Date().toISOString(),
        body: {
          type: 'https://providerlink.example/problems/circuit-open',
          title: 'Service Unavailable (Circuit Breaker Open)',
          status: 503,
          detail: 'Downstream failure threshold reached (3 consecutive failures). Reset circuit or disable failure simulation.',
          instance: resolvedPath,
          correlationId,
        },
      };
      state.lastResponse = openResp;
      state.history.unshift(openResp);
      return openResp;
    }

    // Simulated Failure Modes (exercising Retry / Timeout / Circuit Breaker)
    if (state.failureSimulation === 'Timeout504') {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= 3) state.circuitState = 'Open';
      const timeoutResp: GatewayTryItResponse = {
        endpointId: spec.id,
        method: spec.method,
        resolvedUrl,
        status: 504,
        latencyMs: 5000,
        correlationId,
        modeUsed: 'Mock',
        attempts: 3,
        circuitState: state.circuitState,
        isProblemDetails: true,
        timestamp: new Date().toISOString(),
        body: {
          type: 'https://providerlink.example/problems/gateway-timeout',
          title: 'Gateway Timeout',
          status: 504,
          detail: 'Upstream dependency exceeded 5000ms timeout after 3 retry attempts.',
          instance: resolvedPath,
          correlationId,
        },
      };
      state.lastResponse = timeoutResp;
      state.history.unshift(timeoutResp);
      return timeoutResp;
    }

    if (state.failureSimulation === 'SustainedOutage') {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= 3) state.circuitState = 'Open';
      const failResp: GatewayTryItResponse = {
        endpointId: spec.id,
        method: spec.method,
        resolvedUrl,
        status: 503,
        latencyMs: 620,
        correlationId,
        modeUsed: 'Mock',
        attempts: 3,
        circuitState: state.circuitState,
        isProblemDetails: true,
        timestamp: new Date().toISOString(),
        body: {
          type: 'https://providerlink.example/problems/upstream-down',
          title: 'Upstream Service Unavailable',
          status: 503,
          detail: `Simulated sustained outage (failure ${state.consecutiveFailures}/3 before circuit opens).`,
          instance: resolvedPath,
          correlationId,
        },
      };
      state.lastResponse = failResp;
      state.history.unshift(failResp);
      return failResp;
    }

    // Live HTTP Mode
    if (state.liveMode) {
      try {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          'X-Correlation-Id': correlationId,
          'X-Tenant-Id': tenantId,
        };
        if (state.authSession && state.authSession.expiresAt > Date.now()) {
          headers.Authorization = `Bearer ${state.authSession.accessToken}`;
        }
        if (spec.method !== 'GET') {
          headers['Content-Type'] = 'application/json';
        }
        const res = await fetch(resolvedUrl, {
          method: spec.method,
          headers,
          body:
            spec.method !== 'GET'
              ? JSON.stringify(options?.body ?? spec.sampleBody ?? {})
              : undefined,
        });
        const latencyMs = Math.max(1, Math.round(performance.now() - started));
        let parsedBody: Record<string, unknown> = {};
        try {
          parsedBody = (await res.json()) as Record<string, unknown>;
        } catch {
          parsedBody = { rawStatus: res.statusText };
        }
        const liveResp: GatewayTryItResponse = {
          endpointId: spec.id,
          method: spec.method,
          resolvedUrl,
          status: res.status,
          latencyMs,
          correlationId,
          modeUsed: 'Live',
          attempts: 1,
          circuitState: 'Closed',
          isProblemDetails: !res.ok,
          timestamp: new Date().toISOString(),
          body: parsedBody,
        };
        state.consecutiveFailures = 0;
        state.circuitState = 'Closed';
        state.lastResponse = liveResp;
        state.history.unshift(liveResp);
        return liveResp;
      } catch (err) {
        const latencyMs = Math.max(1, Math.round(performance.now() - started));
        const errResp: GatewayTryItResponse = {
          endpointId: spec.id,
          method: spec.method,
          resolvedUrl,
          status: 502,
          latencyMs,
          correlationId,
          modeUsed: 'Live',
          attempts: 3,
          circuitState: state.circuitState,
          isProblemDetails: true,
          timestamp: new Date().toISOString(),
          body: {
            type: 'https://providerlink.example/problems/network-or-cors',
            title: 'Gateway Unreachable or CORS Blocked',
            status: 502,
            detail: `${err instanceof Error ? err.message : 'Fetch failed'}. If running locally, verify the .NET Gateway is listening on ${baseUrl} and permits browser CORS origin.`,
            instance: resolvedPath,
            correlationId,
          },
        };
        state.lastResponse = errResp;
        state.history.unshift(errResp);
        return errResp;
      }
    }

    // Mock Mode (including Transient 503 recovery on attempt 2)
    const attempts = state.failureSimulation === 'Transient503' ? 2 : 1;
    const body = buildMockResponseBody(spec, options?.pathParams, options?.body ?? spec.sampleBody);
    state.consecutiveFailures = 0;
    state.circuitState = 'Closed';

    const mockResp: GatewayTryItResponse = {
      endpointId: spec.id,
      method: spec.method,
      resolvedUrl,
      status: spec.expectedStatus,
      latencyMs: attempts === 2 ? 245 : 18 + (gwSeq % 25),
      correlationId,
      modeUsed: 'Mock',
      attempts,
      circuitState: 'Closed',
      isProblemDetails: false,
      timestamp: new Date().toISOString(),
      body,
    };
    state.lastResponse = mockResp;
    state.history.unshift(mockResp);
    return mockResp;
  },

  async pollServiceHealth(ctx: FhirRequestContext): Promise<ServiceHealthItem[]> {
    const state = getOrInitState(ctx.tenantId);
    const settings = settingsService.load();
    const now = new Date().toISOString();
    const results: ServiceHealthItem[] = [];

    // 1. Gateway health
    if (state.failureSimulation === 'SustainedOutage' || state.circuitState === 'Open') {
      results.push({
        serviceId: 'gateway',
        serviceName: '.NET Integration Gateway',
        url: `${settings.gatewayBaseUrl}/health`,
        status: 'Down',
        latencyMs: 0,
        checkedAt: now,
        reason: 'Simulated outage / Circuit breaker Open (503).',
      });
    } else if (state.failureSimulation === 'Transient503' || state.failureSimulation === 'Timeout504') {
      results.push({
        serviceId: 'gateway',
        serviceName: '.NET Integration Gateway',
        url: `${settings.gatewayBaseUrl}/health`,
        status: 'Degraded',
        latencyMs: 850,
        checkedAt: now,
        reason: `Elevated latency / retries active (${state.failureSimulation}).`,
      });
    } else if (state.liveMode) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${settings.gatewayBaseUrl.replace(/\/$/, '')}/health`);
        results.push({
          serviceId: 'gateway',
          serviceName: '.NET Integration Gateway',
          url: `${settings.gatewayBaseUrl}/health`,
          status: res.ok ? 'Up' : 'Degraded',
          latencyMs: Math.max(1, Math.round(performance.now() - t0)),
          checkedAt: now,
          reason: res.ok ? 'HTTP 200 Healthy' : `HTTP ${res.status} returned`,
        });
      } catch (err) {
        results.push({
          serviceId: 'gateway',
          serviceName: '.NET Integration Gateway',
          url: `${settings.gatewayBaseUrl}/health`,
          status: 'Down',
          latencyMs: Math.max(1, Math.round(performance.now() - t0)),
          checkedAt: now,
          reason: `Unreachable or CORS blocked (${err instanceof Error ? err.message : 'network error'}). Confirm CORS headers on ${settings.gatewayBaseUrl}.`,
        });
      }
    } else {
      results.push({
        serviceId: 'gateway',
        serviceName: '.NET Integration Gateway',
        url: `${settings.gatewayBaseUrl}/health`,
        status: 'Up',
        latencyMs: 14,
        checkedAt: now,
        reason: 'Mock Gateway healthy (switch to Live mode to probe local .NET server).',
      });
    }

    // 2. FHIR Server health
    const tFhir = performance.now();
    try {
      const cap = await getFhirClient().capabilities(ctx);
      results.push({
        serviceId: 'fhir',
        serviceName: `FHIR Server (${settings.fhirMode === 'live' ? 'Live HAPI' : 'Mock R4'})`,
        url: `${settings.fhirBaseUrl}/metadata`,
        status: cap.fhirVersion === '4.0.1' ? 'Up' : 'Degraded',
        latencyMs: Math.max(1, Math.round(performance.now() - tFhir)),
        checkedAt: now,
        reason: `FHIR ${cap.fhirVersion} (${cap.software?.name ?? 'OK'})`,
      });
    } catch (err) {
      results.push({
        serviceId: 'fhir',
        serviceName: 'FHIR Server',
        url: `${settings.fhirBaseUrl}/metadata`,
        status: 'Down',
        latencyMs: Math.max(1, Math.round(performance.now() - tFhir)),
        checkedAt: now,
        reason: `CORS or connection failure: ${err instanceof Error ? err.message : 'unreachable'}`,
      });
    }

    // 3. eCRNow health
    results.push({
      serviceId: 'ecrnow',
      serviceName: 'eCRNow Service',
      url: `${settings.ecrNowBaseUrl}/api/health`,
      status: state.liveMode ? 'Degraded' : 'Up',
      latencyMs: 19,
      checkedAt: now,
      reason: state.liveMode
        ? 'Live eCRNow uses built-in stub fallback when browser CORS is not enabled.'
        : 'Built-in eCRNow stub active and ready.',
    });

    state.health = results;
    return results;
  },

  simulateClientCredentialsAuth(
    tenantId: string,
    input: { clientId: string; clientSecret: string; scope: string; ttlSeconds?: number },
  ): ClientCredentialsSession {
    if (!input.clientId.trim() || !input.clientSecret.trim()) {
      throw new AppError({
        message: 'Client ID and in-memory Client Secret are required to simulate token issuance.',
        statusCode: 400,
        code: 'MISSING_CREDENTIALS',
      });
    }
    // Keep secret strictly in memory (never written to localStorage)
    settingsService.setSessionSecret(CLIENT_SECRET_KEY, input.clientSecret);

    const issuedAt = Date.now();
    const ttl = Math.max(30, Math.min(3600, input.ttlSeconds ?? 300));
    const header = typeof btoa === 'function' ? btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) : 'eyJhbGciOiJSUzI1NiJ9';
    const payload =
      typeof btoa === 'function'
        ? btoa(
            JSON.stringify({
              sub: input.clientId.trim(),
              scope: input.scope.trim() || 'system/*.read system/*.write',
              iat: Math.floor(issuedAt / 1000),
              exp: Math.floor((issuedAt + ttl * 1000) / 1000),
              sim: true,
            }),
          )
        : 'eyJzaW0iOnRydWV9';

    const session: ClientCredentialsSession = {
      clientId: input.clientId.trim(),
      scope: input.scope.trim() || 'system/*.read system/*.write',
      accessToken: `${header}.${payload}.synthetic_signature_do_not_use_in_prod`,
      issuedAt,
      expiresAt: issuedAt + ttl * 1000,
    };

    getOrInitState(tenantId).authSession = session;
    return session;
  },

  clearAuthSession(tenantId: string): void {
    settingsService.setSessionSecret(CLIENT_SECRET_KEY, '');
    getOrInitState(tenantId).authSession = undefined;
  },

  async runContractTests(tenantId: string): Promise<ContractTestResult[]> {
    const state = getOrInitState(tenantId);
    const results: ContractTestResult[] = [];

    for (const spec of GATEWAY_ENDPOINTS) {
      const resp = await this.invokeEndpoint(tenantId, spec.id, {
        pathParams: spec.samplePathParams,
        body: spec.sampleBody,
      });
      const missingKeys = spec.requiredResponseKeys.filter(
        (key) => !(key in resp.body),
      );
      const hasCorrelationId = Boolean(resp.correlationId);
      const passed =
        resp.status === spec.expectedStatus &&
        missingKeys.length === 0 &&
        hasCorrelationId;

      results.push({
        endpointId: spec.id,
        path: spec.path,
        method: spec.method,
        expectedStatus: spec.expectedStatus,
        actualStatus: resp.status,
        missingKeys,
        hasCorrelationId,
        passed,
        latencyMs: resp.latencyMs,
      });
    }

    state.contractResults = results;
    return results;
  },
};
