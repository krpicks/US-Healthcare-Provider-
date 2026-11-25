import { MODULE_REGISTRY, getAllRegistryEntries } from '../../app/moduleRegistry';
import { ALL_ROLES, PERMISSION_MATRIX } from '../../app/rbac';
import { PLATFORM_EVENT_TYPES } from '../../events';
import type { ModuleDefinition, ModuleLayer } from '../../types';

export interface SetupGuideSpec {
  id: string;
  title: string;
  port: number;
  summary: string;
  snippet: string;
  verificationSteps: string[];
}

export interface AdrSpec {
  id: string;
  title: string;
  status: 'Accepted' | 'Proposed';
  date: string;
  context: string;
  decision: string;
  consequences: string;
}

export interface DeploymentEnvSpec {
  name: 'Local' | 'Dev' | 'Test' | 'Staging' | 'Production';
  fhirMode: string;
  authMode: string;
  dataPolicy: string;
  promotionGate: string;
}

export interface CiCdStageSpec {
  order: number;
  name: string;
  tool: string;
  gateRule: string;
}

export const LAYER_ORDER: ModuleLayer[] = [
  'Foundation',
  'Core Platform',
  'Domain Operations',
  'Interoperability',
  'Cross-cutting',
];

export const SOLUTION_NODES = [
  { id: 'ehr', title: 'EHR & Clinical Systems', detail: 'Synthetic M4 Charts, Labs, Conditions', port: 'SPA :3000' },
  { id: 'ecrnow', title: 'eCRNow Service', detail: 'RCTC Triggers, eICR Submission & RR Intake', port: 'HTTP :8080' },
  { id: 'gateway', title: '.NET Integration Gateway', detail: '/api/v1, RFC 7807, Polly Retry/CB, MMIS', port: 'HTTP :5000' },
  { id: 'hapi', title: 'HAPI FHIR R4 + PostgreSQL', detail: 'Multi-tenant FHIR Store, $validate, IGs', port: 'HTTP :8081' },
  { id: 'inferno', title: 'Inferno Test Kit', detail: 'US Core / eCR / Plan-Net Conformance', port: 'HTTP :4567' },
  { id: 'uds', title: 'HRSA UDS+ Submission', detail: 'In-Memory De-ID Bundle & MeasureReport', port: 'Bundle Export' },
];

