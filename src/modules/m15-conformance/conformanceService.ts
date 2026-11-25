import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { settingsService } from '../../services/settingsService';
import {
  AppError,
  type FhirCondition,
  type FhirEncounter,
  type FhirObservation,
  type FhirOperationOutcome,
  type FhirPatient,
  type FhirPractitioner,
  type FhirPractitionerRole,
} from '../../types';

export type InfernoTestOutcome = 'pass' | 'fail' | 'skip' | 'omit';

export type TriageCauseCategory =
  | 'data'
  | 'profile claim'
  | 'CapabilityStatement'
  | 'search parameter'
  | 'auth'
  | 'server config';

export type TriageStatus = 'Open' | 'Investigating' | 'Resolved' | 'Waived';

export interface InfernoConfig {
  infernoUrl: string;
  targetFhirBase: string;
  testSuite: string;
  igVersion: string;
  patientIds: string;
  manualChecklist: Array<{ id: string; label: string; done: boolean }>;
}

export interface InfernoTestCaseResult {
  testId: string;
  title: string;
  group: string;
  result: InfernoTestOutcome;
  message?: string;
}

export interface InfernoRunRecord {
  id: string;
  importedAt: string;
  suiteName: string;
  igVersion: string;
  sourceFormat: 'JSON' | 'CSV' | 'Sample';
  passCount: number;
  failCount: number;
  skipCount: number;
  omitCount: number;
  passRatePct: number;
  tests: InfernoTestCaseResult[];
}

export interface FailureTriageItem {
  id: string;
  runId: string;
  testId: string;
  title: string;
  errorMessage: string;
  causeCategory: TriageCauseCategory;
  owner: string;
  status: TriageStatus;
  notes: string;
  createdAt: string;
}

export interface BuiltInConformanceCheck {
  id: string;
  name: string;
  status: 'Pass' | 'Warn' | 'Fail';
  detail: string;
  checkedAt: string;
}

export interface CommonConformanceFix {
  id: string;
  causeCategory: TriageCauseCategory;
  symptom: string;
  fixSteps: string;
  verification: string;
}

export interface ConformanceTenantState {
  config: InfernoConfig;
  runs: InfernoRunRecord[];
  triageItems: FailureTriageItem[];
  builtInChecks: BuiltInConformanceCheck[];
  lastBuiltInRunAt?: string;
}

export const COMMON_CONFORMANCE_FIXES: CommonConformanceFix[] = [
  {
    id: 'fix-profile',
    causeCategory: 'profile claim',
    symptom: 'Inferno fails US Core / UDS+ profile assertion even though elements exist.',
    fixSteps: 'Populate resource.meta.profile with the canonical IG StructureDefinition URL before saving.',
    verification: 'Re-run $validate with profile parameter and verify zero error OperationOutcome issues.',
  },
  {
    id: 'fix-cap',
    causeCategory: 'CapabilityStatement',
    symptom: 'CapabilityStatement missing required resource types or searchParam declarations.',
    fixSteps: 'Verify HAPI FHIR IG packages are loaded and /metadata advertises read, search-type, and required search parameters.',
    verification: 'GET {baseUrl}/metadata and verify fhirVersion=4.0.1 and rest.resource entries.',
  },
  {
    id: 'fix-search',
    causeCategory: 'search parameter',
    symptom: 'Required US Core search parameter returns 400 or ignores filter.',
    fixSteps: 'Reindex custom SearchParameter resources on HAPI FHIR ($reindex) and confirm parameter spelling.',
    verification: 'Execute search query in M2 FHIR Explorer and inspect Bundle.total.',
  },
  {
    id: 'fix-data',
    causeCategory: 'data',
    symptom: 'Must-Support elements (e.g., us-core-race, Encounter.type, Observation.category) missing.',
    fixSteps: 'Enrich synthetic Patient/Encounter/Observation records in M4 Patient Explorer or seed bundle.',
    verification: 'Inspect Patient/$everything bundle for all Must-Support fields.',
  },
  {
    id: 'fix-auth',
    causeCategory: 'auth',
    symptom: 'SMART App Launch or Bearer token rejected with 401/403.',
    fixSteps: 'Check OIDC issuer, client scopes (patient/*.read), and token expiry in M16/M17.',
    verification: 'Verify Bearer token introspection returns active=true with required scopes.',
  },
  {
    id: 'fix-server',
    causeCategory: 'server config',
    symptom: 'CORS blocked or container cannot reach host FHIR server on localhost.',
    fixSteps: 'Enable CORS headers on HAPI FHIR and use host.docker.internal from Docker containers.',
    verification: 'Poll /metadata from browser and confirm HTTP 200 without CORS error.',
  },
];

