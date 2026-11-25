export interface ApiBusinessSpec {
  id: string;
  surface: 'FHIR R4' | '.NET Gateway' | 'eCRNow / PHA' | 'Platform Events';
  method: string;
  path: string;
  businessPurpose: string;
  keyHeaders: string;
  businessRules: string;
  errorContract: string;
}

export interface DbEntitySpec {
  entity: string;
  layer: 'Multi-Tenant Core' | 'Provider Master & Plan' | 'Enrollment & Screening' | 'Claims & Monitoring' | 'Clinical & Public Health' | 'Security & Audit';
  primaryKey: string;
  tenantPartition: string;
  relationships: string;
  retentionAndMasking: string;
}

export interface ArdRequirementSpec {
  id: string;
  category: 'Functional' | 'Performance' | 'Security & Privacy' | 'Interoperability' | 'Accessibility' | 'Reliability';
  requirement: string;
  targetMetric: string;
  verificationMethod: string;
}

export interface ArbScorecardItem {
  domain: string;
  status: 'Approved' | 'Approved w/ Conditions';
  reviewer: string;
  evidence: string;
}

export interface ArbRiskItem {
  id: string;
  risk: string;
  severity: 'High' | 'Medium' | 'Low';
  mitigation: string;
  owner: string;
}

export interface StrideThreatItem {
  category: 'Spoofing' | 'Tampering' | 'Repudiation' | 'Information Disclosure' | 'Denial of Service' | 'Elevation of Privilege';
  threat: string;
  control: string;
  moduleRef: string;
}

