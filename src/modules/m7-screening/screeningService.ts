import { eventBus } from '../../events';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { auditService } from '../../services';
import { tenantService } from '../../tenancy';
import {
  AppError,
  type FhirProvenance,
  type FhirRiskAssessment,
  type FhirTask,
  type RoleName,
} from '../../types';
import {
  enrollmentService,
  type EnrollmentApplication,
} from '../m5-enrollment/enrollmentService';

export type RiskLevel = 'Limited' | 'Moderate' | 'High';

export interface RiskScoringRule {
  id: string;
  factor: 'providerType' | 'ownershipType' | 'yearsInBusiness' | 'sanctions' | 'applicationType';
  conditionLabel: string;
  matchValue: string;
  resultingTier: RiskLevel;
  enabled: boolean;
}

export interface RiskRuleVersion {
  version: number;
  timestamp: string;
  actor: string;
  summary: string;
  rulesSnapshot: RiskScoringRule[];
}

export interface SiteVisitForm {
  completed: boolean;
  inspectorName: string;
  visitDate: string;
  signageVerified: boolean;
  hoursPosted: boolean;
  adaAccessible: boolean;
  equipmentPresent: boolean;
  outcome: 'Pending' | 'Passed' | 'Failed';
  notes: string;
}

export interface FingerprintCheckItem {
  ownerName: string;
  ownershipPercent: number;
  status: 'Pending' | 'Submitted' | 'Cleared' | 'Flagged';
  clearedDate?: string;
  referenceNumber?: string;
}

export interface ScreeningCaseRecord {
  id: string;
  applicationId: string;
  applicationNumber: string;
  providerName: string;
  npi: string;
  computedTier: RiskLevel;
  effectiveTier: RiskLevel;
  rationale: string[];
  riskAssessmentId?: string;
  taskIds: string[];
  databaseCheckDone: boolean;
  requiresSiteVisit: boolean;
  siteVisit: SiteVisitForm;
  requiresFingerprint: boolean;
  fingerprints: FingerprintCheckItem[];
  override?: {
    previousTier: RiskLevel;
    newTier: RiskLevel;
    reason: string;
    approver: string;
    timestamp: string;
    provenanceId?: string;
  };
  status: 'Assigned' | 'In Progress' | 'Completed';
  completedAt?: string;
}

interface TenantScreeningState {
  rules: RiskScoringRule[];
  ruleVersions: RiskRuleVersion[];
  cases: Record<string, ScreeningCaseRecord>;
}

const DEFAULT_RISK_RULES: RiskScoringRule[] = [
  { id: 'rr-1', factor: 'providerType', conditionLabel: 'Hospital / Institutional', matchValue: 'Hospital / Institutional', resultingTier: 'High', enabled: true },
  { id: 'rr-2', factor: 'providerType', conditionLabel: 'Behavioral Health Specialist', matchValue: 'Behavioral Health Specialist', resultingTier: 'Moderate', enabled: true },
  { id: 'rr-3', factor: 'sanctions', conditionLabel: 'Disclosed prior sanctions', matchValue: 'true', resultingTier: 'High', enabled: true },
  { id: 'rr-4', factor: 'yearsInBusiness', conditionLabel: 'Newly established (< 2 years)', matchValue: '2', resultingTier: 'Moderate', enabled: true },
  { id: 'rr-5', factor: 'applicationType', conditionLabel: 'Change of Ownership (CHOW)', matchValue: 'Change of Ownership', resultingTier: 'High', enabled: true },
  { id: 'rr-6', factor: 'applicationType', conditionLabel: 'Reinstatement after termination', matchValue: 'Reinstatement', resultingTier: 'High', enabled: true },
];

const TIER_RANK: Record<RiskLevel, number> = { Limited: 1, Moderate: 2, High: 3 };

const tenantScreeningStore = new Map<string, TenantScreeningState>();

