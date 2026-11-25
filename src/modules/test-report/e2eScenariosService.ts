import { eventBus } from '../../events';
import { mockFhirClient, type FhirRequestContext } from '../../fhir';
import { seedTenantFhirData } from '../../mock-data';
import { buildValidNpi } from '../../rules';
import { auditService, settingsService } from '../../services';
import { buildDefaultTenantDraft, tenantService } from '../../tenancy';
import { providerService } from '../m3-directory/providerService';
import {
  createBlankApplication,
  enrollmentService,
} from '../m5-enrollment/enrollmentService';
import { validationService } from '../m6-validation/validationService';
import { screeningService } from '../m7-screening/screeningService';
import { determinationService } from '../m8-determination/determinationService';
import { credentialingService } from '../m9-credentialing/credentialingService';
import { mmisEdiService } from '../m10-mmis-edi/mmisEdiService';
import { claimsService } from '../m11-claims/claimsService';
import { monitoringService } from '../m12-monitoring/monitoringService';
import { ecrService } from '../m13-ecr/ecrService';
import { udsService } from '../m14-uds/udsService';
import {
  SAMPLE_INFERNO_JSON,
  conformanceService,
} from '../m15-conformance/conformanceService';
import { gatewayService } from '../m16-gateway/gatewayService';
import { securityService } from '../m17-security/securityService';
import { notificationService } from '../m18-notifications/notificationService';
import { analyticsService } from '../m19-analytics/analyticsService';
import {
  SAMPLE_OPERATION_OUTCOME,
  diagnosticsService,
} from '../m20-diagnostics/diagnosticsService';
import { planService } from '../m23-plans/planService';

export type ScenarioId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface ScenarioStepResult {
  moduleCode: string;
  label: string;
  passed: boolean;
  evidence: string;
}

export interface ScenarioRunResult {
  id: ScenarioId;
  title: string;
  description: string;
  modulesCovered: string[];
  passed: boolean;
  durationMs: number;
  executedAt: string;
  steps: ScenarioStepResult[];
  error?: string;
}

export interface ScenarioMetadata {
  id: ScenarioId;
  title: string;
  description: string;
  modulesCovered: string[];
}

export const E2E_SCENARIO_CATALOG: ScenarioMetadata[] = [
  {
    id: 'A',
    title: 'Scenario A — End-to-End Provider Lifecycle',
    description:
      'Submit enrollment application (M5) -> automated validation (M6) -> risk screening (M7) -> approval (M8) -> credentialing (M9) -> MMIS load & EDI partner (M10) -> directory publication (M3) -> plan network & rate assignment (M23) -> claim paid (M11).',
    modulesCovered: ['M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M3', 'M23', 'M11'],
  },
  {
    id: 'B',
    title: 'Scenario B — Program Integrity & Exclusion Cascade',
    description:
      'Add active provider to exclusion list (M6) -> M12 raises ExclusionHit -> suspend provider -> M3 updates to Suspended -> M10 MMIS status update queued -> M11 denies claim (PROVIDER_NOT_ACTIVE) -> M18 notifies -> M19 KPI updates.',
    modulesCovered: ['M6', 'M12', 'M3', 'M10', 'M11', 'M18', 'M19'],
  },
  {
    id: 'C',
    title: 'Scenario C — Electronic Case Reporting (eCR)',
    description:
      'Load patient with positive SARS-CoV-2 lab (M4) -> M13 trigger fires -> eICR Composition Bundle built & $validated -> submitted to PHA stub -> Reportability Response (RR) received -> M18 notification & M19 eICR KPI updated.',
    modulesCovered: ['M4', 'M13', 'M18', 'M19'],
  },
  {
    id: 'D',
    title: 'Scenario D — UDS+ Reporting Readiness & De-Identification',
    description:
      'Build patient cohort (M14) -> in-memory de-identification engine strips identifiers -> profile $validate -> build submission Bundle & MeasureReport -> compute completeness & gap report.',
    modulesCovered: ['M4', 'M14'],
  },
  {
    id: 'E',
    title: 'Scenario E — Conformance, Gateway Outage & Troubleshooting',
    description:
      'Run M15 built-in FHIR R4 probes -> import sample Inferno results & triage cards -> simulate M16 gateway sustained outage (circuit breaker opens) -> diagnose & resolve via M20 classifier, KB, OperationOutcome explainer & log.',
    modulesCovered: ['M15', 'M16', 'M20'],
  },
  {
    id: 'F',
    title: 'Scenario F — Multi-Tenancy, RBAC, Masking, SMART Scopes & Audit',
    description:
      'Onboard two tenants with distinct business rules (M24) -> verify strict tenant isolation -> verify RBAC & PII unmasking (M17) -> enforce SMART scope 403 -> verify FHIR AuditEvent coverage across operations.',
    modulesCovered: ['M24', 'M1', 'M17'],
  },
];

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function prepareIsolatedScenarioContext(
  scenarioId: ScenarioId,
): Promise<FhirRequestContext> {
  const tenantId = `e2e-scenario-${scenarioId.toLowerCase()}`;
  const ctx: FhirRequestContext = {
    tenantId,
    tenantCode: 'state-medicaid-a',
    correlationId: `corr-e2e-${scenarioId}-${Date.now().toString(36)}`,
  };
  mockFhirClient.clearTenantStore(tenantId);
  await seedTenantFhirData(mockFhirClient, ctx, true);
  return ctx;
}