export const SETUP_GUIDES: SetupGuideSpec[] = [
  {
    id: 'guide-hapi',
    title: 'HAPI FHIR R4 + PostgreSQL (Docker Compose — Port 8081)',
    port: 8081,
    summary: 'Runs HAPI FHIR JPA Server backed by PostgreSQL on host port 8081 to avoid clashing with eCRNow on port 8080.',
    snippet: `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: hapi
      POSTGRES_USER: hapi
      POSTGRES_PASSWORD: \${HAPI_DB_PASSWORD}
    volumes:
      - hapi_pgdata:/var/lib/postgresql/data
  hapi-fhir:
    image: hapiproject/hapi:v7.4.0
    depends_on: [postgres]
    ports:
      - "8081:8080"
    environment:
      spring.datasource.url: jdbc:postgresql://postgres:5432/hapi
      spring.datasource.username: hapi
      spring.datasource.password: \${HAPI_DB_PASSWORD}
      hapi.fhir.fhir_version: R4
      hapi.fhir.cors.allowed_origin: "*"`,
    verificationSteps: [
      'Run docker compose up -d postgres hapi-fhir',
      'Verify GET http://localhost:8081/fhir/metadata returns fhirVersion "4.0.1"',
      'Switch M1 Settings to Live mode with http://localhost:8081/fhir and click Test Connection',
    ],
  },
  {
    id: 'guide-ecrnow',
    title: 'eCRNow Service (Port 8080)',
    port: 8080,
    summary: 'Runs the eCRNow reference app on port 8080 with configurable launch/submit paths in M13.',
    snippet: `docker run -d --name ecrnow \\
  -p 8080:8080 \\
  -e SPRING_PROFILES_ACTIVE=dev \\
  -e FHIR_SERVER_URL=http://host.docker.internal:8081/fhir \\
  ecrnow/ecrnow-app:latest`,
    verificationSteps: [
      'Verify GET http://localhost:8080/api/health responds with HTTP 200',
      'Open M13 eCRNow Adapter Config tab and confirm triggerPath/submitPath match your release',
    ],
  },
  {
    id: 'guide-gateway',
    title: '.NET 8 Integration Gateway (Port 5000)',
    port: 5000,
    summary: 'Hosts /api/v1 provider sync, validators, MMIS load adapters, RFC 7807 ProblemDetails, and Polly resilience policies.',
    snippet: `dotnet run --project src/ProviderLink.Gateway \\
  --urls "http://localhost:5000" \\
  --FhirBaseUrl="http://localhost:8081/fhir"`,
    verificationSteps: [
      'Verify GET http://localhost:5000/health returns {"status":"Healthy"}',
      'Open M16 Gateway Console, switch to Live mode, and run the Contract Test Suite',
    ],
  },
  {
    id: 'guide-inferno',
    title: 'Inferno FHIR Test Kit (Port 4567)',
    port: 4567,
    summary: 'Executes ONC US Core and IG test suites against your FHIR server; export JSON/CSV results into M15.',
    snippet: `docker run -d --name inferno \\
  -p 4567:4567 \\
  infernoframework/us-core-test-kit:latest`,
    verificationSteps: [
      'Open http://localhost:4567 and target http://host.docker.internal:8081/fhir',
      'Run US Core tests, export results JSON/CSV, and import into M15 Conformance Dashboard',
    ],
  },
];

export const ARCHITECTURE_ADRS: AdrSpec[] = [
  {
    id: 'ADR-001',
    title: 'Multi-Tenant Partitioning via Path Prefix or X-Tenant-Id Header',
    status: 'Accepted',
    date: '2026-01-05',
    context: 'State Medicaid agencies and MCOs share the platform but require strict clinical & provider data isolation.',
    decision: 'Every FHIR request passes through FhirRequestContext carrying tenantId/tenantCode, partitioned by tenant store in Mock mode and configurable path or X-Tenant-Id header in Live mode.',
    consequences: 'Zero cross-tenant data leakage; supports both HAPI Partitioned and dedicated tenant endpoints.',
  },
  {
    id: 'ADR-002',
    title: 'Mock-First Pluggable FhirClient & Adapter Architecture',
    status: 'Accepted',
    date: '2026-01-08',
    context: 'Users must evaluate all 24 modules immediately without local Docker dependencies while supporting seamless Live mode.',
    decision: 'All modules program against the FhirClient interface (MockFhirClient default, LiveFhirClient optional) and fallback gracefully on network/CORS errors.',
    consequences: '100% deterministic offline demos and automated tests alongside real HAPI FHIR R4 compatibility.',
  },
  {
    id: 'ADR-003',
    title: 'Two-Person AgencyApprover Sign-Off for High-Risk Decisions',
    status: 'Accepted',
    date: '2026-01-15',
    context: 'CMS 42 CFR 455 requires heightened oversight for High-risk provider enrollments and denials.',
    decision: 'M8 enforces dual approval requiring a distinct AgencyApprover actor for High-risk approvals and denials, recorded via FHIR Provenance.',
    consequences: 'Full non-repudiation audit trail preventing unilateral high-risk enrollment activation.',
  },
  {
    id: 'ADR-004',
    title: 'In-Memory-Only Pseudonymization for UDS+ De-Identification',
    status: 'Accepted',
    date: '2026-02-01',
    context: 'HRSA UDS+ submissions must never leak direct identifiers or re-identification lookup tables.',
    decision: 'M14 keeps the salted-hash pseudonym and per-patient date shift map exclusively in ephemeral session memory and strips all PHI prior to Bundle export.',
    consequences: 'Exported UDS+ JSON bundles contain zero names, MRNs, street addresses, or re-identification keys.',
  },
  {
    id: 'ADR-005',
    title: 'Typed Platform Event Bus for Cross-Module Orchestration',
    status: 'Accepted',
    date: '2026-02-10',
    context: 'Provider lifecycle, monitoring, eCR, notifications, and analytics need loose coupling.',
    decision: 'All modules publish tenant-scoped typed events (ProviderApproved, ExclusionHit, ReportabilityResponseReceived, etc.) on a central TypedEventBus.',
    consequences: 'M10 MMIS, M18 Notifications, and M19 Analytics stay synchronized automatically without circular module dependencies.',
  },
];