export const SAMPLE_INFERNO_JSON = JSON.stringify(
  {
    suiteName: 'US Core v6.1.0 + Provider Directory',
    igVersion: '6.1.0',
    results: [
      { test_id: 'us_core_v610-capability', title: 'FHIR Server declares fhirVersion 4.0.1', group: 'CapabilityStatement', result: 'pass' },
      { test_id: 'us_core_v610-patient-read', title: 'Patient Read returns valid US Core Patient', group: 'Patient', result: 'pass' },
      { test_id: 'us_core_v610-patient-profile', title: 'Patient declares meta.profile for US Core', group: 'Patient', result: 'fail', message: 'Resource Patient/pat-jane-doe missing meta.profile claim for us-core-patient.' },
      { test_id: 'us_core_v610-patient-search-name', title: 'Patient search by name and birthdate', group: 'Patient', result: 'pass' },
      { test_id: 'us_core_v610-condition-search', title: 'Condition search by patient', group: 'Condition', result: 'pass' },
      { test_id: 'us_core_v610-obs-category', title: 'Observation search by patient+category', group: 'Observation', result: 'fail', message: 'Search parameter category returned unfiltered results.' },
      { test_id: 'us_core_v610-provenance', title: 'Provenance revinclude supported', group: 'Provenance', result: 'skip', message: 'Skipped: no Provenance resource referenced in test patient.' },
      { test_id: 'us_core_v610-smart-launch', title: 'Standalone SMART Launch', group: 'Auth', result: 'omit', message: 'Omitted in open sandbox run.' },
    ],
  },
  null,
  2,
);

const storeByTenant = new Map<string, ConformanceTenantState>();
let confSeq = 100;