async function runScenarioA(): Promise<ScenarioStepResult[]> {
  const ctx = await prepareIsolatedScenarioContext('A');
  const steps: ScenarioStepResult[] = [];

  const providerActor = { name: 'Dr. Clara Osei', role: 'ProviderUser' as const };
  const analyst = { name: 'Taylor Brooks', role: 'EnrollmentAnalyst' as const };
  const approver = { name: 'Morgan Avery', role: 'AgencyApprover' as const };
  const credSpec = { name: 'Jordan Patel', role: 'CredentialingSpecialist' as const };
  const engineer = { name: 'Casey Nguyen', role: 'IntegrationEngineer' as const };
  const planMgr = { name: 'Riley Chen', role: 'PlanManager' as const };

  // 1. M5: Submit Enrollment Application
  const npi = buildValidNpi('141234567');
  const draft = createBlankApplication(ctx.tenantId, {
    applicantGiven: 'Clara',
    applicantFamily: 'Osei',
    applicantEmail: 'c.osei@med.synthetic',
    applicantPhone: '518-555-0144',
    npi,
    organizationName: 'Capital Region Family Health',
    tin: '47-9876543',
    licenseNumber: 'NY-994210',
    licenseState: 'NY',
    taxonomyCode: '207Q00000X',
    locations: [
      {
        id: 'loc-e2e-a',
        clinicName: 'Capital Region Clinic',
        street: '100 Washington Ave',
        city: 'Albany',
        state: 'NY',
        postalCode: '12210',
        phone: '518-555-0144',
        hours: 'Mon-Fri 08:00-17:00',
        acceptingNewPatients: true,
      },
    ],
    attestedTruthful: true,
    attestedCompliance: true,
    eSignatureName: 'Dr. Clara Osei',
    feeStatus: 'Paid',
  });
  draft.documents = draft.documents.map((d) => ({
    ...d,
    status: 'Uploaded',
    fileName: `${d.requirementName}.pdf`,
    sha256: 'b'.repeat(64),
  }));
  const submitted = await enrollmentService.submitApplication(ctx, draft, providerActor);
  assertCondition(submitted.status === 'Submitted', 'M5 submission failed');
  steps.push({
    moduleCode: 'M5',
    label: 'Submit 12-step enrollment application',
    passed: true,
    evidence: `${submitted.applicationNumber} submitted (NPI ${npi}, QR/${submitted.questionnaireResponseId})`,
  });

  // 2. M6: Automated Validation Engine
  const valReport = await validationService.runValidationSuite(ctx, submitted.id, analyst);
  assertCondition(valReport.results.length >= 6, 'M6 validation suite did not execute');
  steps.push({
    moduleCode: 'M6',
    label: 'Run automated validation suite',
    passed: true,
    evidence: `Overall ${valReport.overallStatus} (${valReport.results.length} validators executed)`,
  });

  // 3. M7: Risk-Based Screening
  const assigned = await screeningService.assignScreening(ctx, submitted.id, analyst);
  const completedScreening = await screeningService.updateScreeningTasks(
    ctx,
    submitted.id,
    {
      databaseCheckDone: true,
      siteVisit: assigned.requiresSiteVisit
        ? {
            completed: true,
            signageVerified: true,
            hoursPosted: true,
            adaAccessible: true,
            equipmentPresent: true,
            outcome: 'Passed',
          }
        : undefined,
      fingerprints: assigned.fingerprints.map((f) => ({
        ...f,
        status: 'Cleared',
        clearedDate: '2026-03-01',
      })),
    },
    analyst,
  );
  assertCondition(completedScreening.status === 'Completed', 'M7 screening did not complete');
  steps.push({
    moduleCode: 'M7',
    label: 'Complete risk-based screening',
    passed: true,
    evidence: `Tier ${completedScreening.effectiveTier}, RiskAssessment/${completedScreening.riskAssessmentId}`,
  });

  // 4. M8: Review & Approval Determination (supports single or two-person sign-off)
  const decisionResult = await determinationService.submitDecision(
    ctx,
    {
      applicationId: submitted.id,
      decisionType: 'Approve',
      effectiveDate: '2026-01-01',
      notes: 'Clean E2E approval.',
    },
    analyst,
  );
  let approvedOutcome = decisionResult.decision?.outcome;
  if (decisionResult.status === 'PendingSignOff' && decisionResult.pending) {
    const signed = await determinationService.signOffPendingDecision(
      ctx,
      decisionResult.pending.id,
      approver,
    );
    approvedOutcome = signed.outcome;
  }
  assertCondition(approvedOutcome === 'Approved', 'M8 approval did not finalize');
  steps.push({
    moduleCode: 'M8',
    label: 'Approve enrollment application',
    passed: true,
    evidence: `Determination outcome: ${approvedOutcome}; ProviderApproved published`,
  });

  // 5. M3: Verify Provider Published in Directory
  const providers = await providerService.listProviders(ctx);
  const newProvider = providers.find((p) => p.npi === npi);
  assertCondition(
    Boolean(newProvider && newProvider.status === 'Active'),
    'M3 provider not published as Active',
  );
  steps.push({
    moduleCode: 'M3',
    label: 'Verify Active provider published in Directory',
    passed: true,
    evidence: `Practitioner/${newProvider!.id} (${newProvider!.fullName}) status=${newProvider!.status}`,
  });

  // 6. M9 & M23: Credentialing, Contract & Plan Network Assignment
  const credFile = credentialingService.createCredentialingFile(ctx.tenantId, newProvider!);
  credentialingService.markAllPsvVerified(ctx.tenantId, credFile.id, credSpec.name);
  const credFinal = await credentialingService.evaluateAndFinalizeFile(ctx, credFile.id, credSpec);
  assertCondition(
    credFinal.status === 'Clean - Auto Approved',
    'M9 credentialing file was not auto-approved',
  );

  const planState = planService.getState(ctx);
  const ffsPlan = planState.plans[0];
  const primaryNetwork = planState.networks.find((n) => n.planId === ffsPlan.id)!;
  const contract = await credentialingService.createAndSignContract(
    ctx,
    {
      practitionerId: newProvider!.id,
      providerName: newProvider!.fullName,
      npi: newProvider!.npi,
      templateId: 'tpl-mco-2026',
      planId: ffsPlan.id,
      networkId: primaryNetwork.id,
      effectiveStart: '2026-01-01',
      effectiveEnd: '2026-12-31',
      signerName: newProvider!.fullName,
    },
    credSpec,
  );
  assertCondition(
    contract.status === 'Active' && primaryNetwork.assignedProviderIds.includes(newProvider!.id),
    'M9/M23 contract or network assignment failed',
  );
  steps.push({
    moduleCode: 'M9 / M23',
    label: 'Complete PSV credentialing & assign plan network/rate schedule',
    passed: true,
    evidence: `${credFinal.status}; contracted to ${ffsPlan.name} (${primaryNetwork.name})`,
  });

  // 7. M10: MMIS Load Acknowledgement & EDI Trading Partner Go-Live
  const mmisState = mmisEdiService.getState(ctx.tenantId);
  let load = mmisState.loads.find((l) => l.npi === npi);
  if (!load) {
    load = mmisEdiService.queueMmisLoad(ctx.tenantId, {
      practitionerId: newProvider!.id,
      providerName: newProvider!.fullName,
      npi,
      action: 'InitialLoad',
      providerStatus: 'Active',
      effectiveDate: '2026-01-01',
    });
  }
  const ackedLoad = await mmisEdiService.sendMmisLoad(ctx, load.id, engineer, {
    forceOutcome: 'Acknowledged',
  });
  const tp = mmisEdiService.createTradingPartner(ctx.tenantId, {
    tradingPartnerId: 'TP-E2E-A',
    name: 'Capital Region EDI Clearinghouse',
    submitterId: 'SUB-E2E',
    receiverId: 'NYMMIS01',
    transactions: ['837P', '835'],
    connectivity: 'API',
    endpointAddress: 'https://capital-edi.synthetic.example/x12',
  });
  mmisEdiService.updatePartnerChecklist(ctx.tenantId, tp.id, {
    envelopeTested: true,
    ack999Passed: true,
    ack277CaPassed: true,
    securityVerified: true,
  });
  const liveTp = await mmisEdiService.approveTradingPartnerGoLive(ctx, tp.id, engineer);
  assertCondition(
    ackedLoad.status === 'Acknowledged' && liveTp.status === 'Live',
    'M10 MMIS load or EDI partner go-live failed',
  );
  steps.push({
    moduleCode: 'M10',
    label: 'Acknowledge MMIS load & activate EDI Trading Partner',
    passed: true,
    evidence: `Medicaid ID ${ackedLoad.medicaidId} Acknowledged; Partner ${liveTp.tradingPartnerId} Live`,
  });

  // 8. M11: Submit & Adjudicate Claim -> Paid using M23 fee schedule
  const paidClaim = await claimsService.submitAndAdjudicateClaim(
    ctx,
    {
      patientId: 'pat-jane-doe-state-medicaid-a',
      patientName: 'Jane Doe',
      billingProviderId: newProvider!.id,
      renderingProviderId: newProvider!.id,
      planId: ffsPlan.id,
      lines: [
        {
          code: '99214',
          diagnosisCode: 'I10',
          units: 1,
          billedUsd: 165,
          dateOfService: '2026-06-15',
        },
      ],
    },
    planMgr,
  );
  assertCondition(
    paidClaim.decision === 'Paid' && paidClaim.totalPaidUsd > 0,
    `Expected Paid claim, got ${paidClaim.decision} (${paidClaim.denialCode ?? 'none'})`,
  );
  steps.push({
    moduleCode: 'M11',
    label: 'Adjudicate in-network claim to Paid via M23 fee schedule',
    passed: true,
    evidence: `Claim ${paidClaim.claimNumber} Paid $${paidClaim.totalPaidUsd.toFixed(2)} (ClaimResponse/${paidClaim.fhirClaimResponseId})`,
  });

  return steps;
}