export const API_BUSINESS_CATALOGUE: ApiBusinessSpec[] = [
  {
    id: 'api-fhir-meta',
    surface: 'FHIR R4',
    method: 'GET',
    path: '/fhir/metadata',
    businessPurpose: 'Server capability negotiation and FHIR R4 (4.0.1) version discovery.',
    keyHeaders: 'Accept: application/fhir+json, X-Tenant-Id',
    businessRules: 'Must return CapabilityStatement with fhirVersion 4.0.1 and supported resource interactions.',
    errorContract: 'OperationOutcome (404/503)',
  },
  {
    id: 'api-fhir-tx',
    surface: 'FHIR R4',
    method: 'POST',
    path: '/fhir (Bundle type=transaction)',
    businessPurpose: 'Atomic multi-resource sync (Practitioner + Organization + PractitionerRole + Location).',
    keyHeaders: 'Content-Type: application/fhir+json, X-Tenant-Id, X-Correlation-Id',
    businessRules: 'Resolves internal urn:uuid:* fullUrl references atomically; rolls back entire bundle on any entry failure.',
    errorContract: 'HTTP 400/422 OperationOutcome',
  },
  {
    id: 'api-fhir-val',
    surface: 'FHIR R4',
    method: 'POST',
    path: '/fhir/{ResourceType}/$validate',
    businessPurpose: 'Pre-submission profile conformance validation (US Core, eCR, UDS+).',
    keyHeaders: 'Content-Type: application/fhir+json, X-Tenant-Id',
    businessRules: 'Returns OperationOutcome with severity fatal/error/warning/information; 0 error/fatal issues required for clean submission.',
    errorContract: 'OperationOutcome (422)',
  },
  {
    id: 'api-fhir-everything',
    surface: 'FHIR R4',
    method: 'GET',
    path: '/fhir/Patient/{id}/$everything',
    businessPurpose: 'Retrieves complete patient clinical chart (Encounters, Conditions, Observations, Procedures, Medications).',
    keyHeaders: 'Authorization: Bearer <token>, X-Tenant-Id',
    businessRules: 'Enforces SMART scope patient/Patient.read and active FHIR Consent securityLabel filtering (PSY/ETH/HIV/SDV).',
    errorContract: '401/403/404 OperationOutcome',
  },
  {
    id: 'api-gw-sync',
    surface: '.NET Gateway',
    method: 'POST',
    path: '/api/v1/providers/sync',
    businessPurpose: 'Synchronizes approved provider master data between portal, HAPI FHIR, and downstream registries.',
    keyHeaders: 'Authorization: Bearer, X-Tenant-Id, X-Correlation-Id, Idempotency-Key',
    businessRules: 'Validates 10-digit Luhn NPI, prevents duplicate creation via conditional create, emits ProviderStatusChanged.',
    errorContract: 'RFC 7807 ProblemDetails (400/409/503)',
  },
  {
    id: 'api-gw-val',
    surface: '.NET Gateway',
    method: 'POST',
    path: '/api/v1/validators/{validatorId}',
    businessPurpose: 'Executes parallel external credential/sanction checks (NPPES, OIG-LEIE, SAM.gov, IRS TIN, State Boards).',
    keyHeaders: 'Authorization: Bearer, X-Tenant-Id, X-Correlation-Id',
    businessRules: 'Runs with per-validator timeout; gracefully degrades to Mock adapter with warning if gateway is unreachable.',
    errorContract: 'RFC 7807 ProblemDetails + Polly Retry/CB',
  },
  {
    id: 'api-gw-mmis',
    surface: '.NET Gateway',
    method: 'POST',
    path: '/api/v1/mmis/load',
    businessPurpose: 'Transmits Medicaid ID initial load or suspension status update (JSON + fixed-width HDRMMIS01 payload) to State MMIS.',
    keyHeaders: 'Authorization: Bearer, X-Tenant-Id, X-Correlation-Id',
    businessRules: 'Generates state Medicaid ID, reconciles against FHIR Practitioner, emits MmisLoadAcknowledged on ACK.',
    errorContract: 'RFC 7807 ProblemDetails (502/503)',
  },
  {
    id: 'api-gw-edi',
    surface: '.NET Gateway',
    method: 'POST',
    path: '/api/v1/edi/ack',
    businessPurpose: 'Validates X12 837P/835/270 envelopes for Trading Partner certification and generates 999 / 277CA acknowledgements.',
    keyHeaders: 'Content-Type: application/json, X-Tenant-Id',
    businessRules: 'Requires ISA/GS/ST/SE/GE/IEA envelope integrity before Trading Partner Go-Live and FHIR Endpoint creation.',
    errorContract: 'RFC 7807 ProblemDetails (400)',
  },
  {
    id: 'api-gw-health',
    surface: '.NET Gateway',
    method: 'GET',
    path: '/health',
    businessPurpose: 'Liveness & readiness check for Gateway, upstream HAPI FHIR, and eCRNow (polled every 30s in M16).',
    keyHeaders: 'X-Correlation-Id',
    businessRules: 'Reports Healthy/Degraded/Unhealthy; feeds Polly Circuit Breaker (Closed -> Open -> Half-Open).',
    errorContract: 'HTTP 503 ProblemDetails',
  },
  {
    id: 'api-ecr-submit',
    surface: 'eCRNow / PHA',
    method: 'POST',
    path: '/api/eicr/submit & /api/rr/intake',
    businessPurpose: 'Submits validated eICR Composition document Bundles to Public Health Authority and ingests Reportability Responses (RR).',
    keyHeaders: 'Authorization: Bearer, X-Tenant-Id, X-Correlation-Id',
    businessRules: 'Matches RCTC trigger codes (SNOMED/LOINC/ICD-10), persists RR as FHIR DocumentReference, publishes ReportabilityResponseReceived.',
    errorContract: 'OperationOutcome / HTTP 422/503',
  },
];

