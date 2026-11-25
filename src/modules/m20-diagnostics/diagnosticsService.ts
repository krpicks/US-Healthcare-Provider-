import { settingsService } from '../../services/settingsService';
import { AppError, type FhirOperationOutcome } from '../../types';
import { conformanceService } from '../m15-conformance/conformanceService';
import { gatewayService } from '../m16-gateway/gatewayService';

export type FailureClass =
  | 'Refused / DNS'
  | 'CORS Blocked'
  | 'TLS / Certificate'
  | 'Timeout'
  | '401 / 403 Auth'
  | '404 Not Found'
  | '5xx Server Error'
  | 'Not a FHIR Server';

export interface ConnectivityDiagnosis {
  classification: FailureClass;
  probableCause: string;
  fixSteps: string[];
  verification: string;
}

export interface KnowledgeBaseEntry {
  id: string;
  title: string;
  keywords: string[];
  symptom: string;
  cause: string;
  fix: string;
  verification: string;
}

export interface ExplainedOutcomeIssue {
  severity: string;
  code: string;
  expression: string;
  diagnostics: string;
  plainEnglishFix: string;
  relatedKbId?: string;
}

export interface TroubleshootingLogEntry {
  id: string;
  timestamp: string;
  symptom: string;
  actionTaken: string;
  outcome: 'Resolved' | 'Open' | 'Escalated';
}