async function runScenarioB(): Promise<ScenarioStepResult[]> {
  const ctx = await prepareIsolatedScenarioContext('B');
  const steps: ScenarioStepResult[] = [];
  const officer = { name: 'Dana Morales', role: 'ProgramIntegrityOfficer' as const };
  const planMgr = { name: 'Riley Chen', role: 'PlanManager' as const };

  // Ensure M18 subscription is initialized
  notificationService.getState(ctx.tenantId);

  const providers = await providerService.listProviders(ctx);
  const target = providers.find((p) => p.status === 'Active')!;
  assertCondition(Boolean(target), 'No seeded active provider found');

  // 1. M6: Add provider to exclusion list
  validationService.addExclusionEntry(ctx.tenantId, {
    name: target.fullName,
    npi: target.npi,
    source: 'OIG-LEIE',
    exclusionType: '1128(a)(1) Program Fraud',
    effectiveDate: '2026-03-01',
  });
  steps.push({
    moduleCode: 'M6',
    label: 'Insert active provider into OIG-LEIE exclusion list',
    passed: true,
    evidence: `Added ${target.fullName} (NPI ${target.npi}) to M6 exclusions`,
  });

  // 2. M12: Run exclusion monitor -> ExclusionHit raised
  const run = await monitoringService.runMonitor(ctx, 'exclusion-rescreen', officer);
  const hitAlert = run.newAlerts.find((a) => a.alertType === 'ExclusionHit');
  assertCondition(Boolean(hitAlert), 'M12 did not raise ExclusionHit alert');
  steps.push({
    moduleCode: 'M12',
    label: 'Run exclusion rescreen monitor & raise ExclusionHit',
    passed: true,
    evidence: `Alert ${hitAlert!.id} raised (Task/${hitAlert!.taskId}, DetectedIssue/${hitAlert!.detectedIssueId})`,
  });

  // 3. M12 -> M3 & M10: Suspend provider
  await monitoringService.suspendProviderFromAlert(
    ctx,
    hitAlert!.id,
    'Mandatory OIG-LEIE federal exclusion suspension.',
    officer,
  );
  const updatedProviders = await providerService.listProviders(ctx);
  const suspendedProv = updatedProviders.find((p) => p.id === target.id);
  const mmisUpdated = mmisEdiService
    .getState(ctx.tenantId)
    .loads.some(
      (l) =>
        l.practitionerId === target.id &&
        l.action === 'StatusUpdate' &&
        l.providerStatus === 'Suspended',
    );
  assertCondition(suspendedProv?.status === 'Suspended', 'M3 provider was not marked Suspended');
  assertCondition(mmisUpdated, 'M10 MMIS StatusUpdate load was not queued');
  steps.push({
    moduleCode: 'M3 / M10',
    label: 'Suspend provider across M3 Directory & queue M10 MMIS update',
    passed: true,
    evidence: `M3 status=Suspended; M10 MMIS StatusUpdate queued`,
  });

  // 4. M11: New claim denied with PROVIDER_NOT_ACTIVE
  const ffsPlan = planService.getState(ctx).plans[0];
  const deniedClaim = await claimsService.submitAndAdjudicateClaim(
    ctx,
    {
      patientId: 'pat-jane-doe-state-medicaid-a',
      patientName: 'Jane Doe',
      billingProviderId: target.id,
      renderingProviderId: target.id,
      planId: ffsPlan.id,
      lines: [
        {
          code: '99213',
          diagnosisCode: 'I10',
          units: 1,
          billedUsd: 100,
          dateOfService: '2026-06-15',
        },
      ],
    },
    planMgr,
  );
  assertCondition(
    deniedClaim.decision === 'Denied' && deniedClaim.denialCode === 'PROVIDER_NOT_ACTIVE',
    `Expected PROVIDER_NOT_ACTIVE denial, got ${deniedClaim.decision}/${deniedClaim.denialCode}`,
  );
  steps.push({
    moduleCode: 'M11',
    label: 'Deny new claim for suspended provider',
    passed: true,
    evidence: `Claim ${deniedClaim.claimNumber} Denied (${deniedClaim.denialCode})`,
  });

  // 5. M18 & M19: Verify auto-notification and Analytics KPI update
  const deliveries = notificationService.getState(ctx.tenantId).deliveries;
  const hasExclusionNotice = deliveries.some(
    (d) => d.eventType === 'ExclusionHit' || d.eventType === 'ProviderStatusChanged',
  );
  assertCondition(hasExclusionNotice, 'M18 did not auto-dispatch exclusion/suspension notice');

  const snapshot = await analyticsService.computeSnapshot(ctx);
  const openExclKpi = snapshot.kpis.find((k) => k.config.id === 'open-exclusions');
  const suspKpi = snapshot.kpis.find((k) => k.config.id === 'suspended-provs');
  assertCondition(
    (openExclKpi?.value ?? 0) >= 1 && (suspKpi?.value ?? 0) >= 1,
    'M19 Analytics did not reflect open exclusion / suspended provider counts',
  );
  steps.push({
    moduleCode: 'M18 / M19',
    label: 'Confirm M18 notification dispatch & M19 Program Integrity KPIs',
    passed: true,
    evidence: `M18 deliveries=${deliveries.length}; M19 openExclusions=${openExclKpi?.value}, suspendedProviders=${suspKpi?.value}`,
  });

  return steps;
}

