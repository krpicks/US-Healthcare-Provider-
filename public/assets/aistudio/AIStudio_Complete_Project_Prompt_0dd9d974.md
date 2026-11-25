# Complete Project Prompt for Google AI Studio (Build mode)

**How to use**
1. Open Google AI Studio, start a new Build app, and paste everything inside the box below ("BEGIN PROMPT" to "END PROMPT") as your first message.
2. The prompt tells AI Studio to work in phases and stop after each one. Reply `Continue to Phase N` (or describe fixes) after you have tested each phase. Building all 24 modules in one generation is unlikely to succeed, so the phase gates matter.
3. If AI Studio drifts, paste the "Global rules" section again and say: only change files for this module.
4. Result is a prototype with synthetic data. AI Studio cannot run Java or .NET services, so the app talks to FHIR through a pluggable client with a built-in Mock mode. Verify standards versions (US Core, UDS+, eCR IG), eCRNow endpoints and state rules before any real use.

---

## BEGIN PROMPT

You are a senior healthcare interoperability architect and front-end engineer. Build a web application named **ProviderLink FHIR Platform** using React and TypeScript with an accessible (WCAG 2.1 AA), responsive UI with light and dark modes.

### 1. Product purpose
A multi-tenant Medicaid provider management and healthcare interoperability platform. It covers: tenant onboarding and configuration, provider management, plan management, provider enrollment, automated validation, risk-based screening, determination with RFI and appeals, credentialing and contracting, MMIS and EDI setup, claims simulation, ongoing monitoring and revalidation, electronic case reporting (eCR, eCRNow style), UDS+ reporting readiness, FHIR conformance with Inferno, an integration console for a .NET gateway, security and privacy, notifications, analytics, diagnostics and documentation.

### 2. Technical constraints and architecture
- Front-end only unless a backend is explicitly requested later. Never put secrets in source. Token and secret fields are held in memory for the session only, with a visible warning.
- Layering: UI components -> module services -> FhirClient interface. UI components never call fetch directly. Modules depend downward only. Cross-module communication uses a typed event bus.
- `FhirClient` interface methods: capabilities, create, read, vread, update, patch, delete, search (with paging helper), history, transaction, batch, operation ($validate, $everything), conditionalCreate.
- `LiveFhirClient`: REST to a configurable FHIR R4 base URL, application/fhir+json, optional Bearer token, 15 second timeout, retry 3 times with exponential backoff on 429, 502, 503, 504, OperationOutcome parsed into a typed AppError, startup check that /metadata fhirVersion is 4.0.1.
- `MockFhirClient`: in-memory store per tenant, id and versioning (meta.versionId, meta.lastUpdated), search parameters for token (system|code), string, date prefixes (eq, ge, le, gt, lt), reference, number, _id, _lastUpdated, _count, _sort, _summary=count, _include, _revinclude, transaction bundles with urn:uuid reference resolution, and $validate returning an OperationOutcome (required fields, valid enums, code system present, reference targets exist). Default mode is Mock.
- Typed FHIR R4 models for: Patient, Practitioner, Organization, PractitionerRole, Location, Endpoint, OrganizationAffiliation, InsurancePlan, Encounter, Condition, Observation, Procedure, Coverage, Claim, ClaimResponse, PaymentReconciliation, Questionnaire, QuestionnaireResponse, DocumentReference, Task, Communication, Provenance, AuditEvent, Subscription, RiskAssessment, DetectedIssue, Composition, Bundle, OperationOutcome, MeasureReport, Consent.
- Folder structure: /src/app, /src/modules/<module>, /src/services, /src/fhir, /src/components, /src/rules, /src/mock-data, /src/types, /src/tenancy, /src/events. Include unit tests for services and rules.
- Persist settings in localStorage. Show a permanent banner: "Prototype - synthetic data only".