function nextConfId(prefix: string): string {
  confSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${confSeq}`;
}

function classifyFailureCause(message: string, title: string): TriageCauseCategory {
  const txt = `${title} ${message}`.toLowerCase();
  if (txt.includes('profile') || txt.includes('structuredefinition')) return 'profile claim';
  if (txt.includes('capability') || txt.includes('metadata')) return 'CapabilityStatement';
  if (txt.includes('search') || txt.includes('parameter')) return 'search parameter';
  if (txt.includes('401') || txt.includes('403') || txt.includes('token') || txt.includes('auth') || txt.includes('smart')) return 'auth';
  if (txt.includes('cors') || txt.includes('timeout') || txt.includes('500') || txt.includes('connection')) return 'server config';
  return 'data';
}

function getOrInitState(tenantId: string): ConformanceTenantState {
  const existing = storeByTenant.get(tenantId);
  if (existing) return existing;

  const settings = settingsService.load();
  const initial: ConformanceTenantState = {
    config: {
      infernoUrl: settings.infernoBaseUrl || 'http://localhost:4567',
      targetFhirBase: settings.fhirBaseUrl || 'http://localhost:8081/fhir',
      testSuite: 'US Core v6.1.0 (ONC g(10) / ProviderLink)',
      igVersion: '6.1.0',
      patientIds: 'pat-jane-doe-state-medicaid-a',
      manualChecklist: [
        { id: 'chk-1', label: 'Start HAPI FHIR R4 server on port 8081 and seed synthetic patients', done: true },
        { id: 'chk-2', label: 'Start Inferno Test Kit container on port 4567', done: false },
        { id: 'chk-3', label: 'Configure FHIR Base URL (use host.docker.internal:8081/fhir from Docker)', done: false },
        { id: 'chk-4', label: 'Run US Core & eCR test groups and export JSON/CSV results', done: false },
        { id: 'chk-5', label: 'Import result file below and triage any failed assertions', done: false },
      ],
    },
    runs: [
      {
        id: 'run-baseline-seed',
        importedAt: '2026-02-15T14:00:00.000Z',
        suiteName: 'US Core v6.1.0 Baseline',
        igVersion: '6.1.0',
        sourceFormat: 'Sample',
        passCount: 14,
        failCount: 3,
        skipCount: 2,
        omitCount: 1,
        passRatePct: 82,
        tests: [],
      },
    ],
    triageItems: [],
    builtInChecks: [],
  };
  storeByTenant.set(tenantId, initial);
  return initial;
}

function normalizeOutcome(raw: unknown): InfernoTestOutcome {
  const val = String(raw ?? '').trim().toLowerCase();
  if (val === 'pass' || val === 'passed') return 'pass';
  if (val === 'fail' || val === 'failed' || val === 'error') return 'fail';
  if (val === 'omit' || val === 'omitted') return 'omit';
  return 'skip';
}

export const conformanceService = {
  getState(tenantId: string): ConformanceTenantState {
    return getOrInitState(tenantId);
  },

  resetForTests(): void {
    storeByTenant.clear();
  },

  updateConfig(
    tenantId: string,
    patch: Partial<Omit<InfernoConfig, 'manualChecklist'>>,
  ): InfernoConfig {
    const state = getOrInitState(tenantId);
    Object.assign(state.config, patch);
    return state.config;
  },

  toggleChecklistItem(tenantId: string, itemId: string): InfernoConfig {
    const state = getOrInitState(tenantId);
    const item = state.config.manualChecklist.find((c) => c.id === itemId);
    if (item) item.done = !item.done;
    return state.config;
  },

  importInfernoResults(
    tenantId: string,
    rawContent: string,
    format: 'JSON' | 'CSV' | 'Sample',
    defaultOwner = 'Integration Engineer',
  ): { run: InfernoRunRecord; createdTriageCount: number } {
    const state = getOrInitState(tenantId);
    const trimmed = rawContent.trim();
    if (!trimmed) {
      throw new AppError({
        message: 'Import content is empty. Provide valid Inferno JSON or CSV results.',
        statusCode: 400,
        code: 'EMPTY_IMPORT',
      });
    }

    let suiteName = state.config.testSuite;
    let igVersion = state.config.igVersion;
    const tests: InfernoTestCaseResult[] = [];

    if (format === 'CSV') {
      const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        throw new AppError({
          message: 'CSV must contain a header row and at least one test result row.',
          statusCode: 400,
          code: 'INVALID_CSV',
        });
      }
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const idIdx = headers.findIndex((h) => h.includes('id'));
      const titleIdx = headers.findIndex((h) => h.includes('title') || h.includes('name'));
      const groupIdx = headers.findIndex((h) => h.includes('group'));
      const resultIdx = headers.findIndex((h) => h.includes('result') || h.includes('status'));
      const msgIdx = headers.findIndex((h) => h.includes('message') || h.includes('detail'));

      if (resultIdx === -1) {
        throw new AppError({
          message: 'CSV header must include a "result" or "status" column.',
          statusCode: 400,
          code: 'INVALID_CSV_HEADER',
        });
      }

      for (let i = 1; i < lines.length; i += 1) {
        const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        tests.push({
          testId: cols[idIdx >= 0 ? idIdx : 0] || `csv-test-${i}`,
          title: cols[titleIdx >= 0 ? titleIdx : 1] || `Test ${i}`,
          group: groupIdx >= 0 ? cols[groupIdx] || 'General' : 'General',
          result: normalizeOutcome(cols[resultIdx]),
          message: msgIdx >= 0 ? cols[msgIdx] : undefined,
        });
      }
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new AppError({
          message: 'Invalid JSON syntax in Inferno results file.',
          statusCode: 400,
          code: 'INVALID_JSON',
        });
      }

      let rawList: Array<Record<string, unknown>> = [];
      if (Array.isArray(parsed)) {
        rawList = parsed as Array<Record<string, unknown>>;
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (typeof obj.suiteName === 'string') suiteName = obj.suiteName;
        if (typeof obj.igVersion === 'string') igVersion = obj.igVersion;
        if (Array.isArray(obj.results)) {
          rawList = obj.results as Array<Record<string, unknown>>;
        } else if (Array.isArray(obj.tests)) {
          rawList = obj.tests as Array<Record<string, unknown>>;
        }
      }

      if (rawList.length === 0) {
        throw new AppError({
          message: 'JSON did not contain a non-empty array of test results.',
          statusCode: 400,
          code: 'NO_TEST_RESULTS',
        });
      }

      rawList.forEach((item, idx) => {
        tests.push({
          testId: String(item.test_id ?? item.id ?? `test-${idx + 1}`),
          title: String(item.title ?? item.name ?? item.test_id ?? `Test ${idx + 1}`),
          group: String(item.group ?? item.test_group_id ?? 'General'),
          result: normalizeOutcome(item.result ?? item.status),
          message: item.message ? String(item.message) : undefined,
        });
      });
    }

    const passCount = tests.filter((t) => t.result === 'pass').length;
    const failCount = tests.filter((t) => t.result === 'fail').length;
    const skipCount = tests.filter((t) => t.result === 'skip').length;
    const omitCount = tests.filter((t) => t.result === 'omit').length;
    const evaluated = passCount + failCount;
    const passRatePct = evaluated > 0 ? Math.round((passCount / evaluated) * 100) : 100;

    const now = new Date().toISOString();
    const run: InfernoRunRecord = {
      id: nextConfId('inf-run'),
      importedAt: now,
      suiteName,
      igVersion,
      sourceFormat: format,
      passCount,
      failCount,
      skipCount,
      omitCount,
      passRatePct,
      tests,
    };
    state.runs.push(run);

    let createdTriageCount = 0;
    for (const t of tests) {
      if (t.result !== 'fail') continue;
      state.triageItems.unshift({
        id: nextConfId('triage'),
        runId: run.id,
        testId: t.testId,
        title: t.title,
        errorMessage: t.message ?? 'Assertion failed without message.',
        causeCategory: classifyFailureCause(t.message ?? '', t.title),
        owner: defaultOwner,
        status: 'Open',
        notes: '',
        createdAt: now,
      });
      createdTriageCount += 1;
    }

    return { run, createdTriageCount };
  },

  updateTriageItem(
    tenantId: string,
    triageId: string,
    patch: Partial<Pick<FailureTriageItem, 'causeCategory' | 'owner' | 'status' | 'notes'>>,
  ): FailureTriageItem {
    const state = getOrInitState(tenantId);
    const item = state.triageItems.find((t) => t.id === triageId);
    if (!item) {
      throw new AppError({ message: 'Triage item not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    Object.assign(item, patch);
    return item;
  },

  async runBuiltInChecks(
    ctx: FhirRequestContext,
  ): Promise<BuiltInConformanceCheck[]> {
    const state = getOrInitState(ctx.tenantId);
    const client = getFhirClient();
    const checkedAt = new Date().toISOString();
    const checks: BuiltInConformanceCheck[] = [];

    // 1. fhirVersion 4.0.1
    try {
      const cap = await client.capabilities(ctx);
      const isR4 = cap.fhirVersion === '4.0.1';
      checks.push({
        id: 'chk-fhir-version',
        name: 'FHIR Version 4.0.1 Declared',
        status: isR4 ? 'Pass' : 'Fail',
        detail: `CapabilityStatement reports fhirVersion=${cap.fhirVersion ?? 'missing'} (${cap.software?.name ?? 'FHIR Server'}).`,
        checkedAt,
      });

      // 2. CapabilityStatement lists needed resources & interactions
      const requiredTypes = ['Patient', 'Practitioner', 'Organization', 'PractitionerRole', 'Encounter', 'Condition', 'Observation'];
      const advertised = cap.rest?.[0]?.resource ?? [];
      const advertisedNames = new Set(advertised.map((r) => r.type));
      const missingTypes = requiredTypes.filter((t) => !advertisedNames.has(t));
      const hasInteractions = advertised.some(
        (r) =>
          (r.interaction ?? []).some((i) => i.code === 'read') &&
          (r.interaction ?? []).some((i) => i.code === 'search-type'),
      );
      checks.push({
        id: 'chk-cap-resources',
        name: 'CapabilityStatement Required Resources & Interactions',
        status: missingTypes.length === 0 && hasInteractions ? 'Pass' : 'Fail',
        detail:
          missingTypes.length === 0
            ? `All ${requiredTypes.length} core resources and read/search-type interactions advertised.`
            : `Missing resource declarations: ${missingTypes.join(', ')}.`,
        checkedAt,
      });
    } catch (err) {
      checks.push(
        {
          id: 'chk-fhir-version',
          name: 'FHIR Version 4.0.1 Declared',
          status: 'Fail',
          detail: `Unable to read CapabilityStatement: ${err instanceof Error ? err.message : 'unknown error'}`,
          checkedAt,
        },
        {
          id: 'chk-cap-resources',
          name: 'CapabilityStatement Required Resources & Interactions',
          status: 'Fail',
          detail: 'Skipped due to CapabilityStatement failure.',
          checkedAt,
        },
      );
    }

    // 3. Required search parameters work
    try {
      const [patRes, pracRes, obsRes] = await Promise.all([
        client.search<FhirPatient>(ctx, 'Patient', { _count: 5 }),
        client.search<FhirPractitioner>(ctx, 'Practitioner', { active: true, _count: 5 }),
        client.search<FhirObservation>(ctx, 'Observation', { _count: 5 }),
      ]);
      checks.push({
        id: 'chk-search-params',
        name: 'Required Search Parameters Operational',
        status: 'Pass',
        detail: `Verified Patient (${patRes.total}), active Practitioner (${pracRes.total}), Observation (${obsRes.total}).`,
        checkedAt,
      });
    } catch (err) {
      checks.push({
        id: 'chk-search-params',
        name: 'Required Search Parameters Operational',
        status: 'Fail',
        detail: `Search execution failed: ${err instanceof Error ? err.message : 'error'}`,
        checkedAt,
      });
    }

    // 4. $validate operation works
    try {
      const samplePat: FhirPatient = {
        resourceType: 'Patient',
        active: true,
        name: [{ family: 'Probe', given: ['Conformance'] }],
        gender: 'unknown',
      };
      const outcome = await client.operation<FhirOperationOutcome>(ctx, '$validate', {
        resourceType: 'Patient',
        resource: samplePat,
      });
      const isOpOutcome = outcome.resourceType === 'OperationOutcome';
      checks.push({
        id: 'chk-validate-op',
        name: '$validate Operation Returns OperationOutcome',
        status: isOpOutcome ? 'Pass' : 'Fail',
        detail: isOpOutcome
          ? `$validate responded with ${outcome.issue?.length ?? 0} issue(s).`
          : 'Unexpected response resourceType from $validate.',
        checkedAt,
      });
    } catch (err) {
      checks.push({
        id: 'chk-validate-op',
        name: '$validate Operation Returns OperationOutcome',
        status: 'Fail',
        detail: `$validate failed: ${err instanceof Error ? err.message : 'error'}`,
        checkedAt,
      });
    }

    // 5. meta.profile presence audit
    try {
      const [pats, pracs] = await Promise.all([
        client.search<FhirPatient>(ctx, 'Patient', { _count: 50 }),
        client.search<FhirPractitioner>(ctx, 'Practitioner', { _count: 50 }),
      ]);
      const allCore = [...pats.resources, ...pracs.resources];
      const withProfile = allCore.filter((r) => (r.meta?.profile?.length ?? 0) > 0).length;
      checks.push({
        id: 'chk-meta-profile',
        name: 'meta.profile Claim Presence Audit',
        status:
          allCore.length === 0
            ? 'Warn'
            : withProfile === allCore.length
              ? 'Pass'
              : 'Warn',
        detail: `${withProfile} of ${allCore.length} Patient/Practitioner resources declare meta.profile URLs.`,
        checkedAt,
      });
    } catch (err) {
      checks.push({
        id: 'chk-meta-profile',
        name: 'meta.profile Claim Presence Audit',
        status: 'Fail',
        detail: err instanceof Error ? err.message : 'Audit failed',
        checkedAt,
      });
    }

    // 6. Reference integrity check
    try {
      const [pats, pracs, encs, conds, roles] = await Promise.all([
        client.search<FhirPatient>(ctx, 'Patient', { _count: 200 }),
        client.search<FhirPractitioner>(ctx, 'Practitioner', { _count: 200 }),
        client.search<FhirEncounter>(ctx, 'Encounter', { _count: 200 }),
        client.search<FhirCondition>(ctx, 'Condition', { _count: 200 }),
        client.search<FhirPractitionerRole>(ctx, 'PractitionerRole', { _count: 200 }),
      ]);
      const patIds = new Set(pats.resources.map((p) => `Patient/${p.id}`));
      const pracIds = new Set(pracs.resources.map((p) => `Practitioner/${p.id}`));
      const brokenRefs: string[] = [];

      encs.resources.forEach((e) => {
        const ref = e.subject?.reference;
        if (ref && ref.startsWith('Patient/') && !patIds.has(ref)) brokenRefs.push(`Encounter/${e.id} -> ${ref}`);
      });
      conds.resources.forEach((c) => {
        const ref = c.subject?.reference;
        if (ref && ref.startsWith('Patient/') && !patIds.has(ref)) brokenRefs.push(`Condition/${c.id} -> ${ref}`);
      });
      roles.resources.forEach((r) => {
        const ref = r.practitioner?.reference;
        if (ref && ref.startsWith('Practitioner/') && !pracIds.has(ref)) {
          brokenRefs.push(`PractitionerRole/${r.id} -> ${ref}`);
        }
      });

      checks.push({
        id: 'chk-ref-integrity',
        name: 'Cross-Resource Reference Integrity',
        status: brokenRefs.length === 0 ? 'Pass' : 'Fail',
        detail:
          brokenRefs.length === 0
            ? `Verified ${encs.resources.length + conds.resources.length + roles.resources.length} references with 0 dangling pointers.`
            : `${brokenRefs.length} unresolved reference(s): ${brokenRefs.slice(0, 3).join(', ')}`,
        checkedAt,
      });
    } catch (err) {
      checks.push({
        id: 'chk-ref-integrity',
        name: 'Cross-Resource Reference Integrity',
        status: 'Fail',
        detail: err instanceof Error ? err.message : 'Reference check failed',
        checkedAt,
      });
    }

    state.builtInChecks = checks;
    state.lastBuiltInRunAt = checkedAt;
    return checks;
  },

  generateConformanceReportMarkdown(tenantId: string): string {
    const state = getOrInitState(tenantId);
    const latestRun = state.runs[state.runs.length - 1];
    const lines = [
      `# FHIR Conformance & Inferno Report`,
      `- Generated: ${new Date().toISOString()}`,
      `- Target FHIR Base: ${state.config.targetFhirBase}`,
      `- Inferno Suite: ${state.config.testSuite} (IG ${state.config.igVersion})`,
      ``,
      `## Built-In FHIR R4 Conformance Probes`,
      ...(state.builtInChecks.length > 0
        ? state.builtInChecks.map((c) => `- **[${c.status}]** ${c.name}: ${c.detail}`)
        : ['- Not yet executed.']),
      ``,
      `## Latest Inferno Run`,
      latestRun
        ? `- Run ${latestRun.id} (${latestRun.suiteName}): **${latestRun.passRatePct}% pass rate** (${latestRun.passCount} pass, ${latestRun.failCount} fail, ${latestRun.skipCount} skip, ${latestRun.omitCount} omit)`
        : '- No Inferno runs imported yet.',
      ``,
      `## Open Triage Items (${state.triageItems.filter((t) => t.status !== 'Resolved').length})`,
      ...(state.triageItems.length > 0
        ? state.triageItems.map(
            (t) => `- [${t.status}] **${t.testId}** (${t.causeCategory}, Owner: ${t.owner}): ${t.errorMessage}`,
          )
        : ['- None.']),
    ];
    return lines.join('\n');
  },
};