export const INTEROP_KNOWLEDGE_BASE: KnowledgeBaseEntry[] = [
  {
    id: 'kb-port-8080',
    title: 'Port 8080 Clash Between HAPI FHIR and eCRNow',
    keywords: ['8080', 'port', 'bind', 'address already in use', 'ecrnow', 'hapi'],
    symptom: 'Docker Compose fails with "Bind for 0.0.0.0:8080 failed: port is already allocated" or requests hit the wrong service.',
    cause: 'Both default HAPI FHIR JPA Server and eCRNow bind to port 8080.',
    fix: 'Map HAPI FHIR to host port 8081:8080 in docker-compose.yml and keep eCRNow on 8080. Update M1 Settings FHIR Base URL to http://localhost:8081/fhir.',
    verification: 'Run curl http://localhost:8081/fhir/metadata and confirm HAPI returns fhirVersion 4.0.1.',
  },
  {
    id: 'kb-hapi-postgres',
    title: 'HAPI FHIR PostgreSQL Dialect or JDBC Driver Error',
    keywords: ['postgres', 'dialect', 'jdbc', 'hibernate', 'driver', 'datasource'],
    symptom: 'HAPI FHIR exits on startup with Hibernate DialectResolutionException or PostgreSQL connection refused.',
    cause: 'Missing spring.datasource.driverClassName=org.postgresql.Driver or wrong JDBC URL host inside Docker network.',
    fix: 'Use spring.datasource.url=jdbc:postgresql://postgres:5432/hapi and org.hibernate.dialect.PostgreSQL10Dialect with depends_on healthcheck.',
    verification: 'Inspect docker logs hapi-fhir for "Started Application" and verify tables exist in hapi DB.',
  },
  {
    id: 'kb-docker-localhost',
    title: 'Container Cannot Reach Host localhost (host.docker.internal)',
    keywords: ['localhost', 'connection refused', 'docker', 'host.docker.internal', 'inferno', 'container'],
    symptom: 'Inferno or .NET Gateway inside Docker fails with ECONNREFUSED 127.0.0.1:8081 when targeting HAPI.',
    cause: 'Inside a container, localhost refers to the container itself rather than the host machine.',
    fix: 'Point containerized services to http://host.docker.internal:8081/fhir (or the shared Docker Compose service name http://hapi-fhir:8080/fhir).',
    verification: 'Run docker exec <container> curl -s http://host.docker.internal:8081/fhir/metadata.',
  },
  {
    id: 'kb-urn-uuid',
    title: 'Unresolved Reference in FHIR Transaction Bundle (urn:uuid)',
    keywords: ['urn:uuid', 'transaction', 'bundle', 'reference', 'unresolved', '400'],
    symptom: 'POSTing a FHIR transaction Bundle fails with HAPI-0502 or broken references between Practitioner and PractitionerRole.',
    cause: 'A resource references an internal resource by a bare ID instead of matching the entry.fullUrl urn:uuid:<guid>.',
    fix: 'Set identical urn:uuid:<guid> values in entry.fullUrl and all referencing fields (subject.reference, practitioner.reference).',
    verification: 'POST transaction Bundle in M2 FHIR Explorer and inspect response entry.response.location values.',
  },
  {
    id: 'kb-422-validation',
    title: 'HTTP 422 Unprocessable Entity FHIR Validation Failure',
    keywords: ['422', 'unprocessable', 'validate', 'structuredefinition', 'cardinality', 'coding'],
    symptom: 'FHIR server rejects resource creation with HTTP 422 and OperationOutcome error severity.',
    cause: 'Missing required FHIR R4 element (e.g., Condition.subject, Observation.code, Claim.insurance) or invalid terminology binding.',
    fix: 'Paste the OperationOutcome into the Explainer tab, fix the expression field path, and re-run $validate.',
    verification: '$validate returns OperationOutcome with 0 error/fatal issues.',
  },
  {
    id: 'kb-auth-mismatch',
    title: 'OAuth / SMART Auth Mismatch (401 Unauthorized / 403 Forbidden)',
    keywords: ['401', '403', 'unauthorized', 'forbidden', 'oidc', 'smart', 'scope', 'token'],
    symptom: 'Gateway or FHIR requests return 401 Invalid Token or 403 Insufficient Scope.',
    cause: 'Expired JWT, audience mismatch, or missing SMART scope (e.g., user/Practitioner.write).',
    fix: 'Verify OIDC issuer/audience in M17, refresh token in M16 Auth Simulator, and confirm required scope is granted.',
    verification: 'Re-run request and verify HTTP 200 with X-Correlation-Id header.',
  },
  {
    id: 'kb-jdk-maven',
    title: 'JDK or Maven Version Mismatch for eCRNow',
    keywords: ['jdk', 'java', 'maven', 'ecrnow', 'class file version', 'unsupportedclassversion'],
    symptom: 'Building eCRNow fails with UnsupportedClassVersionError or Maven plugin incompatibility.',
    cause: 'eCRNow requires JDK 11 or 17 LTS depending on release branch, while host has a different JDK active.',
    fix: 'Use the official eCRNow Docker image or switch JAVA_HOME to JDK 17 LTS + Maven 3.9+.',
    verification: 'Run java -version and mvn -version, then confirm eCRNow /api/health returns 200.',
  },
  {
    id: 'kb-slow-igs',
    title: 'Slow First Start Loading FHIR Implementation Guides (IGs)',
    keywords: ['slow', 'timeout', 'startup', 'ig', 'implementation guide', 'us-core', 'package'],
    symptom: 'HAPI FHIR takes 2–5 minutes on first boot and initial health polls report Down/Timeout.',
    cause: 'HAPI downloads and indexes US Core, PDex Plan-Net, eCR, and UDS+ NPM IG packages into PostgreSQL on initial boot.',
    fix: 'Allow 180s startup grace period and mount a persistent PostgreSQL volume so IGs are cached across restarts.',
    verification: 'Watch HAPI logs for "Successfully installed package hl7.fhir.us.core" then poll /metadata.',
  },
  {
    id: 'kb-inferno-profile',
    title: 'Inferno Conformance Failures from Missing meta.profile Claims',
    keywords: ['inferno', 'meta.profile', 'profile', 'us-core', 'conformance', 'must support'],
    symptom: 'Inferno flags resources as failing profile conformance despite valid elements.',
    cause: 'Server or client did not populate resource.meta.profile with the canonical US Core / UDS+ StructureDefinition URL.',
    fix: 'Add the canonical profile URL to resource.meta.profile during creation/sync and re-run Inferno.',
    verification: 'Re-import Inferno JSON in M15 and confirm profile check transitions to Pass.',
  },
  {
    id: 'kb-cors',
    title: 'Browser CORS Blocked on Local FHIR / Gateway / eCRNow',
    keywords: ['cors', 'access-control-allow-origin', 'preflight', 'failed to fetch', 'options'],
    symptom: 'Browser fetch fails with TypeError: Failed to fetch while curl succeeds from terminal.',
    cause: 'Target server lacks Access-Control-Allow-Origin and Access-Control-Allow-Headers (X-Tenant-Id, Authorization, X-Correlation-Id).',
    fix: 'Enable CORS on HAPI FHIR (hapi.fhir.cors.allowed_origin=*) and .NET Gateway (app.UseCors) for local dev origin.',
    verification: 'Poll health in M16 Health Dashboard and verify Up status without CORS warning.',
  },
];