export const DEPLOYMENT_ENVIRONMENTS: DeploymentEnvSpec[] = [
  { name: 'Local', fhirMode: 'Mock (default) or HAPI :8081', authMode: 'Demo Role Switcher', dataPolicy: 'Synthetic only', promotionGate: 'Local Vitest + tsc' },
  { name: 'Dev', fhirMode: 'Shared HAPI FHIR R4 Dev', authMode: 'Dev OIDC Sandbox', dataPolicy: 'Synthetic only', promotionGate: 'CI Build + Unit + Lint' },
  { name: 'Test', fhirMode: 'Dedicated HAPI + Postgres', authMode: 'OIDC + SMART Scopes', dataPolicy: 'Synthetic QA Pack', promotionGate: 'Integration + Inferno + Contract Diff' },
  { name: 'Staging', fhirMode: 'HA HAPI + .NET Gateway', authMode: 'Enterprise IdP (PKCE)', dataPolicy: 'De-identified / Synthetic', promotionGate: 'Perf Smoke + DAST + Accessibility' },
  { name: 'Production', fhirMode: 'Multi-AZ FHIR + KMS', authMode: 'Enterprise OIDC + MFA', dataPolicy: 'HIPAA / BAA Enforced', promotionGate: 'Manual Production CAB Approval' },
];

export const CICD_STAGES: CiCdStageSpec[] = [
  { order: 1, name: 'Build', tool: 'Vite + TypeScript / dotnet build', gateRule: 'Zero compilation errors' },
  { order: 2, name: 'Unit Tests', tool: 'Vitest + xUnit', gateRule: '100% pass across all module suites' },
  { order: 3, name: 'Static Analysis', tool: 'tsc --noEmit + ESLint / Roslyn', gateRule: 'Zero type or critical lint errors' },
  { order: 4, name: 'Dependency & Secret Scans', tool: 'npm audit + Gitleaks / Trivy', gateRule: 'Zero high/critical CVEs or leaked secrets' },
  { order: 5, name: 'Container Scan', tool: 'Trivy / Grype', gateRule: 'Signed distroless images, zero critical CVEs' },
  { order: 6, name: 'Integration Tests', tool: 'Docker Compose (HAPI + Gateway)', gateRule: 'Scenarios A–F green' },
  { order: 7, name: 'FHIR Validation', tool: 'HAPI $validate (US Core / eCR / UDS+)', gateRule: 'Zero fatal/error OperationOutcome issues' },
  { order: 8, name: 'Inferno Conformance', tool: 'Inferno Test Kit Headless Run', gateRule: 'Pass rate >= configured tenant target' },
  { order: 9, name: 'Contract Diff', tool: 'OpenAPI /api/v1 + RFC 7807 Check', gateRule: 'Zero breaking API contract regressions' },
  { order: 10, name: 'Performance Smoke', tool: 'k6 (p95 < 250ms)', gateRule: 'API p95 & error budget within SLO' },
  { order: 11, name: 'DAST', tool: 'OWASP ZAP Baseline + Full', gateRule: 'Zero High/Critical security alerts' },
  { order: 12, name: 'Manual Production Approval', tool: 'Release CAB + AgencyApprover', gateRule: 'Explicit human sign-off required' },
];