### 3. Global rules (apply to every module)
1. **Multi-tenancy everywhere**: every service, FhirClient call, event, audit entry, notification and report is scoped by a TenantContext. Mock mode keeps a separate store per tenant. Live mode adds the tenant partition to the base URL ({fhirBase}/{tenantCode}) or a tenant header, selectable in settings. A user of tenant A can never read tenant B data; add guards and tests proving it. Provider types, document lists, SLA days, risk rules, validators, templates and code sets come from tenant configuration (module M24), never hard-coded.
2. Roles: PlatformAdmin, TenantAdmin, ProviderUser, EnrollmentAnalyst, ScreeningAnalyst, CredentialingSpecialist, ProgramIntegrityOfficer, AgencyApprover, PlanManager, IntegrationEngineer, Auditor. Permission matrix (role x module x action: view, create, edit, approve, delete, export) in one typed file, a usePermission hook, a Guard component, a 403 page, and a demo role switcher.
3. Every create, update, delete, export and unmask writes a FHIR AuditEvent. No PHI or PII in console logs. Mask SSN, TIN, DOB and bank details unless the role has Unmask permission (audited).
4. Every list has search, filter, sort, pagination, empty, loading and error states. Every form has inline validation. Use accessible components and keyboard navigation.
5. Event bus events (tenant id and correlation id on every event): ProviderSubmitted, ValidationCompleted, ScreeningAssigned, ScreeningCompleted, ProviderApproved, ProviderDenied, CredentialingCompleted, MmisLoadAcknowledged, ProviderStatusChanged, LicenseExpiring, ExclusionHit, PlanActivated, NetworkChanged, ContractSigned, RateScheduleChanged, CaseTriggered, EicrGenerated, ReportabilityResponseReceived, TenantProvisioned, ConfigChanged.
6. Use synthetic data only. Include a seed tool with: sample FHIR bundle (Patient Jane Doe MRN-1001, ambulatory Encounter, COVID-19 Condition SNOMED 840539006, SARS-CoV-2 RNA Observation LOINC 94500-6 with value SNOMED 260373001 Detected), 10 providers, 2 tenants (Tenant A state Medicaid agency; Tenant B health center network), 3 plans, sample coverage and fee schedule.
7. After each module update an in-app **Build Status** page (module, status, test results).
8. API contract conventions for the external .NET gateway adapter: base /api/v1; headers Authorization (Bearer), X-Tenant-Id, X-Correlation-Id, Idempotency-Key; errors as RFC 7807 problem+json with correlationId and field errors; pagination page and size; dates ISO 8601 UTC.

### 4. Build phases (work in order; stop after each phase and wait for me to reply "Continue")
**Phase 0**: skeleton, routing, theme, folder structure, Build Status page.
**Phase 1 (core)**: M24, M1, M2, M3, M22, M23, M4.
**Phase 2 (provider lifecycle)**: M5, M6, M7, M8, M9, M10, M11, M12.
**Phase 3 (interoperability)**: M13, M14, M15, M16.
**Phase 4 (cross-cutting)**: M17, M18, M19, M20, M21.
**Phase 5**: end-to-end integration scenarios A to F, tests, accessibility, performance and hardening.

### 5. Module specifications

**M24 Tenant configuration and onboarding (core, build first)**
- Tenant model: id, code (slug), legal name, type (State Medicaid agency, Health plan, Health center, Vendor), status (Draft, Provisioning, Active, Suspended, Offboarded), timezone, locale, data region, contacts. Header tenant switcher for PlatformAdmin only.
- TenantResolver and TenantContext used by all services (see global rule 1).
- 12-step onboarding wizard: (1) profile, (2) program template (Medicaid FFS, Managed Care, Health Center UDS+), (3) branding (logo, colors, support contact, template header and footer), (4) endpoints (FHIR base, auth mode, gateway URL, eCRNow URL, MMIS, clearinghouse, public health) with Test connection each, (5) identity (OIDC issuer, client id, redirect URIs, group-to-role mapping), (6) roles and permissions (start from defaults and customize), (7) business rules (provider types, application types, required documents, risk rules, SLA days, revalidation and recredentialing cycles, fee rules), (8) validators and monitors (enable, Mock or Gateway), (9) code sets and value sets (taxonomy, specialties, trigger codes, UDS+ elements), (10) notification templates and channels, (11) feature flags, (12) review with dry run listing everything to be created, then Provision.
- Provisioning creates the tenant partition or store, seeds reference data, creates the admin user and default roles, writes Provenance and AuditEvent, shows a step log with retry. Offboarding: suspend, export data bundle, schedule deletion with legal hold check.
- Configuration management: each setting has key, type, default, scope (PLATFORM, PROGRAM, TENANT, ENVIRONMENT), validation schema, description. Show the effective value and its source layer, versioned history with diff, rollback and approval for sensitive keys. Export and import tenant configuration as JSON (secrets excluded) with a validation report before applying.
- Feature flags per tenant and environment with percentage rollout and scheduled enable. Tenant dashboard with integration health and configuration drift. Secrets: store vault references only.
- Tests: config layer resolution, tenant isolation, wizard validation, provisioning rollback, import validation.