export const DB_ENTITY_CATALOGUE: DbEntitySpec[] = [
  {
    entity: 'Tenant & LayeredConfig',
    layer: 'Multi-Tenant Core',
    primaryKey: 'tenant_id (UUID) / config_version',
    tenantPartition: 'Root Partition Key (X-Tenant-Id)',
    relationships: '1:N -> All Tenant Stores, Organizations, ConfigVersions, FeatureFlags',
    retentionAndMasking: 'Legal Hold enforced on offboarding; zero secrets persisted',
  },
  {
    entity: 'Practitioner / Organization / PractitionerRole / Location / Endpoint',
    layer: 'Provider Master & Plan',
    primaryKey: 'resource.id + NPI identifier',
    tenantPartition: 'Tenant FHIR Partition',
    relationships: 'Practitioner 1:N PractitionerRole N:1 Organization; Role N:M Location & Endpoint',
    retentionAndMasking: '7-yr Medicaid retention; SSN/TIN/DOB masked unless audited unmask',
  },
  {
    entity: 'InsurancePlan / OrganizationAffiliation / Coverage',
    layer: 'Provider Master & Plan',
    primaryKey: 'plan.id / coverage.id',
    tenantPartition: 'Tenant FHIR Partition',
    relationships: 'InsurancePlan 1:N Networks & RateSchedules; Coverage N:1 Patient & Plan',
    retentionAndMasking: 'Versioned effective dates for historical claims pricing accuracy',
  },
  {
    entity: 'QuestionnaireResponse / Task / DetectedIssue / RiskAssessment',
    layer: 'Enrollment & Screening',
    primaryKey: 'application_id / task.id',
    tenantPartition: 'Tenant FHIR Partition',
    relationships: 'Application 1:1 QuestionnaireResponse; 1:N Tasks, DetectedIssues, RiskAssessments',
    retentionAndMasking: 'SHA-256 hashes on DocumentReference uploads; immutable Provenance',
  },
  {
    entity: 'Claim / ClaimResponse / PaymentReconciliation / Subscription',
    layer: 'Claims & Monitoring',
    primaryKey: 'claim.id / subscription.id',
    tenantPartition: 'Tenant FHIR Partition',
    relationships: 'Claim N:1 Patient, Practitioner, Coverage -> 1:1 ClaimResponse -> PaymentReconciliation',
    retentionAndMasking: 'Denial reason codes preserved; 7-year financial audit archive',
  },
  {
    entity: 'Patient / Encounter / Condition / Observation / Composition / DocumentReference / MeasureReport',
    layer: 'Clinical & Public Health',
    primaryKey: 'patient.id / bundle.id',
    tenantPartition: 'Tenant FHIR Partition',
    relationships: 'Patient 1:N Encounters/Conditions/Observations -> eICR Composition & UDS+ MeasureReport',
    retentionAndMasking: 'UDS+ pseudonym map is ephemeral in-memory only; never exported',
  },
  {
    entity: 'Consent / Communication / Provenance / AuditEvent',
    layer: 'Security & Audit',
    primaryKey: 'audit.id / consent.id',
    tenantPartition: 'Tenant FHIR Partition',
    relationships: 'AuditEvent tracks every read/create/update/unmask/break-glass; Consent restricts PSY/ETH/HIV/SDV',
    retentionAndMasking: '10-year immutable audit log retention (45 CFR 164.312(b))',
  },
];