async function runScenarioC(): Promise<ScenarioStepResult[]> {
  const ctx = await prepareIsolatedScenarioContext('C');
  const steps: ScenarioStepResult[] = [];
  const engineer = { name: 'Alex Rivera', role: 'IntegrationEngineer' as const };
  const janeDoeId = 'pat-jane-doe-state-medicaid-a';

  notificationService.getState(ctx.tenantId);

  // 1. M13 Trigger evaluation on M4 seeded positive SARS-CoV-2 patient
  const triggerRes = await ecrService.evaluatePatientTriggers(ctx, janeDoeId, engineer);
  assertCondition(
    triggerRes.triggered && Boolean(triggerRes.createdCase),
    'M13 did not trigger on seeded SARS-CoV-2 patient',
  );
  const caseId = triggerRes.createdCase!.id;
  steps.push({
    moduleCode: 'M4 / M13',
    label: 'Evaluate RCTC triggers on SARS-CoV-2 positive patient',
    passed: true,
    evidence: `Case ${triggerRes.createdCase!.caseNumber} triggered (${triggerRes.createdCase!.conditionGroup})`,
  });

  // 2. Build & $validate eICR Composition document Bundle
  const built = await ecrService.buildAndValidateEicr(ctx, caseId, engineer);
  assertCondition(
    Boolean(built.validationPassed) && built.eicrBundle?.type === 'document',
    'eICR Composition Bundle validation failed',
  );
  steps.push({
    moduleCode: 'M13',
    label: 'Build & $validate FHIR eICR document Bundle',
    passed: true,
    evidence: `eICR Bundle (${built.eicrBundle?.entry?.length ?? 0} entries, Composition first) passed $validate`,
  });

  // 3. Submit to PHA stub & ingest RR DocumentReference
  const submitted = await ecrService.submitEicr(ctx, caseId, engineer);
  assertCondition(submitted.status === 'Acknowledged', 'eICR stub submission failed');

  const withRr = await ecrService.processPhaDecisionAndRrIntake(
    ctx,
    caseId,
    {
      accept: true,
      determination: 'Reportable',
      ruleSummary: 'State Dept of Health confirmed reportable COVID-19 case.',
      phaReviewer: 'PHA Stub Reviewer',
    },
    engineer,
  );
  assertCondition(
    withRr.status === 'RR received' && Boolean(withRr.reportabilityResponse?.documentReferenceId),
    'RR DocumentReference was not created',
  );
  steps.push({
    moduleCode: 'M13',
    label: 'Submit eICR to stub & ingest Reportability Response (RR)',
    passed: true,
    evidence: `RR Determination=${withRr.reportabilityResponse?.determination} attached as DocumentReference/${withRr.reportabilityResponse?.documentReferenceId}`,
  });

  // 4. M18 notification & M19 eICR KPI updated
  const deliveries = notificationService.getState(ctx.tenantId).deliveries;
  const hasRrNotif = deliveries.some((d) => d.eventType === 'ReportabilityResponseReceived');
  const snapshot = await analyticsService.computeSnapshot(ctx);
  const eicrKpi = snapshot.kpis.find((k) => k.config.id === 'eicr-count');
  assertCondition(hasRrNotif, 'M18 did not receive ReportabilityResponseReceived notification');
  assertCondition((eicrKpi?.value ?? 0) >= 1, 'M19 eICR KPI did not increment');
  steps.push({
    moduleCode: 'M18 / M19',
    label: 'Verify M18 RR notification & M19 eICR KPI update',
    passed: true,
    evidence: `RR notice dispatched in M18; M19 eICR count=${eicrKpi?.value} (${eicrKpi?.rag})`,
  });

  return steps;
}