export const SAMPLE_OPERATION_OUTCOME = JSON.stringify(
  {
    resourceType: 'OperationOutcome',
    issue: [
      {
        severity: 'error',
        code: 'required',
        diagnostics: 'Patient.meta.profile is required for US Core conformance validation.',
        expression: ['Patient.meta.profile'],
      },
      {
        severity: 'error',
        code: 'not-found',
        diagnostics: 'Unresolved reference urn:uuid:prac-1 in transaction Bundle.',
        expression: ['Bundle.entry[1].resource.practitioner'],
      },
      {
        severity: 'warning',
        code: 'code-invalid',
        diagnostics: 'LOINC code not found in local terminology cache.',
        expression: ['Observation.code.coding[0]'],
      },
    ],
  },
  null,
  2,
);

const logByTenant = new Map<string, TroubleshootingLogEntry[]>();
let diagSeq = 100;

function nextDiagId(prefix: string): string {
  diagSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${diagSeq}`;
}

function getLog(tenantId: string): TroubleshootingLogEntry[] {
  const existing = logByTenant.get(tenantId);
  if (existing) return existing;
  const arr: TroubleshootingLogEntry[] = [];
  logByTenant.set(tenantId, arr);
  return arr;
}

export function maskSecretsInObject<T>(input: T): T {
  const secretKeyPattern = /(secret|token|password|apikey|api_key|authorization|ssn|tin)/i;
  const visit = (val: unknown, keyName?: string): unknown => {
    if (keyName && secretKeyPattern.test(keyName) && typeof val === 'string' && val.length > 0) {
      return '***REDACTED***';
    }
    if (typeof val === 'string') {
      // Redact Bearer tokens or SSN-like strings embedded in text
      return val
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***REDACTED***')
        .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '***-**-****');
    }
    if (Array.isArray(val)) {
      return val.map((item) => visit(item));
    }
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        out[k] = visit(v, k);
      }
      return out;
    }
    return val;
  };
  return visit(input) as T;
}

export const diagnosticsService = {
  resetForTests(): void {
    logByTenant.clear();
  },

  classifyConnectivityFailure(input: {
    httpStatus?: number;
    errorMessage?: string;
    responseBodySnippet?: string;
  }): ConnectivityDiagnosis {
    const status = input.httpStatus ?? 0;
    const msg = (input.errorMessage ?? '').toLowerCase();
    const body = (input.responseBodySnippet ?? '').toLowerCase();

    if (status === 401 || status === 403 || msg.includes('401') || msg.includes('403') || msg.includes('unauthorized')) {
      return {
        classification: '401 / 403 Auth',
        probableCause: 'Missing/expired Bearer token, OIDC audience mismatch, or insufficient SMART scope.',
        fixSteps: [
          'Check OIDC issuer and audience in M17 Security & Privacy.',
          'Issue a fresh Client-Credentials test token in M16 and confirm required scopes.',
        ],
        verification: 'Retry request with valid Authorization header and confirm HTTP 200.',
      };
    }

    if (status === 404 || msg.includes('404')) {
      return {
        classification: '404 Not Found',
        probableCause: 'Incorrect FHIR base path (missing /fhir suffix) or non-existent resource ID.',
        fixSteps: [
          'Verify FHIR Base URL ends with /fhir (e.g., http://localhost:8081/fhir).',
          'Confirm tenant partition prefix matches HAPI partition configuration.',
        ],
        verification: 'GET {baseUrl}/metadata returns HTTP 200 CapabilityStatement.',
      };
    }

    if (status >= 500 || msg.includes('500') || msg.includes('502') || msg.includes('503')) {
      return {
        classification: '5xx Server Error',
        probableCause: 'Upstream HAPI FHIR, PostgreSQL, or .NET Gateway encountered an internal error or is still booting IGs.',
        fixSteps: [
          'Inspect container logs for database dialect errors or IG loading progress.',
          'Check M16 Resilience simulator to verify circuit breaker is closed.',
        ],
        verification: 'GET /health returns status Healthy (HTTP 200).',
      };
    }

    if (status === 200 && body && !body.includes('capabilitystatement') && !body.includes('"resourcetype"')) {
      return {
        classification: 'Not a FHIR Server',
        probableCause: 'Endpoint responded with HTTP 200 HTML/JSON, not a FHIR R4 CapabilityStatement (common on port 8080 clash).',
        fixSteps: [
          'Check for port 8080 clash between HAPI FHIR and eCRNow.',
          'Verify the URL includes /fhir and points to port 8081.',
        ],
        verification: 'GET {baseUrl}/metadata returns JSON with resourceType: "CapabilityStatement".',
      };
    }

    if (msg.includes('timeout') || msg.includes('abort') || msg.includes('504')) {
      return {
        classification: 'Timeout',
        probableCause: 'Target server exceeded client timeout (often during HAPI first-start IG loading).',
        fixSteps: [
          'Wait for initial FHIR IG package loading to complete.',
          'Increase per-attempt timeout or test against Mock mode while bootstrapping.',
        ],
        verification: 'Health poll latency drops below 500ms.',
      };
    }

    if (msg.includes('cert') || msg.includes('tls') || msg.includes('ssl')) {
      return {
        classification: 'TLS / Certificate',
        probableCause: 'Self-signed or untrusted HTTPS certificate on local gateway/FHIR server.',
        fixSteps: [
          'Trust the local dev certificate (dotnet dev-certs https --trust) or use HTTP for localhost dev.',
        ],
        verification: 'Browser opens {baseUrl}/metadata without TLS warning.',
      };
    }

    if (msg.includes('cors') || msg.includes('failed to fetch') || msg.includes('origin')) {
      return {
        classification: 'CORS Blocked',
        probableCause: 'Browser preflight blocked due to missing Access-Control-Allow-Origin or custom header allowlist.',
        fixSteps: [
          'Enable CORS on HAPI FHIR and .NET Gateway allowing X-Tenant-Id, Authorization, and X-Correlation-Id.',
          'Confirm server is listening on expected port.',
        ],
        verification: 'Browser fetch succeeds with HTTP 200 in M16 Health Dashboard.',
      };
    }

    return {
      classification: 'Refused / DNS',
      probableCause: 'Host unreachable, service stopped, wrong port, or container using localhost instead of host.docker.internal.',
      fixSteps: [
        'Verify Docker containers are running (docker compose ps).',
        'If calling from inside Docker, replace localhost with host.docker.internal.',
      ],
      verification: 'curl -I {baseUrl}/metadata succeeds without connection refused.',
    };
  },

  searchKnowledgeBase(query: string): KnowledgeBaseEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return INTEROP_KNOWLEDGE_BASE;
    const tokens = q.split(/\s+/).filter(Boolean);
    return INTEROP_KNOWLEDGE_BASE.map((entry) => {
      const haystack = `${entry.title} ${entry.keywords.join(' ')} ${entry.symptom} ${entry.cause} ${entry.fix}`.toLowerCase();
      const score = tokens.reduce((acc, tok) => acc + (haystack.includes(tok) ? 1 : 0), 0);
      return { entry, score };
    })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.entry);
  },

  explainOperationOutcome(rawJson: string): ExplainedOutcomeIssue[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new AppError({
        message: 'Input is not valid JSON. Paste a FHIR OperationOutcome JSON object.',
        statusCode: 400,
        code: 'INVALID_JSON',
      });
    }
    const oo = parsed as Partial<FhirOperationOutcome>;
    if (oo.resourceType !== 'OperationOutcome' || !Array.isArray(oo.issue)) {
      throw new AppError({
        message: 'JSON must have resourceType: "OperationOutcome" and an issue array.',
        statusCode: 400,
        code: 'NOT_OPERATION_OUTCOME',
      });
    }

    return oo.issue.map((iss) => {
      const diag = iss.diagnostics ?? iss.details?.text ?? 'No diagnostics provided.';
      const lower = `${iss.code} ${diag}`.toLowerCase();
      let plainEnglishFix = 'Inspect the indicated FHIRPath field and confirm it conforms to FHIR R4 cardinality and data types.';
      let relatedKbId: string | undefined;

      if (lower.includes('profile')) {
        plainEnglishFix = 'Populate resource.meta.profile with the canonical US Core / UDS+ StructureDefinition URL.';
        relatedKbId = 'kb-inferno-profile';
      } else if (lower.includes('urn:uuid') || lower.includes('reference') || iss.code === 'not-found') {
        plainEnglishFix = 'Ensure every internal reference matches an entry.fullUrl (urn:uuid:...) or an existing server resource ID.';
        relatedKbId = 'kb-urn-uuid';
      } else if (lower.includes('code') || lower.includes('terminology')) {
        plainEnglishFix = 'Verify coding.system URI (http://loinc.org, http://snomed.info/sct) and code spelling against the IG value set.';
        relatedKbId = 'kb-422-validation';
      } else if (iss.code === 'required') {
        plainEnglishFix = 'Add the missing mandatory FHIR R4 field indicated in the expression path before re-validating.';
        relatedKbId = 'kb-422-validation';
      }

      return {
        severity: iss.severity,
        code: iss.code,
        expression: (iss.expression ?? []).join(', ') || '(root)',
        diagnostics: diag,
        plainEnglishFix,
        relatedKbId,
      };
    });
  },

  buildMaskedSupportBundle(tenantId: string, extraContext?: Record<string, unknown>): Record<string, unknown> {
    const settings = settingsService.load();
    const gw = gatewayService.getState(tenantId);
    const conf = conformanceService.getState(tenantId);

    const rawBundle = {
      generatedAt: new Date().toISOString(),
      tenantId,
      environment: 'ProviderLink Synthetic Prototype',
      settings,
      gatewayHealth: gw.health,
      gatewayCircuitState: gw.circuitState,
      recentGatewayCalls: gw.history.slice(0, 10).map((h) => ({
        method: h.method,
        url: h.resolvedUrl,
        status: h.status,
        latencyMs: h.latencyMs,
        correlationId: h.correlationId,
      })),
      builtInConformanceChecks: conf.builtInChecks,
      extraContext: extraContext ?? {},
    };

    return maskSecretsInObject(rawBundle);
  },

  getTroubleshootingLog(tenantId: string): TroubleshootingLogEntry[] {
    return getLog(tenantId);
  },

  addTroubleshootingLogEntry(
    tenantId: string,
    input: Omit<TroubleshootingLogEntry, 'id' | 'timestamp'>,
  ): TroubleshootingLogEntry {
    if (!input.symptom.trim() || !input.actionTaken.trim()) {
      throw new AppError({
        message: 'Symptom and action taken are required.',
        statusCode: 400,
        code: 'INVALID_LOG_ENTRY',
      });
    }
    const entry: TroubleshootingLogEntry = {
      id: nextDiagId('tlog'),
      timestamp: new Date().toISOString(),
      symptom: input.symptom.trim(),
      actionTaken: input.actionTaken.trim(),
      outcome: input.outcome,
    };
    getLog(tenantId).unshift(entry);
    return entry;
  },

  exportTroubleshootingLogMarkdown(tenantId: string): string {
    const entries = getLog(tenantId);
    const lines = [
      '# ProviderLink Troubleshooting Log',
      `- Tenant: ${tenantId}`,
      `- Exported: ${new Date().toISOString()}`,
      '',
      ...(entries.length > 0
        ? entries.map(
            (e) =>
              `## [${e.outcome}] ${e.symptom}\n- Timestamp: ${e.timestamp}\n- Action Taken: ${e.actionTaken}\n`,
          )
        : ['_No troubleshooting entries recorded._']),
    ];
    return lines.join('\n');
  },
};