export const ARD_REQUIREMENTS: ArdRequirementSpec[] = [
  {
    id: 'ARD-FR-01',
    category: 'Functional',
    requirement: 'Full 24-module Medicaid Provider Lifecycle, Plans, Clinical Explorer, eCR, UDS+, Conformance, Gateway & Cross-Cutting Governance.',
    targetMetric: '24/24 modules routed, RBAC-guarded, and operational in Mock & Live modes',
    verificationMethod: 'Module Registry integrity test + E2E Scenarios A–F',
  },
  {
    id: 'ARD-PERF-01',
    category: 'Performance',
    requirement: 'Fast interactive UI with per-module code splitting, virtualized long tables, and bounded API latency.',
    targetMetric: 'API p95 < 250ms; 24 lazy-loaded route chunks; 10k-row virtual table windowing',
    verificationMethod: 'Vite production chunk audit + VirtualTable unit tests + k6 smoke gate',
  },
  {
    id: 'ARD-SEC-01',
    category: 'Security & Privacy',
    requirement: 'Zero secrets in source/localStorage, RBAC across 11 roles x 6 actions, PII masking, audited unmask, Break-Glass & FHIR Consent.',
    targetMetric: '0 leaked secrets; 100% 403 enforcement on revoked SMART scopes & unauthorized unmask',
    verificationMethod: 'M1, M16, M17, M24 automated security tests + Gitleaks/ZAP gates',
  },
  {
    id: 'ARD-INT-01',
    category: 'Interoperability',
    requirement: 'HL7 FHIR R4 (4.0.1) compliance, US Core, PDex Plan-Net, eCR (eICR/RR), HRSA UDS+ de-identification, X12 999/277CA, RFC 7807.',
    targetMetric: '6/6 built-in FHIR R4 probes pass; Inferno JSON/CSV import & triage supported',
    verificationMethod: 'M2, M10, M13, M14, M15, M16 automated suites',
  },
  {
    id: 'ARD-A11Y-01',
    category: 'Accessibility',
    requirement: 'WCAG 2.1 Level AA compliance across Light and Dark themes, keyboard focus order, skip link, ARIA live regions, chart table views.',
    targetMetric: 'Contrast >= 4.5:1 text / 3:1 UI; 100% chart table alternatives & CSV exports',
    verificationMethod: 'Phase 5 A11y audit checklist + component tests',
  },
  {
    id: 'ARD-REL-01',
    category: 'Reliability',
    requirement: 'Mock-first resilience, offline banner notification, Polly Retry + Circuit Breaker simulation, graceful fallback when Live server is unreachable.',
    targetMetric: '100% Mock-mode uptime offline; automatic circuit breaker fast-fail on sustained 503',
    verificationMethod: 'M10, M16, M20, Scenario E & OfflineBanner tests',
  },
];

export const ARB_SCORECARD: ArbScorecardItem[] = [
  {
    domain: 'Enterprise Architecture & Modularity',
    status: 'Approved',
    reviewer: 'Chief Enterprise Architect',
    evidence: '5-tier layered architecture, registry-driven routing (24 modules), zero circular service deps via TypedEventBus (ADR-005).',
  },
  {
    domain: 'Multi-Tenancy & Data Isolation',
    status: 'Approved',
    reviewer: 'Data Architecture Lead',
    evidence: 'Strict tenant store isolation + X-Tenant-Id / path partitioning (ADR-001); 4-layer config precedence & Legal Hold offboarding.',
  },
  {
    domain: 'Security, Privacy & HIPAA Compliance',
    status: 'Approved',
    reviewer: 'CISO / Privacy Officer',
    evidence: '11-role RBAC matrix, two-person AgencyApprover sign-off (ADR-003), SMART scope 403 enforcement, Break-Glass expiry, FHIR AuditEvent & Consent.',
  },
  {
    domain: 'Healthcare Interoperability (FHIR / eCR / UDS+ / EDI)',
    status: 'Approved',
    reviewer: 'Interoperability Principal',
    evidence: 'FHIR R4 4.0.1 $validate, urn:uuid transactions, eICR Composition Bundles, in-memory UDS+ de-identification (ADR-004), Inferno dashboard.',
  },
  {
    domain: 'Resilience, Observability & DevSecOps',
    status: 'Approved',
    reviewer: 'Platform SRE Lead',
    evidence: 'RFC 7807 ProblemDetails, X-Correlation-Id tracing, Polly Retry/Circuit Breaker, M20 Diagnostics KB, 12-stage CI/CD pipeline.',
  },
  {
    domain: 'Production Readiness (Live Infrastructure)',
    status: 'Approved w/ Conditions',
    reviewer: 'Release CAB Chair',
    evidence: 'Prototype verified 123/123 tests in Mock mode; Production deployment requires BAA-covered HAPI/Postgres, enterprise OIDC IdP, and KMS secrets.',
  },
];