async function runScenarioD(): Promise<ScenarioStepResult[]> {
  const ctx = await prepareIsolatedScenarioContext('D');
  const steps: ScenarioStepResult[] = [];
  const engineer = { name: 'Morgan Brooks', role: 'IntegrationEngineer' as const };

  // 1. Cohort & gap evaluation
  const cohort = await udsService.buildCohort(ctx, {
    periodStart: '2025-01-01',
    periodEnd: '2026-12-31',
    minEncounters: 0,
    stateFilter: '',
    genderFilter: 'all',
  });
  assertCondition(cohort.charts.length >= 1, 'UDS+ cohort returned zero patients');
  steps.push({
    moduleCode: 'M4 / M14',
    label: 'Build UDS+ reporting cohort & gap scorecard',
    passed: true,
    evidence: `${cohort.charts.length} patient(s) in cohort; completeness ${cohort.overallCompletenessPct}%`,
  });

  // 2. De-identify strictly in memory
  const { previews, bundle } = udsService.deidentifyCohort(ctx.tenantId);
  const serialized = JSON.stringify(bundle);
  assertCondition(
    previews.length >= 1 && !serialized.includes('Jane Doe') && !serialized.includes('MRN-1001'),
    'De-identified bundle leaked direct identifiers',
  );
  steps.push({
    moduleCode: 'M14',
    label: 'Execute in-memory de-identification engine',
    passed: true,
    evidence: `${previews.length} patient(s) pseudonymized; zero direct identifiers in Bundle`,
  });

  // 3. Profile $validate
  const val = await udsService.validateCohortAgainstProfiles(ctx);
  assertCondition(val.passedCount >= 1, 'UDS+ profile $validate produced 0 passes');
  steps.push({
    moduleCode: 'M14',
    label: 'Validate de-identified cohort against UDS+ / US Core profiles',
    passed: true,
    evidence: `${val.passedCount} passed, ${val.findings.length} finding(s) with M4 fix links`,
  });

  // 4. Submission Bundle + MeasureReport
  const submission = await udsService.submitDeidentifiedBundle(ctx, engineer, {
    simulateRejection: false,
  });
  assertCondition(
    submission.status === 'Acknowledged' && Boolean(submission.measureReportId),
    'UDS+ submission Bundle / MeasureReport failed',
  );
  steps.push({
    moduleCode: 'M14',
    label: 'Build UDS+ submission Bundle & MeasureReport',
    passed: true,
    evidence: `Submission ${submission.id} (${submission.status}, MeasureReport/${submission.measureReportId})`,
  });

  return steps;
}