**M1 App shell, design system, RBAC, settings, audit**
- Collapsible sidebar grouped Core, Provider Lifecycle, Interoperability, Cross-cutting; header with environment badge (Mock or Live), role switcher, notification bell.
- Design system (buttons, inputs, selects, date pickers, sortable paginated tables, tabs, stepper, timeline, badges, modals, toasts, skeletons, empty states) with a hidden /design-system route.
- Permission matrix, Guard, 403 and 404 pages, global error boundary.
- Settings: FHIR (mode, base URL, auth mode, in-memory token), gateway, eCRNow, Inferno URLs, feature flags, theme, with Test connection showing status, latency and error text.
- Audit Log screen with filters (user, action, resource type, date, outcome), JSON detail drawer and CSV export.

**M2 FHIR connectivity and data access**
- Implement FhirClient, LiveFhirClient and MockFhirClient exactly as in section 2, with seed data and unit tests (search engine, transaction reference resolution, retry).
- FHIR Explorer screen: choose resource type, build searches with parameter rows, results table and raw JSON, JSON editor with $validate before save, history and versions, run a pasted transaction bundle, and a Request log panel (method, URL, status, duration, OperationOutcome, last 100 calls, no bodies by default).

**M3 Provider master data and directory**
- Resources: Practitioner, Organization, PractitionerRole, Location, Endpoint. Identifiers: NPI (system http://hl7.org/fhir/sid/us-npi, Luhn check), Medicaid ID, taxonomy, license number and state. Status extension (Applicant, Pending, Active, Suspended, Terminated, Revalidation Due) with effective period.
- Directory search by name, NPI, specialty, provider type, city, state, status, accepting new patients; CSV export.
- Provider 360 tabs: Profile, Roles and Specialties, Locations, Identifiers, Status History, Documents, Enrollment Cases, Credentialing, Alerts, Audit.
- Create and edit with validation and conditional create on NPI. Duplicate detection scoring (NPI, name similarity, address, TIN) with a side-by-side Duplicate Review screen and merge recorded in Provenance.
- SyncService publishProviderToFhir builds a transaction Bundle (provider, PractitionerRole, Location, Endpoint) with urn:uuid references.

**M22 Provider management (operations)**
- Staff list and detail with saved filters, bulk actions (status change, assign network, export, message) and full change history.
- Roster management: CSV or JSON template, row validation (NPI check digit, required fields, duplicates, taxonomy), row-level error report, fix and re-upload, transaction Bundle creating or updating Practitioner, PractitionerRole and OrganizationAffiliation with created, updated, skipped, failed counts.
- Affiliations between individuals and groups, facilities and locations with dates, role, specialty, billing authority, tree view, overlap validation.
- Network participation per provider and plan: status (Participating, Pending, Closed, Terminated), dates, accepting new patients, panel size, age and gender limits, languages, accessibility; bulk update with preview.
- Self-service change requests (provider portal) for address, phone, hours, locations, taxonomy, accepting-new-patients, banking details (approval required) and ownership changes (routes to enrollment). Each becomes a Task with before and after diff, approval rules from tenant config, auto-apply with Provenance.
- Status management (suspend, reinstate, terminate with reason and effective date) publishing ProviderStatusChanged; claims blocked for non-active providers.
- Targeted provider messages with delivery tracking; directory data quality scores, stale record report (not verified in 90 days), attestation campaigns; delegated users with limited permissions and expiry.

**M23 Plan management**
- Plan catalogue (Organization and InsurancePlan): plan code, name, type (FFS, MCO, CHIP, Dual, Other), market, effective dates, status (Draft, Active, Closed), service area (counties or ZIPs), enrollment rules, contacts, appeals information; effective-dated versions and change history.
- Benefits per plan: category, covered, limits, copay or coinsurance, prior authorization, referral; benefit summary preview; copy plan to next plan year.
- Networks per plan (primary care, behavioral health, dental, specialty); assign providers with dates and status, bulk assign by filter; network size by specialty and county; adequacy check against configurable standards (distance or time placeholder, provider to member ratios) listing gaps.
- Plan-provider contracts: template, rate schedule, dates, amendments, signature, status (Draft, Sent, Signed, Active, Expired, Terminated), expiry alerts.
- Rate schedules: versioned fee schedules (code, modifier, rate, effective dates), CSV import and export, assignment to plans and provider types, effective rate lookup by code, plan, provider and date (used by M11).
- Prior authorization rules per plan (code, criteria text); sample Coverage records and an eligibility check function (used by M11).
- Plan directory publishing: build FHIR InsurancePlan, Organization, OrganizationAffiliation, PractitionerRole, Location bundles, validate with $validate, publish, and show a diff against what is published.
- Reports: networks by plan, providers in several plans, plans nearing end date, expiring contracts, adequacy gaps. Events: PlanActivated, NetworkChanged, ContractSigned, RateScheduleChanged.

**M4 Patient and clinical data explorer**
- Patient search (name, MRN, birth date, gender, city) and new patient form with conditional create on MRN.
- Chart tabs: Summary, Timeline (merged Encounter, Condition, Observation, Procedure, MedicationRequest), Labs, Conditions, Encounters, Raw FHIR, Everything ($everything with _revinclude fallback).
- Forms to add Encounter, Condition, Observation, Procedure using local code pickers (SNOMED, LOINC, ICD-10-CM, RxNorm samples).
- Seed tool: load the sample bundle; generator for N synthetic patients including reportable-condition cases (positive COVID-19 PCR, chlamydia, hepatitis C antibody). Buttons: Check eCR triggers (M13) and Include in UDS+ preview (M14).

**M5 Enrollment application wizard (provider portal)**
- State machine: Draft, Submitted, In Validation, In Screening, In Review, RFI Issued, Approved, Denied, Withdrawn.
- Steps: (1) applicant and NPI lookup, (2) application type (New, Revalidation, Update, Change of ownership, Reinstatement), (3) provider type and specialty with conditional sections, (4) contract (FFS, Managed Care), (5) ownership type and organization details, (6) ownership and control disclosures (owners 5 percent or more, managing employees, subcontractors), (7) practice locations and hours, (8) licenses, certifications, DEA, (9) taxonomy and billing, (10) documents with required checklist per provider type, (11) attestations and e-signature, (12) review and submit.
- Form driven by tenant JSON configuration per provider type; stored as QuestionnaireResponse and Task. Autosave, resume, progress, help text, Save and exit.
- Document upload: PDF, PNG, JPG up to 10 MB, status Missing, Uploaded, Rejected, DocumentReference with SHA-256 computed in the browser. Application fee step (simulated, Paid or Waived).
- Submit publishes ProviderSubmitted. Status tracker timeline; RFI response with extra uploads.

**M6 Automated validation engine**
- Validator interface { id, name, run(case) } returning Pass, Fail, Warning or Unable with evidence. Validators: NPI (format, Luhn, NPPES simulation), License (state board simulation, status, expiry), Exclusion (SAM and OIG-LEIE simulation with seeded list of 5 excluded names), Death Master, Address standardisation, Duplicate enrollment (uses M3), TIN match, DEA, Taxonomy consistency.
- Orchestrator runs applicable validators in parallel with timeouts and partial-failure handling; failures stored as DetectedIssue; summary on the Task; publishes ValidationCompleted.
- Analyst screen: run or re-run, evidence cards, override with mandatory reason (Provenance), Create RFI from failures. Rules screen: enable, severity, timeout, Mock or Gateway mode per validator (POST /api/v1/validators/{validatorId}, fallback to Mock with a warning). Editable reference data screen.

**M7 Risk-based screening**
- Editable rules mapping provider type, ownership, years in business, sanctions and revalidation history to Limited, Moderate or High (with version history). Store RiskAssessment.
- Tasks by level: Limited (database checks), Moderate (plus site visit), High (plus fingerprint-based background check for owners with 5 percent or more).
- Workbench with site-visit form, background-check tracker, override with reason and approver. Events ScreeningAssigned and ScreeningCompleted; when all complete, case moves to In Review.

**M8 Review, determination, RFI, appeals**
- Workqueue with filters, sorting, SLA indicator (On track, At risk, Breached), bulk assign, Next case.
- Case review split view; decision panel: Approve (effective date, provider type, contract, rates), Deny (reason codes, appeal rights), Pend with RFI (deficiency catalogue, due date), Escalate. Two-person rule: Deny and High-risk Approve need AgencyApprover sign-off.
- RFI: Communication to provider, reminders at 7 and 2 days, response resumes review, auto-withdraw after configurable days.
- Appeals: window, reasons, documents, queue, outcomes (Upheld, Overturned, Remanded); overturn re-opens the case. Decision letters from M18 templates. SLA configuration and decision history report. Publish ProviderApproved or ProviderDenied.

**M9 Credentialing and contracting**
- Credentialing file with PSV checklist (education, training, board certification, license, 5-year work history, malpractice, sanctions, hospital privileges) with source, date, verifier, result, document.
- Committee workflow (clean files auto-approve; flagged files to committee with agenda, notes, votes, minutes export). Recredentialing scheduler (36 months default, configurable).
- Contract templates per program with merge fields, e-signature, dates, amendments; network assignment (links to M23); Share credentialing with plan (FHIR Bundle plus Provenance); dashboard.

**M10 MMIS load and EDI trading partner setup**
- On ProviderApproved generate Medicaid ID (configurable format) and an MMIS load record; statuses Queued, Sent, Acknowledged, Rejected. Adapters: Mock (JSON and fixed-width export, simulated acknowledgement with 5 percent random rejection) and Gateway (POST /api/v1/mmis/loads).
- Reconciliation screen (MMIS vs FHIR mismatches) with Fix in FHIR or Resend.
- EDI wizard: trading partner id, transactions (837P, 837I, 835, 270/271, 276/277, 278), submitter and receiver ids, connectivity (portal, SFTP, API), test checklist. EDI test console with simulated syntax validation and 999 and 277CA acknowledgements, go-live approval.

**M11 Claims and operations (simulation)**
- Claim submission (patient, billing and rendering providers, plan, service lines with CPT or HCPCS, diagnosis, units, charges, dates) as FHIR Claim.
- Pipeline in order: edit checks, eligibility (Coverage), provider enrollment check (ACTIVE on date of service), network participation, prior authorization, pricing from M23 rate schedule, decision Paid, Denied (reason codes such as PROVIDER_NOT_ACTIVE) or Pended. Produce ClaimResponse, a remittance advice view and PaymentReconciliation.
- Prior authorization mini-flow, provider help desk tickets, operations dashboard (claims by outcome, denial Pareto, days to pay).

**M12 Ongoing monitoring and revalidation**
- Monitors: exclusion re-screen monthly, license expiry alerts at 90, 60, 30 days, death master, adverse actions, returned mail, revalidation due, with frequency, enable flag, last and next run, Run now.
- Alerts (ExclusionHit, LicenseExpiring, RevalidationDue, OwnershipChange) with Tasks and events; actions: Acknowledge, Suspend provider, Start revalidation, Dismiss with reason.
- Revalidation reuses the M5 wizard pre-filled; reminders via M18; Revalidation Due then Terminated after grace period. Change of ownership flow, suspension and termination with program integrity referral, notifications to plans and MMIS. Simulated FHIR Subscription (Mock) and real Subscription creation (Live). Calendar of expirations.

**M13 Electronic case reporting (eCR)**
- Trigger codes screen (editable local value set with SNOMED, LOINC, ICD-10-CM samples for COVID-19, chlamydia, hepatitis C, measles; version and dates).
- Trigger engine on new Condition, Observation, Encounter, MedicationRequest, and on demand from M4; Trigger Log.
- eICR builder (FHIR document Bundle with Composition and sections for reason for visit, problems, results, encounter) with preview and $validate. Workflow: Triggered, Data retrieved, eICR created, Submitted, Acknowledged, RR received, Closed; follow-up updates and closure.
- eCRNow adapter: configurable endpoint paths (they depend on the eCRNow version); if not configured use a built-in stub with acknowledgement and simulated Reportability Response (Reportable, May be reportable, Not reportable). RR intake attaches DocumentReference and notifies via M18. Public health authority stub screen (accept or reject eICRs).

**M14 UDS+ reporting readiness**
- Requirements screen: editable checklist of UDS+ data elements (demographics including race and ethnicity, SDOH, encounters, diagnoses, labs, vitals, immunizations, measure inputs) with source FHIR path and availability (Present, Partial, Missing). The list must follow the current IG, so keep it editable.
- Cohort builder by reporting period and criteria. De-identification (remove names, contacts, MRNs, exact addresses; consistent per-patient date shift; generalised ZIP; salted-hash pseudonyms; mapping kept in memory only, never exported) with before and after view.
- Profile validation with $validate against configured UDS+ and US Core profile URLs; data quality fixes linking to M4. Submission Bundle builder and download; submission stub with acknowledgement, rejection and resubmission; report history; completeness scorecard.

**M15 Conformance and Inferno dashboard**
- Inferno configuration card (URL, target FHIR base, suite, IG version, patient ids), Open Inferno button, manual steps checklist.
- Import Inferno result files (JSON or CSV): run history with pass, fail, skip, omit counts and trend chart. Failure triage board with probable cause category (data, profile claim, CapabilityStatement, search parameter, auth, server config), owner, status, notes, and a catalogue of common fixes.
- Built-in checks: fhirVersion 4.0.1, CapabilityStatement lists needed resources and interactions, required search parameters work, $validate works, meta.profile present, reference integrity. Printable conformance report.

**M16 Integration gateway console (.NET)**
- Endpoint table with Try it: GET /health, GET /api/v1/fhir-version, POST /api/v1/tenants, POST /api/v1/providers/sync, POST /api/v1/validators/{id}, GET /api/v1/patients/{id}/ecr-trigger, and others from the contract conventions; parameter inputs, response viewer, status and latency.
- Health dashboard polling gateway, FHIR and eCRNow every 30 seconds (Up, Degraded, Down with reason, including a clear CORS message). Authentication simulation for client credentials with in-memory secret and expiry countdown plus a warning that real secrets belong in the gateway.
- Mapping viewer (source field to FHIR element, validation rules), resilience documentation (retry, timeout, circuit breaker) with a Simulate failure toggle, and a contract test runner comparing status and JSON shape.

**M17 Security, privacy, compliance**
- Demo login per role with session timeout warning; OIDC configuration page; SMART scope viewer with scope enforcement in services (403-style AppError); PII masking with audited Unmask; break-glass access with reason and time limit; Consent editor and sensitive-record hiding rule.
- HIPAA technical safeguards checklist with owner and evidence link; access review screen (Certify or Revoke); retention and legal hold flags; security hygiene notes.

**M18 Notifications and correspondence**
- Notification centre, event-to-template mapping, template manager (versioned, preview, approval) for acknowledgement, RFI, approval, denial with appeal rights, revalidation reminder, termination notice, eCR RR notice; delivery log (Queued, Sent, Failed) stored as Communication with retry; user preferences including quiet hours.

**M19 Analytics and KPI dashboard**
- Executive KPIs: first-pass acceptance, median days to determination, auto-validation percentage, RFI rate, appeal overturn rate, revalidation on time, provider counts by status. Interoperability tab (API success, p95 latency, eICR counts, UDS+ completeness, latest Inferno pass rate). Operations, program integrity tabs. Every chart has table toggle, CSV export, accessible description; editable KPI targets with red, amber, green thresholds; generated demo history for Mock mode.

**M20 Diagnostics and troubleshooting**
- Connectivity wizard classifying failures (refused or DNS, CORS, TLS, timeout, 401 or 403, 404, 5xx, not a FHIR server). Searchable knowledge base (Symptom, Cause, Fix, Verification): port 8080 clash between HAPI and eCRNow, HAPI Postgres dialect or driver error, container cannot reach localhost (host.docker.internal), unresolved reference in transaction (urn:uuid), 422 validation failure, auth mismatch, JDK or Maven mismatch for eCRNow, slow first start loading IGs, Inferno failures from missing profile claims, CORS.
- Symptom matcher, OperationOutcome explainer, support bundle export (secrets masked), troubleshooting log exportable as Markdown.

**M21 Documentation, architecture viewer, deployment**
- Architecture viewer generated from a module registry (id, name, layer, dependencies, events, FHIR resources): layered diagram and solution diagram (EHR and clinical systems, eCRNow, .NET integration layer, HAPI FHIR with PostgreSQL, Inferno, UDS+).
- Catalogues: events, services, FHIR resources per module, permission matrix. Setup guide pages (HAPI with PostgreSQL via Docker Compose on port 8081, eCRNow on 8080, .NET gateway on 5000, Inferno on 4567) with copy buttons and verification steps. Decision log (ADRs), deployment page (Local, Dev, Test, Staging, Production), CI/CD summary (build, unit tests, static analysis, dependency and secret scans, container scan, integration tests, FHIR validation, Inferno, contract diff, performance smoke, DAST, manual production approval), export all documentation as one Markdown file.
- Unit test: every module in the registry has a route, permission entry and Build Status entry.

### 6. End-to-end scenarios to implement and verify in Mock mode (Phase 5)
- **A Provider lifecycle**: submit application (M5), validation (M6), risk (M7), approval (M8), credentialing (M9), MMIS load and trading partner request (M10), directory publication (M3), plan network and rate assignment (M23), claim paid (M11).
- **B Program integrity**: add a seeded provider to the exclusion list; M12 raises ExclusionHit, provider suspended, M3 status changes, M10 notified, M11 denies a new claim, M18 notifies, M19 updates.
- **C eCR**: load patient with positive SARS-CoV-2 result, trigger fires, eICR built and validated, submitted to stub, RR received, notification and KPI updated.
- **D UDS+**: cohort, de-identify, validate, submission Bundle, gap report.
- **E Conformance and troubleshooting**: built-in checks, import sample Inferno result, triage cards, simulate gateway outage, resolve using M20.
- **F Security and tenancy**: onboard two tenants with different rules; confirm tenant isolation, role restrictions, masking, scope enforcement and audit entries across scenarios A to E.

### 7. Quality requirements
- Automated unit and component tests; a Test Report page; accessibility audit and fixes (focus order, labels, contrast, chart text alternatives); performance (virtualised long tables, lazy-loaded modules, memoisation); consistent error handling and an offline banner; sanitised rendered content; validated JSON imports; restricted file types.
- Keep Mock mode working at all times; Live mode is an optional switch.

### 8. How to respond
Start with Phase 0 only. After each phase: list files created or changed, how to test it, which acceptance checks pass, known gaps, and then stop and wait for me to say "Continue to Phase N". Do not rewrite earlier modules unless I ask or a defect requires it.

## END PROMPT