function getState(tenantId: string): TenantScreeningState {
  let st = tenantScreeningStore.get(tenantId);
  if (!st) {
    const initialRules = DEFAULT_RISK_RULES.map((r) => ({ ...r }));
    st = {
      rules: initialRules,
      ruleVersions: [
        {
          version: 1,
          timestamp: '2026-01-01T00:00:00Z',
          actor: 'Platform Seed',
          summary: 'Initial 42 CFR 455.450 risk tier configuration',
          rulesSnapshot: initialRules.map((r) => ({ ...r })),
        },
      ],
      cases: {},
    };
    tenantScreeningStore.set(tenantId, st);
  }
  return st;
}

export const screeningService = {
  getState(tenantId: string): TenantScreeningState {
    return getState(tenantId);
  },

  resetForTests(tenantId?: string): void {
    if (tenantId) {
      tenantScreeningStore.delete(tenantId);
    } else {
      tenantScreeningStore.clear();
    }
  },

  evaluateRiskTier(
    tenantId: string,
    app: EnrollmentApplication,
  ): { tier: RiskLevel; rationale: string[] } {
    const st = getState(tenantId);
    const tenant = tenantService.getTenantById(tenantId);
    let tier: RiskLevel = 'Limited';
    const rationale: string[] = [];

    // Tenant businessRules baseline mapping
    const tenantRule = tenant?.businessRules.riskRules.find(
      (r) => r.providerType === app.providerType,
    );
    if (tenantRule && TIER_RANK[tenantRule.riskLevel] > TIER_RANK[tier]) {
      tier = tenantRule.riskLevel;
      rationale.push(`Tenant provider-type rule: ${app.providerType} -> ${tenantRule.riskLevel}`);
    }

    for (const rule of st.rules) {
      if (!rule.enabled) continue;
      let matched = false;
      if (rule.factor === 'providerType' && app.providerType === rule.matchValue) {
        matched = true;
      } else if (rule.factor === 'ownershipType' && app.ownershipType === rule.matchValue) {
        matched = true;
      } else if (
        rule.factor === 'yearsInBusiness' &&
        app.yearsInBusiness < Number(rule.matchValue)
      ) {
        matched = true;
      } else if (
        rule.factor === 'sanctions' &&
        (app.hasPriorSanctions || app.disclosures.some((d) => d.hasSanctions))
      ) {
        matched = true;
      } else if (rule.factor === 'applicationType' && app.applicationType === rule.matchValue) {
        matched = true;
      }

      if (matched) {
        rationale.push(`${rule.conditionLabel} -> ${rule.resultingTier}`);
        if (TIER_RANK[rule.resultingTier] > TIER_RANK[tier]) {
          tier = rule.resultingTier;
        }
      }
    }

    if (rationale.length === 0) {
      rationale.push(`Standard ${app.providerType} with clean history -> Limited risk`);
    }

    return { tier, rationale };
  },

  updateRule(
    tenantId: string,
    ruleId: string,
    patch: Partial<RiskScoringRule>,
    actorLabel: string,
  ): RiskScoringRule[] {
    const st = getState(tenantId);
    st.rules = st.rules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r));
    st.ruleVersions.unshift({
      version: st.ruleVersions.length + 1,
      timestamp: new Date().toISOString(),
      actor: actorLabel,
      summary: `Updated rule ${ruleId}`,
      rulesSnapshot: st.rules.map((r) => ({ ...r })),
    });
    return st.rules;
  },

  async assignScreening(
    ctx: FhirRequestContext,
    applicationId: string,
    actor: { name: string; role: RoleName },
  ): Promise<ScreeningCaseRecord> {
    const app = enrollmentService.getApplicationById(ctx.tenantId, applicationId);
    if (!app) {
      throw new AppError({ message: 'Application not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const { tier, rationale } = this.evaluateRiskTier(ctx.tenantId, app);
    const client = getFhirClient();

    const riskRes: FhirRiskAssessment = {
      resourceType: 'RiskAssessment',
      status: 'final',
      subject: {
        reference: app.taskId ? `Task/${app.taskId}` : `Practitioner/${app.npi}`,
        display: `${app.applicantGiven} ${app.applicantFamily}`,
      },
      occurrenceDateTime: new Date().toISOString(),
      prediction: [
        {
          outcome: { text: `${tier} Categorical Risk` },
          qualitativeRisk: {
            coding: [
              {
                system: 'http://providerlink.local/CodeSystem/screening-risk',
                code: tier.toLowerCase(),
                display: tier,
              },
            ],
          },
          rationale: rationale.join('; '),
        },
      ],
      note: [{ text: `Application ${app.applicationNumber} (${app.providerType})` }],
    };
    const createdRisk = await client.create(ctx, riskRes);

    const requiresSiteVisit = tier === 'Moderate' || tier === 'High';
    const requiresFingerprint = tier === 'High';

    const taskIds: string[] = [];
    const taskLabels = [
      'Database Verification Checks',
      ...(requiresSiteVisit ? ['On-Site Facility Inspection'] : []),
      ...(requiresFingerprint ? ['Fingerprint Criminal Background Check (>=5% Owners)'] : []),
    ];
    for (const label of taskLabels) {
      const task: FhirTask = {
        resourceType: 'Task',
        status: 'in-progress',
        intent: 'order',
        code: { text: label },
        description: `${app.applicationNumber}: ${label}`,
        authoredOn: new Date().toISOString(),
      };
      const t = await client.create(ctx, task);
      if (t.id) taskIds.push(t.id);
    }

    const owners5Pct = app.disclosures.filter(
      (d) => d.role === 'Owner (>=5%)' || d.ownershipPercent >= 5,
    );

    const record: ScreeningCaseRecord = {
      id: `scr-${Date.now().toString(36)}`,
      applicationId: app.id,
      applicationNumber: app.applicationNumber,
      providerName: `${app.applicantGiven} ${app.applicantFamily}`,
      npi: app.npi,
      computedTier: tier,
      effectiveTier: tier,
      rationale,
      riskAssessmentId: createdRisk.id,
      taskIds,
      databaseCheckDone: false,
      requiresSiteVisit,
      siteVisit: {
        completed: false,
        inspectorName: actor.name,
        visitDate: new Date().toISOString().slice(0, 10),
        signageVerified: false,
        hoursPosted: false,
        adaAccessible: false,
        equipmentPresent: false,
        outcome: 'Pending',
        notes: '',
      },
      requiresFingerprint,
      fingerprints: owners5Pct.map((o) => ({
        ownerName: o.name || 'Disclosed Owner',
        ownershipPercent: o.ownershipPercent,
        status: 'Pending',
      })),
      status: 'Assigned',
    };

    const st = getState(ctx.tenantId);
    st.cases[app.id] = record;

    enrollmentService.transitionStatus(
      ctx.tenantId,
      app.id,
      'In Screening',
      `${actor.name} (${actor.role})`,
      `Assigned ${tier} risk screening (RiskAssessment/${createdRisk.id}).`,
      { riskTier: tier },
    );

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'RiskAssessment',
      resourceId: createdRisk.id,
      outcomeDesc: `Assigned ${tier} risk screening for ${app.applicationNumber}`,
    });

    eventBus.publish({
      type: 'ScreeningAssigned',
      tenantId: ctx.tenantId,
      sourceModule: 'M7',
      payload: {
        applicationId: app.id,
        applicationNumber: app.applicationNumber,
        riskTier: tier,
        riskAssessmentId: createdRisk.id,
      },
    });

    return record;
  },

  async updateScreeningTasks(
    ctx: FhirRequestContext,
    applicationId: string,
    patch: {
      databaseCheckDone?: boolean;
      siteVisit?: Partial<SiteVisitForm>;
      fingerprints?: FingerprintCheckItem[];
    },
    actor: { name: string; role: RoleName },
  ): Promise<ScreeningCaseRecord> {
    const st = getState(ctx.tenantId);
    const rec = st.cases[applicationId];
    if (!rec) {
      throw new AppError({ message: 'Screening case not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    if (patch.databaseCheckDone !== undefined) {
      rec.databaseCheckDone = patch.databaseCheckDone;
    }
    if (patch.siteVisit) {
      rec.siteVisit = { ...rec.siteVisit, ...patch.siteVisit };
    }
    if (patch.fingerprints) {
      rec.fingerprints = patch.fingerprints;
    }

    const siteOk = !rec.requiresSiteVisit || (rec.siteVisit.completed && rec.siteVisit.outcome === 'Passed');
    const fpOk =
      !rec.requiresFingerprint ||
      rec.fingerprints.length === 0 ||
      rec.fingerprints.every((f) => f.status === 'Cleared');

    if (rec.databaseCheckDone && siteOk && fpOk) {
      rec.status = 'Completed';
      rec.completedAt = new Date().toISOString();

      enrollmentService.transitionStatus(
        ctx.tenantId,
        applicationId,
        'In Review',
        `${actor.name} (${actor.role})`,
        `All ${rec.effectiveTier}-risk screening tasks completed; routed to M8 Review & Determination.`,
        { riskTier: rec.effectiveTier },
      );

      await auditService.record({
        ctx,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'update',
        resourceType: 'RiskAssessment',
        resourceId: rec.riskAssessmentId,
        outcomeDesc: `Completed ${rec.effectiveTier} screening for ${rec.applicationNumber}`,
      });

      eventBus.publish({
        type: 'ScreeningCompleted',
        tenantId: ctx.tenantId,
        sourceModule: 'M7',
        payload: {
          applicationId,
          applicationNumber: rec.applicationNumber,
          effectiveTier: rec.effectiveTier,
        },
      });
    } else {
      rec.status = 'In Progress';
    }

    return rec;
  },

  async overrideRiskTier(
    ctx: FhirRequestContext,
    applicationId: string,
    newTier: RiskLevel,
    reason: string,
    actor: { name: string; role: RoleName },
  ): Promise<ScreeningCaseRecord> {
    if (actor.role !== 'PlatformAdmin' && actor.role !== 'AgencyApprover' && actor.role !== 'ProgramIntegrityOfficer') {
      throw new AppError({
        message: 'Risk tier override requires AgencyApprover, ProgramIntegrityOfficer, or PlatformAdmin approval.',
        statusCode: 403,
        code: 'APPROVER_REQUIRED',
      });
    }
    if (!reason.trim()) {
      throw new AppError({ message: 'Override reason is required.', statusCode: 400, code: 'REASON_REQUIRED' });
    }
    const st = getState(ctx.tenantId);
    const rec = st.cases[applicationId];
    if (!rec) {
      throw new AppError({ message: 'Screening case not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const client = getFhirClient();
    const prov: FhirProvenance = {
      resourceType: 'Provenance',
      target: [{ reference: `RiskAssessment/${rec.riskAssessmentId ?? rec.id}` }],
      recorded: new Date().toISOString(),
      reason: [{ text: `Risk override ${rec.effectiveTier} -> ${newTier}: ${reason}` }],
      agent: [{ who: { display: `${actor.name} (${actor.role})` } }],
    };
    const createdProv = await client.create(ctx, prov);

    rec.override = {
      previousTier: rec.effectiveTier,
      newTier,
      reason,
      approver: `${actor.name} (${actor.role})`,
      timestamp: new Date().toISOString(),
      provenanceId: createdProv.id,
    };
    rec.effectiveTier = newTier;
    rec.requiresSiteVisit = newTier === 'Moderate' || newTier === 'High';
    rec.requiresFingerprint = newTier === 'High';

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Provenance',
      resourceId: createdProv.id,
      outcomeDesc: `Overrode screening risk tier on ${rec.applicationNumber} to ${newTier}`,
    });

    return rec;
  },
};