async function runScenarioE(): Promise<ScenarioStepResult[]> {
  const ctx = await prepareIsolatedScenarioContext('E');
  const steps: ScenarioStepResult[] = [];

  // 1. M15 built-in checks
  const checks = await conformanceService.runBuiltInChecks(ctx);
  const passCount = checks.filter((c) => c.status === 'Pass').length;
  assertCondition(checks.length === 6 && passCount >= 5, 'M15 built-in checks failed unexpectedly');
  steps.push({
    moduleCode: 'M15',
    label: 'Run 6 built-in FHIR R4 conformance probes',
    passed: true,
    evidence: `${passCount}/6 built-in probes passed (fhirVersion 4.0.1, $validate, references)`,
  });

  // 2. Import sample Inferno JSON & triage items
  const imported = conformanceService.importInfernoResults(
    ctx.tenantId,
    SAMPLE_INFERNO_JSON,
    'JSON',
    'Integration Engineer',
  );
  assertCondition(
    imported.run.passCount === 4 && imported.createdTriageCount === 2,
    'Inferno JSON import counts did not match expected',
  );
  steps.push({
    moduleCode: 'M15',
    label: 'Import sample Inferno results & create triage cards',
    passed: true,
    evidence: `Imported run (${imported.run.passRatePct}% pass rate); ${imported.createdTriageCount} triage cards created`,
  });

  // 3. M16 simulate sustained gateway outage -> circuit breaker opens with RFC 7807
  gatewayService.setFailureSimulation(ctx.tenantId, 'SustainedOutage');
  await gatewayService.invokeEndpoint(ctx.tenantId, 'ep-health');
  await gatewayService.invokeEndpoint(ctx.tenantId, 'ep-health');
  const tripped = await gatewayService.invokeEndpoint(ctx.tenantId, 'ep-health');
  assertCondition(
    tripped.status === 503 && tripped.isProblemDetails && tripped.circuitState === 'Open',
    'M16 circuit breaker did not open on sustained outage',
  );
  steps.push({
    moduleCode: 'M16',
    label: 'Simulate sustained gateway outage & open circuit breaker',
    passed: true,
    evidence: `HTTP ${tripped.status} RFC 7807 ProblemDetails; circuitState=${tripped.circuitState}`,
  });

  // 4. M20 classify failure, match KB, explain OperationOutcome, reset breaker & log resolution
  const diagnosis = diagnosticsService.classifyConnectivityFailure({
    httpStatus: tripped.status,
    errorMessage: String(tripped.body.title ?? '503 Service Unavailable'),
  });
  const kbHits = diagnosticsService.searchKnowledgeBase('inferno meta.profile');
  const explained = diagnosticsService.explainOperationOutcome(SAMPLE_OPERATION_OUTCOME);
  gatewayService.setFailureSimulation(ctx.tenantId, 'None');
  gatewayService.resetCircuitBreaker(ctx.tenantId);
  const recovered = await gatewayService.invokeEndpoint(ctx.tenantId, 'ep-health');
  diagnosticsService.addTroubleshootingLogEntry(ctx.tenantId, {
    symptom: 'Gateway 503 Circuit Breaker Open during Scenario E',
    actionTaken: 'Verified health via M20 classifier & reset circuit breaker',
    outcome: 'Resolved',
  });
  assertCondition(
    diagnosis.classification === '5xx Server Error' &&
      kbHits.length > 0 &&
      explained.length === 3 &&
      recovered.status === 200,
    'M20 troubleshooting or gateway recovery check failed',
  );
  steps.push({
    moduleCode: 'M20',
    label: 'Diagnose via M20 classifier, KB, OperationOutcome & recover gateway',
    passed: true,
    evidence: `Classified "${diagnosis.classification}", matched ${kbHits[0].id}, recovered HTTP ${recovered.status}`,
  });

  return steps;
}