export const ARB_RISK_REGISTER: ArbRiskItem[] = [
  {
    id: 'RISK-01',
    risk: 'Port 8080 collision between local HAPI FHIR JPA Server and eCRNow service.',
    severity: 'Medium',
    mitigation: 'Standardized HAPI FHIR on host port 8081:8080 and eCRNow on 8080 in M21 Compose guide & M20 KB.',
    owner: 'Integration Engineer',
  },
  {
    id: 'RISK-02',
    risk: 'Unauthorized PII/PHI unmasking or sensitive behavioral health (42 CFR Part 2) disclosure.',
    severity: 'High',
    mitigation: 'RBAC unmask gate + mandatory justification + immutable FHIR AuditEvent + active Consent PSY/ETH filter + 60-min max Break-Glass.',
    owner: 'Compliance Officer',
  },
  {
    id: 'RISK-03',
    risk: 'Downstream .NET Gateway or external sanction validator (OIG/SAM) outage stalls enrollment.',
    severity: 'High',
    mitigation: 'Polly exponential backoff retry, circuit breaker fast-fail (RFC 7807), and graceful fallback to Mock adapter with warning banner.',
    owner: 'Platform SRE Lead',
  },
  {
    id: 'RISK-04',
    risk: 'UDS+ reporting bundle inadvertently leaks direct patient identifiers or re-identification lookup keys.',
    severity: 'High',
    mitigation: 'Salted-hash pseudonym & date-shift map held exclusively in volatile session memory (ADR-004); automated test asserts 0 identifiers in export.',
    owner: 'Data Governance Lead',
  },
  {
    id: 'RISK-05',
    risk: 'Cross-tenant configuration or FHIR clinical data leakage between state agencies.',
    severity: 'High',
    mitigation: 'Mandatory tenantId in FhirRequestContext, assertTenantAccess guard for non-PlatformAdmin roles, and Scenario F automated isolation test.',
    owner: 'Security Architect',
  },
  {
    id: 'RISK-06',
    risk: 'Browser CORS blocking or slow first-boot FHIR IG loading causes false-positive outage alerts.',
    severity: 'Low',
    mitigation: 'M16 CORS diagnosis hints, 180s startup grace guidance, persistent Postgres volume for IG cache, and M20 Connectivity Wizard.',
    owner: 'DevOps Lead',
  },
];

export const STRIDE_THREAT_MODEL: StrideThreatItem[] = [
  {
    category: 'Spoofing',
    threat: 'Impersonating an AgencyApprover or forging API caller identity.',
    control: 'OIDC PKCE + JWT issuer/audience validation + Client-Credentials token scoping + two-person sign-off check.',
    moduleRef: 'M1, M8, M16, M17',
  },
  {
    category: 'Tampering',
    threat: 'Altering uploaded license PDFs, JSON imports, or prototype-polluting JSON payloads.',
    control: 'SHA-256 digests on DocumentReference, strict file extension/MIME allowlist, parseAndValidateJson __proto__ stripping.',
    moduleRef: 'M5, M15, Phase 5 Hardening',
  },
  {
    category: 'Repudiation',
    threat: 'User denies approving a High-risk provider, unmasking SSN, or activating Break-Glass.',
    control: 'Immutable FHIR Provenance signatures & AuditEvent records capturing actor, role, timestamp, correlationId, and reason.',
    moduleRef: 'M1, M8, M17',
  },
  {
    category: 'Information Disclosure',
    threat: 'Leaking secrets in localStorage/support bundles or exposing PHI in console logs / UDS+ exports.',
    control: 'In-memory-only secrets, maskSecretsInObject redaction, zero console.log calls, in-memory UDS+ de-identification.',
    moduleRef: 'M14, M16, M17, M20',
  },
  {
    category: 'Denial of Service',
    threat: 'Cascading failures from hung external validators or huge file/JSON uploads.',
    control: 'Per-validator timeouts, Polly circuit breaker, 10 MB file cap, 2 MB JSON cap, virtualized tables.',
    moduleRef: 'M6, M16, Phase 5 Hardening',
  },
  {
    category: 'Elevation of Privilege',
    threat: 'ProviderUser attempting cross-tenant switch, unmasking PII, or overriding risk tier.',
    control: 'Guard component + service-level RBAC checks (403) + SMART scope enforcement + tenant isolation assertions.',
    moduleRef: 'M1, M7, M17, M24',
  },
];