export const docsService = {
  getModulesByLayer(): Array<{ layer: ModuleLayer; modules: ModuleDefinition[] }> {
    const all = getAllRegistryEntries();
    return LAYER_ORDER.map((layer) => ({
      layer,
      modules: all.filter((m) => m.layer === layer),
    }));
  },

  getEventCatalogue(): Array<{ eventType: string; publishers: string[] }> {
    return PLATFORM_EVENT_TYPES.map((evt) => ({
      eventType: evt,
      publishers: MODULE_REGISTRY.filter((m) => m.eventsPublished.includes(evt)).map(
        (m) => `${m.code} (${m.shortName})`,
      ),
    }));
  },

  getFhirResourceCatalogue(): Array<{
    code: string;
    name: string;
    layer: ModuleLayer;
    route: string;
    dependencies: string[];
    fhirResources: string[];
  }> {
    return MODULE_REGISTRY.map((m) => ({
      code: m.code,
      name: m.name,
      layer: m.layer,
      route: m.route,
      dependencies: m.dependencies,
      fhirResources: m.fhirResources,
    }));
  },

  getPermissionMatrixSummary() {
    return {
      roles: ALL_ROLES,
      matrix: PERMISSION_MATRIX,
    };
  },

  exportFullDocumentationMarkdown(): string {
    const layers = this.getModulesByLayer();
    const events = this.getEventCatalogue();

    const lines: string[] = [
      '# ProviderLink FHIR Platform — Architecture & Deployment Documentation',
      `_Generated automatically from MODULE_REGISTRY (${MODULE_REGISTRY.length} modules) on ${new Date().toISOString()}_`,
      '',
      '## 1. Layered Module Architecture',
      ...layers.flatMap((l) => [
        `### ${l.layer} (${l.modules.length})`,
        ...l.modules.map(
          (m) =>
            `- **${m.code} ${m.name}** (\`${m.route}\`, Phase ${m.phase}, ${m.status}) — Deps: ${m.dependencies.join(', ') || 'None'} | FHIR: ${m.fhirResources.join(', ') || 'None'}`,
        ),
        '',
      ]),
      '## 2. Solution Integration Topology',
      ...SOLUTION_NODES.map((n) => `- **${n.title}** (${n.port}): ${n.detail}`),
      '',
      '## 3. Platform Event Catalogue',
      ...events.map(
        (e) => `- \`${e.eventType}\` — Published by: ${e.publishers.join(', ') || 'Platform Core'}`,
      ),
      '',
      '## 4. Local Setup Guides',
      ...SETUP_GUIDES.flatMap((g) => [
        `### ${g.title}`,
        g.summary,
        '```yaml',
        g.snippet,
        '```',
        ...g.verificationSteps.map((s, idx) => `${idx + 1}. ${s}`),
        '',
      ]),
      '## 5. Architecture Decision Log (ADRs)',
      ...ARCHITECTURE_ADRS.flatMap((a) => [
        `### ${a.id}: ${a.title} (${a.status}, ${a.date})`,
        `- **Context**: ${a.context}`,
        `- **Decision**: ${a.decision}`,
        `- **Consequences**: ${a.consequences}`,
        '',
      ]),
      '## 6. Deployment Environments',
      '| Environment | FHIR Mode | Auth Mode | Data Policy | Promotion Gate |',
      '| --- | --- | --- | --- | --- |',
      ...DEPLOYMENT_ENVIRONMENTS.map(
        (d) => `| ${d.name} | ${d.fhirMode} | ${d.authMode} | ${d.dataPolicy} | ${d.promotionGate} |`,
      ),
      '',
      '## 7. CI/CD Pipeline Summary (12 Stages)',
      ...CICD_STAGES.map((s) => `${s.order}. **${s.name}** (${s.tool}) — Gate: ${s.gateRule}`),
    ];

    return lines.join('\n');
  },
};