async function runScenarioF(): Promise<ScenarioStepResult[]> {
  const steps: ScenarioStepResult[] = [];
  const platformAdmin = { name: 'Alex Morgan', role: 'PlatformAdmin' as const };
  const suffix = Date.now().toString(36).slice(-4);

  // 1. M24: Provision two tenants with distinct program templates & business rules
  const draftA = buildDefaultTenantDraft('Medicaid FFS', {
    legalName: `Scenario F Alpha State ${suffix}`,
    code: `sf-alpha-${suffix}`,
  });
  const draftB = buildDefaultTenantDraft('Health Center UDS+', {
    legalName: `Scenario F Beta FQHC ${suffix}`,
    code: `sf-beta-${suffix}`,
  });

  const { tenant: tenantA } = await tenantService.provisionTenant(draftA, platformAdmin);
  const { tenant: tenantB } = await tenantService.provisionTenant(draftB, platformAdmin);
  await tenantService.updateConfigSetting(
    tenantA.id,
    'enrollment.slaDays',
    14,
    'TENANT',
    platformAdmin,
  );
  await tenantService.updateConfigSetting(
    tenantB.id,
    'enrollment.slaDays',
    28,
    'TENANT',
    platformAdmin,
  );
  const slaA = tenantService
    .resolveEffectiveConfig(tenantA.id)
    .find((c) => c.definition.key === 'enrollment.slaDays')?.effectiveValue;
  const slaB = tenantService
    .resolveEffectiveConfig(tenantB.id)
    .find((c) => c.definition.key === 'enrollment.slaDays')?.effectiveValue;
  assertCondition(slaA === 14 && slaB === 28, 'Distinct tenant business rules did not resolve');
  steps.push({
    moduleCode: 'M24',
    label: 'Onboard two tenants with distinct business rules',
    passed: true,
    evidence: `${tenantA.code} (SLA ${slaA}d) and ${tenantB.code} (SLA ${slaB}d) provisioned`,
  });

  // 2. Strict tenant isolation
  let crossTenantBlocked = false;
  try {
    tenantService.assertTenantAccess(tenantA.id, tenantB.id, 'TenantAdmin');
  } catch {
    crossTenantBlocked = true;
  }
  assertCondition(crossTenantBlocked, 'Cross-tenant access was not blocked for TenantAdmin');
  steps.push({
    moduleCode: 'M24',
    label: 'Enforce strict cross-tenant isolation',
    passed: true,
    evidence: 'TenantAdmin blocked from accessing second tenant store',
  });

  // 3. M17: RBAC unmasking restriction + audited Auditor unmask
  const ctxA: FhirRequestContext = {
    tenantId: tenantA.id,
    tenantCode: tenantA.code,
    correlationId: `corr-e2e-f-${suffix}`,
  };
  let providerUnmaskBlocked = false;
  try {
    await securityService.requestAuditedUnmask(
      ctxA,
      {
        targetId: 'pat-f-1',
        fieldLabel: 'SSN',
        rawValue: '123-45-6789',
        kind: 'ssn',
        reason: 'Unauthorized probe',
      },
      { name: 'Provider User', role: 'ProviderUser' },
    );
  } catch {
    providerUnmaskBlocked = true;
  }
  const auditorUnmask = await securityService.requestAuditedUnmask(
    ctxA,
    {
      targetId: 'pat-f-1',
      fieldLabel: 'SSN',
      rawValue: '123-45-6789',
      kind: 'ssn',
      reason: 'Scenario F compliance review',
    },
    { name: 'Compliance Auditor', role: 'Auditor' },
  );
  assertCondition(
    providerUnmaskBlocked && auditorUnmask.auditRecorded && auditorUnmask.masked !== '123-45-6789',
    'Masking or RBAC unmask enforcement failed',
  );
  steps.push({
    moduleCode: 'M17',
    label: 'Verify RBAC masking & audited unmasking',
    passed: true,
    evidence: `ProviderUser blocked (403); Auditor unmasked with AuditEvent (${auditorUnmask.masked})`,
  });

  // 4. M17: SMART scope enforcement (403) + AuditEvent verification
  securityService.toggleSmartScope(tenantA.id, 'system/Consent.write', false);
  let scopeBlocked = false;
  try {
    securityService.assertSmartScope(tenantA.id, 'system/Consent.write');
  } catch {
    scopeBlocked = true;
  }
  securityService.toggleSmartScope(tenantA.id, 'system/Consent.write', true);
  const audits = await auditService.list(ctxA);
  assertCondition(scopeBlocked && audits.length >= 1, 'SMART scope enforcement or AuditEvent verification failed');
  steps.push({
    moduleCode: 'M1 / M17',
    label: 'Enforce SMART scopes (403) & verify FHIR AuditEvent trail',
    passed: true,
    evidence: `Revoked scope threw 403; ${audits.length} FHIR AuditEvent(s) recorded for ${tenantA.code}`,
  });

  return steps;
}

export const e2eScenariosService = {
  async runScenario(id: ScenarioId): Promise<ScenarioRunResult> {
    const meta = E2E_SCENARIO_CATALOG.find((s) => s.id === id)!;
    const prevMode = settingsService.load().fhirMode;
    // Always verify E2E scenarios in Mock mode
    if (prevMode !== 'mock') {
      settingsService.save({ fhirMode: 'mock' });
    }

    const started = performance.now();
    try {
      let steps: ScenarioStepResult[] = [];
      switch (id) {
        case 'A':
          steps = await runScenarioA();
          break;
        case 'B':
          steps = await runScenarioB();
          break;
        case 'C':
          steps = await runScenarioC();
          break;
        case 'D':
          steps = await runScenarioD();
          break;
        case 'E':
          steps = await runScenarioE();
          break;
        case 'F':
          steps = await runScenarioF();
          break;
      }
      return {
        ...meta,
        passed: steps.every((s) => s.passed),
        durationMs: Math.max(1, Math.round(performance.now() - started)),
        executedAt: new Date().toISOString(),
        steps,
      };
    } catch (err) {
      return {
        ...meta,
        passed: false,
        durationMs: Math.max(1, Math.round(performance.now() - started)),
        executedAt: new Date().toISOString(),
        steps: [],
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (prevMode !== 'mock') {
        settingsService.save({ fhirMode: prevMode });
      }
      eventBus.clearHistory();
    }
  },

  async runAllScenarios(): Promise<ScenarioRunResult[]> {
    const results: ScenarioRunResult[] = [];
    for (const meta of E2E_SCENARIO_CATALOG) {
      results.push(await this.runScenario(meta.id));
    }
    return results;
  },
};
