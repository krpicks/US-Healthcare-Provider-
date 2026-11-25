import { eventBus } from '../../events';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { auditService } from '../../services/auditService';
import { buildCsvString, parseSimpleCsv } from '../../services/csvUtils';
import {
  AppError,
  type FhirBundle,
  type FhirCoverage,
  type FhirInsurancePlan,
  type FhirLocation,
  type FhirOperationOutcome,
  type FhirOrganization,
  type FhirOrganizationAffiliation,
  type FhirPractitionerRole,
  type RoleName,
} from '../../types';
import { providerService } from '../m3-directory/providerService';

export type PlanType = 'FFS' | 'MCO' | 'CHIP' | 'Dual' | 'Other';
export type PlanStatus = 'Draft' | 'Active' | 'Closed';

export interface PlanBenefit {
  id: string;
  category: string;
  covered: boolean;
  limits: string;
  copayUsd: number;
  coinsurancePct: number;
  priorAuthRequired: boolean;
  referralRequired: boolean;
}

export interface PlanRecord {
  id: string;
  planCode: string;
  name: string;
  type: PlanType;
  market: string;
  effectiveStart: string;
  effectiveEnd: string;
  status: PlanStatus;
  serviceArea: string[];
  enrollmentRules: string;
  contactEmail: string;
  appealsInfo: string;
  version: number;
  benefits: PlanBenefit[];
  changeHistory: Array<{
    version: number;
    timestamp: string;
    summary: string;
    actor: string;
  }>;
}

export type NetworkCategory =
  | 'Primary Care'
  | 'Behavioral Health'
  | 'Dental'
  | 'Specialty';

export interface PlanNetworkRecord {
  id: string;
  planId: string;
  name: string;
  category: NetworkCategory;
  county: string;
  memberCount: number;
  requiredRatioPer1000: number;
  maxDistanceMiles: number;
  assignedProviderIds: string[];
}

export interface AdequacyGapReport {
  networkId: string;
  planName: string;
  networkName: string;
  category: NetworkCategory;
  county: string;
  assignedCount: number;
  requiredCount: number;
  ratioGap: number;
  status: 'Adequate' | 'Gap Detected';
}

export type ContractStatus =
  | 'Draft'
  | 'Sent'
  | 'Signed'
  | 'Active'
  | 'Expired'
  | 'Terminated';

export interface PlanProviderContract {
  id: string;
  planId: string;
  planName: string;
  practitionerId: string;
  practitionerName: string;
  templateName: string;
  rateScheduleId: string;
  effectiveStart: string;
  effectiveEnd: string;
  status: ContractStatus;
  signedBy?: string;
  signedAt?: string;
  amendments: string[];
}

export interface FeeScheduleEntry {
  code: string;
  modifier: string;
  description: string;
  rateUsd: number;
  effectiveStart: string;
  effectiveEnd: string;
}

export interface RateScheduleRecord {
  id: string;
  name: string;
  version: string;
  assignedPlanIds: string[];
  assignedProviderTypes: string[];
  entries: FeeScheduleEntry[];
}

export interface PriorAuthRule {
  id: string;
  planId: string;
  code: string;
  description: string;
  criteriaText: string;
}

export interface DirectoryPublishSnapshot {
  publishedAt: string;
  resourceCount: number;
  resourceKeys: string[];
  validationOk: boolean;
}

interface TenantPlanState {
  plans: PlanRecord[];
  networks: PlanNetworkRecord[];
  contracts: PlanProviderContract[];
  rateSchedules: RateScheduleRecord[];
  priorAuthRules: PriorAuthRule[];
  lastPublished?: DirectoryPublishSnapshot;
}

const tenantPlanStore = new Map<string, TenantPlanState>();

function buildInitialPlanState(tenantId: string, tenantCode: string): TenantPlanState {
  const isTenantB = tenantId.includes('health-center') || tenantCode.includes('fqhc');
  const ffsId = `plan-ffs-${tenantCode}`;
  const mcoId = `plan-mco-${tenantCode}`;
  const chipId = `plan-chip-${tenantCode}`;

  const defaultBenefits: PlanBenefit[] = [
    {
      id: 'ben-pcp',
      category: 'Primary Care Office Visit',
      covered: true,
      limits: 'Unlimited medically necessary visits',
      copayUsd: 0,
      coinsurancePct: 0,
      priorAuthRequired: false,
      referralRequired: false,
    },
    {
      id: 'ben-bh',
      category: 'Outpatient Behavioral Health',
      covered: true,
      limits: 'Parity with medical/surgical benefits',
      copayUsd: 0,
      coinsurancePct: 0,
      priorAuthRequired: false,
      referralRequired: false,
    },
    {
      id: 'ben-mri',
      category: 'Advanced Diagnostic Imaging (MRI/CT)',
      covered: true,
      limits: 'Subject to clinical necessity review',
      copayUsd: 3,
      coinsurancePct: 0,
      priorAuthRequired: true,
      referralRequired: true,
    },
    {
      id: 'ben-lab',
      category: 'Clinical Laboratory & Molecular PCR',
      covered: true,
      limits: 'CLIA-certified laboratories',
      copayUsd: 0,
      coinsurancePct: 0,
      priorAuthRequired: false,
      referralRequired: false,
    },
  ];

  const plans: PlanRecord[] = [
    {
      id: ffsId,
      planCode: 'MED-FFS-2026',
      name: 'State Medicaid Fee-For-Service Core',
      type: 'FFS',
      market: 'Statewide Medicaid',
      effectiveStart: '2026-01-01',
      effectiveEnd: '2026-12-31',
      status: 'Active',
      serviceArea: isTenantB ? ['Cook County', 'DuPage County', 'Peoria County'] : ['Albany County', 'Onondaga County', 'Monroe County', 'Erie County'],
      enrollmentRules: 'Open enrollment for eligible state Medicaid beneficiaries.',
      contactEmail: 'ffs-plan@synthetic.example',
      appealsInfo: 'Fair hearing request within 60 days of notice.',
      version: 1,
      benefits: defaultBenefits,
      changeHistory: [
        { version: 1, timestamp: '2026-01-01T00:00:00Z', summary: 'Initial 2026 plan year publication', actor: 'Platform Seed' },
      ],
    },
    {
      id: mcoId,
      planCode: 'MCO-COMP-2026',
      name: 'CommunityCare Managed Medicaid MCO',
      type: 'MCO',
      market: 'Managed Care',
      effectiveStart: '2026-01-01',
      effectiveEnd: '2026-12-31',
      status: 'Active',
      serviceArea: isTenantB ? ['Cook County', 'Kane County'] : ['Albany County', 'Monroe County', 'Westchester County'],
      enrollmentRules: 'PCP selection required within 30 days of enrollment.',
      contactEmail: 'mco-ops@synthetic.example',
      appealsInfo: 'Internal MCO appeal within 60 days; external review available.',
      version: 1,
      benefits: defaultBenefits,
      changeHistory: [
        { version: 1, timestamp: '2026-01-01T00:00:00Z', summary: 'Initial 2026 MCO benefit package', actor: 'Platform Seed' },
      ],
    },
    {
      id: chipId,
      planCode: 'CHIP-PLUS-2026',
      name: 'ChildHealth Plus CHIP Network',
      type: 'CHIP',
      market: 'Pediatric / CHIP',
      effectiveStart: '2026-01-01',
      effectiveEnd: '2026-12-31',
      status: 'Active',
      serviceArea: isTenantB ? ['Cook County', 'Peoria County'] : ['Albany County', 'Onondaga County', 'Erie County'],
      enrollmentRules: 'Children under age 19 meeting income guidelines.',
      contactEmail: 'chip-support@synthetic.example',
      appealsInfo: 'Expedited pediatric appeal available within 72 hours.',
      version: 1,
      benefits: defaultBenefits,
      changeHistory: [
        { version: 1, timestamp: '2026-01-01T00:00:00Z', summary: 'Initial 2026 CHIP plan year', actor: 'Platform Seed' },
      ],
    },
  ];

  const networks: PlanNetworkRecord[] = [
    {
      id: `net-pcp-${tenantCode}`,
      planId: ffsId,
      name: 'FFS Primary Care Network',
      category: 'Primary Care',
      county: isTenantB ? 'Cook County' : 'Albany County',
      memberCount: 2500,
      requiredRatioPer1000: 1,
      maxDistanceMiles: 15,
      assignedProviderIds: isTenantB ? ['prac-b-1', 'prac-b-2'] : ['prac-a-1', 'prac-a-5'],
    },
    {
      id: `net-bh-${tenantCode}`,
      planId: mcoId,
      name: 'MCO Behavioral Health Network',
      category: 'Behavioral Health',
      county: isTenantB ? 'Cook County' : 'Monroe County',
      memberCount: 3200,
      requiredRatioPer1000: 1,
      maxDistanceMiles: 25,
      assignedProviderIds: isTenantB ? [] : ['prac-a-3'],
    },
    {
      id: `net-dental-${tenantCode}`,
      planId: chipId,
      name: 'CHIP Pediatric & Dental Network',
      category: 'Dental',
      county: isTenantB ? 'Peoria County' : 'Onondaga County',
      memberCount: 1800,
      requiredRatioPer1000: 1,
      maxDistanceMiles: 20,
      assignedProviderIds: isTenantB ? ['prac-b-3'] : ['prac-a-2', 'prac-a-4'],
    },
  ];

  const rateSchedules: RateScheduleRecord[] = [
    {
      id: `rs-medicaid-2026-${tenantCode}`,
      name: '2026 Standard Medicaid Professional Fee Schedule',
      version: '2026.1',
      assignedPlanIds: [ffsId, mcoId, chipId],
      assignedProviderTypes: [
        'Individual Physician',
        'Nurse Practitioner',
        'FQHC Clinician',
        'Physician Assistant',
        'Behavioral Health Specialist',
      ],
      entries: [
        { code: '99213', modifier: '', description: 'Office visit, established patient, low complexity', rateUsd: 92.5, effectiveStart: '2026-01-01', effectiveEnd: '2026-12-31' },
        { code: '99214', modifier: '', description: 'Office visit, established patient, moderate complexity', rateUsd: 131.75, effectiveStart: '2026-01-01', effectiveEnd: '2026-12-31' },
        { code: '99203', modifier: '', description: 'Office visit, new patient, low complexity', rateUsd: 114.0, effectiveStart: '2026-01-01', effectiveEnd: '2026-12-31' },
        { code: '87635', modifier: '', description: 'SARS-CoV-2 amplified probe technique', rateUsd: 51.31, effectiveStart: '2026-01-01', effectiveEnd: '2026-12-31' },
        { code: '90834', modifier: '', description: 'Psychotherapy, 45 minutes', rateUsd: 108.4, effectiveStart: '2026-01-01', effectiveEnd: '2026-12-31' },
        { code: '70551', modifier: '26', description: 'MRI brain without contrast (professional)', rateUsd: 245.0, effectiveStart: '2026-01-01', effectiveEnd: '2026-12-31' },
      ],
    },
  ];

  const contracts: PlanProviderContract[] = [
    {
      id: `ctr-1-${tenantCode}`,
      planId: ffsId,
      planName: plans[0].name,
      practitionerId: isTenantB ? 'prac-b-1' : 'prac-a-1',
      practitionerName: isTenantB ? 'Dr. Rachel Goldstein' : 'Dr. Elena Vargas',
      templateName: 'Standard Medicaid Participating Provider Agreement v2026',
      rateScheduleId: rateSchedules[0].id,
      effectiveStart: '2026-01-01',
      effectiveEnd: '2026-12-31',
      status: 'Active',
      signedBy: isTenantB ? 'Dr. Rachel Goldstein' : 'Dr. Elena Vargas',
      signedAt: '2025-12-15T10:00:00Z',
      amendments: ['2026 Telehealth Parity Addendum'],
    },
    {
      id: `ctr-2-${tenantCode}`,
      planId: mcoId,
      planName: plans[1].name,
      practitionerId: isTenantB ? 'prac-b-2' : 'prac-a-3',
      practitionerName: isTenantB ? 'PA Mateo Morales' : 'Dr. Amara Okafor',
      templateName: 'Managed Care Behavioral & Primary Agreement v2026',
      rateScheduleId: rateSchedules[0].id,
      effectiveStart: '2026-01-01',
      effectiveEnd: '2026-12-15',
      status: 'Sent',
      amendments: [],
    },
  ];

  const priorAuthRules: PriorAuthRule[] = [
    {
      id: `pa-mri-${tenantCode}`,
      planId: ffsId,
      code: '70551',
      description: 'MRI Brain without contrast',
      criteriaText: 'Requires documented neurological deficit or refractory headache > 6 weeks.',
    },
    {
      id: `pa-ip-${tenantCode}`,
      planId: mcoId,
      code: '90837',
      description: 'Extended Psychotherapy (60 min)',
      criteriaText: 'Requires clinical justification after 12 sessions per plan year.',
    },
  ];

  return { plans, networks, contracts, rateSchedules, priorAuthRules };
}

function getOrInitPlanState(tenantId: string, tenantCode: string): TenantPlanState {
  let state = tenantPlanStore.get(tenantId);
  if (!state) {
    state = buildInitialPlanState(tenantId, tenantCode);
    tenantPlanStore.set(tenantId, state);
  }
  return state;
}

export const planService = {
  getState(ctx: FhirRequestContext): TenantPlanState {
    return getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
  },

  resetForTests(tenantId?: string): void {
    if (tenantId) {
      tenantPlanStore.delete(tenantId);
    } else {
      tenantPlanStore.clear();
    }
  },

  async createOrActivatePlan(
    ctx: FhirRequestContext,
    input: Omit<PlanRecord, 'id' | 'version' | 'changeHistory'>,
    actor: { name: string; role: RoleName },
  ): Promise<PlanRecord> {
    const state = getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
    const id = `plan-${input.planCode.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    const record: PlanRecord = {
      ...input,
      id,
      version: 1,
      changeHistory: [
        {
          version: 1,
          timestamp: new Date().toISOString(),
          summary: `Created plan (${input.status})`,
          actor: `${actor.name} (${actor.role})`,
        },
      ],
    };
    state.plans.unshift(record);

    const client = getFhirClient();
    const fhirPlan: FhirInsurancePlan = {
      resourceType: 'InsurancePlan',
      id,
      identifier: [{ system: 'http://providerlink.local/sid/plan-code', value: input.planCode }],
      status: input.status === 'Active' ? 'active' : input.status === 'Closed' ? 'retired' : 'draft',
      type: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/insurance-plan-type',
              code: input.type,
              display: input.type,
            },
          ],
        },
      ],
      name: input.name,
      period: { start: input.effectiveStart, end: input.effectiveEnd },
    };
    await client.update(ctx, fhirPlan);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'InsurancePlan',
      resourceId: id,
      outcomeDesc: `Created InsurancePlan ${input.planCode} (${input.name})`,
    });

    if (record.status === 'Active') {
      eventBus.publish({
        type: 'PlanActivated',
        tenantId: ctx.tenantId,
        sourceModule: 'M23',
        payload: { planId: id, planCode: input.planCode, name: input.name },
      });
    }
    return record;
  },

  async activatePlan(
    ctx: FhirRequestContext,
    planId: string,
    actor: { name: string; role: RoleName },
  ): Promise<PlanRecord> {
    const state = getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
    const plan = state.plans.find((p) => p.id === planId);
    if (!plan) {
      throw new AppError({ message: 'Plan not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    plan.status = 'Active';
    plan.version += 1;
    plan.changeHistory.unshift({
      version: plan.version,
      timestamp: new Date().toISOString(),
      summary: 'Plan activated',
      actor: `${actor.name} (${actor.role})`,
    });

    eventBus.publish({
      type: 'PlanActivated',
      tenantId: ctx.tenantId,
      sourceModule: 'M23',
      payload: { planId: plan.id, planCode: plan.planCode, name: plan.name },
    });

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'InsurancePlan',
      resourceId: plan.id,
      outcomeDesc: `Activated plan ${plan.planCode}`,
    });
    return plan;
  },

  async copyPlanToNextYear(
    ctx: FhirRequestContext,
    sourcePlanId: string,
    actor: { name: string; role: RoleName },
  ): Promise<PlanRecord> {
    const state = getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
    const src = state.plans.find((p) => p.id === sourcePlanId);
    if (!src) {
      throw new AppError({ message: 'Source plan not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    const nextYear = Number(src.effectiveStart.slice(0, 4)) + 1 || 2027;
    return this.createOrActivatePlan(
      ctx,
      {
        ...src,
        planCode: `${src.planCode.replace(/-\d{4}$/, '')}-${nextYear}`,
        name: `${src.name} (${nextYear})`,
        effectiveStart: `${nextYear}-01-01`,
        effectiveEnd: `${nextYear}-12-31`,
        status: 'Draft',
        benefits: src.benefits.map((b) => ({ ...b, id: `${b.id}-${nextYear}` })),
      },
      actor,
    );
  },

  assignProvidersToNetwork(
    ctx: FhirRequestContext,
    networkId: string,
    providerIds: string[],
  ): PlanNetworkRecord {
    const state = getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
    const net = state.networks.find((n) => n.id === networkId);
    if (!net) {
      throw new AppError({ message: 'Network not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    const merged = Array.from(new Set([...net.assignedProviderIds, ...providerIds]));
    net.assignedProviderIds = merged;
    eventBus.publish({
      type: 'NetworkChanged',
      tenantId: ctx.tenantId,
      sourceModule: 'M23',
      payload: { networkId, planId: net.planId, providerCount: merged.length },
    });
    return net;
  },

  evaluateNetworkAdequacy(ctx: FhirRequestContext): AdequacyGapReport[] {
    const state = getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
    return state.networks.map((net) => {
      const planName =
        state.plans.find((p) => p.id === net.planId)?.name ?? net.planId;
      const requiredCount = Math.max(
        1,
        Math.ceil((net.memberCount / 1000) * net.requiredRatioPer1000),
      );
      const assignedCount = net.assignedProviderIds.length;
      const ratioGap = Math.max(0, requiredCount - assignedCount);
      return {
        networkId: net.id,
        planName,
        networkName: net.name,
        category: net.category,
        county: net.county,
        assignedCount,
        requiredCount,
        ratioGap,
        status: ratioGap === 0 ? 'Adequate' : 'Gap Detected',
      };
    });
  },

  async signContract(
    ctx: FhirRequestContext,
    contractId: string,
    signerName: string,
    actor: { name: string; role: RoleName },
  ): Promise<PlanProviderContract> {
    const state = getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
    const ctr = state.contracts.find((c) => c.id === contractId);
    if (!ctr) {
      throw new AppError({ message: 'Contract not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    ctr.status = 'Active';
    ctr.signedBy = signerName;
    ctr.signedAt = new Date().toISOString();

    eventBus.publish({
      type: 'ContractSigned',
      tenantId: ctx.tenantId,
      sourceModule: 'M23',
      payload: {
        contractId: ctr.id,
        planId: ctr.planId,
        practitionerId: ctr.practitionerId,
      },
    });

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'InsurancePlan',
      resourceId: ctr.planId,
      outcomeDesc: `Signed contract ${ctr.id} for ${ctr.practitionerName}`,
    });

    return ctr;
  },

  /**
   * Effective rate lookup by procedure code, plan, provider type, and date of service (consumed by M11 Claims).
   */
  lookupEffectiveRate(
    ctx: FhirRequestContext,
    params: {
      code: string;
      modifier?: string;
      planId: string;
      providerType: string;
      dateOfService: string;
    },
  ): { found: boolean; rateUsd?: number; scheduleName?: string; entry?: FeeScheduleEntry } {
    const state = getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
    const schedules = state.rateSchedules.filter(
      (rs) =>
        rs.assignedPlanIds.includes(params.planId) &&
        (rs.assignedProviderTypes.length === 0 ||
          rs.assignedProviderTypes.includes(params.providerType)),
    );

    for (const rs of schedules) {
      const match = rs.entries.find(
        (e) =>
          e.code === params.code &&
          (e.modifier || '') === (params.modifier || '') &&
          e.effectiveStart <= params.dateOfService &&
          e.effectiveEnd >= params.dateOfService,
      );
      if (match) {
        return {
          found: true,
          rateUsd: match.rateUsd,
          scheduleName: `${rs.name} (v${rs.version})`,
          entry: match,
        };
      }
    }
    return { found: false };
  },

  importFeeScheduleCsv(
    ctx: FhirRequestContext,
    scheduleId: string,
    csvText: string,
  ): RateScheduleRecord {
    const state = getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
    const rs = state.rateSchedules.find((r) => r.id === scheduleId);
    if (!rs) {
      throw new AppError({ message: 'Rate schedule not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    const { rows } = parseSimpleCsv(csvText);
    const imported: FeeScheduleEntry[] = rows
      .filter((r) => r.code && r.rateUsd)
      .map((r) => ({
        code: r.code.trim(),
        modifier: (r.modifier ?? '').trim(),
        description: (r.description ?? r.code).trim(),
        rateUsd: Number(r.rateUsd),
        effectiveStart: r.effectiveStart || '2026-01-01',
        effectiveEnd: r.effectiveEnd || '2026-12-31',
      }))
      .filter((e) => !Number.isNaN(e.rateUsd));

    if (imported.length === 0) {
      throw new AppError({
        message: 'No valid fee schedule rows found. Expected columns: code,modifier,description,rateUsd,effectiveStart,effectiveEnd.',
        statusCode: 400,
        code: 'INVALID_CSV',
      });
    }

    rs.entries = [...rs.entries, ...imported];
    const [major, minor = '1'] = rs.version.split('.');
    rs.version = `${major}.${Number(minor) + 1}`;

    eventBus.publish({
      type: 'RateScheduleChanged',
      tenantId: ctx.tenantId,
      sourceModule: 'M23',
      payload: { scheduleId: rs.id, version: rs.version, addedEntries: imported.length },
    });

    return rs;
  },

  exportFeeScheduleCsv(ctx: FhirRequestContext, scheduleId: string): string {
    const state = getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
    const rs = state.rateSchedules.find((r) => r.id === scheduleId);
    if (!rs) return '';
    return buildCsvString(
      ['code', 'modifier', 'description', 'rateUsd', 'effectiveStart', 'effectiveEnd'],
      rs.entries.map((e) => [
        e.code,
        e.modifier,
        e.description,
        e.rateUsd.toFixed(2),
        e.effectiveStart,
        e.effectiveEnd,
      ]),
    );
  },

  /**
   * Member eligibility verification against FHIR Coverage resources (consumed by M11 Claims).
   */
  async checkMemberEligibility(
    ctx: FhirRequestContext,
    patientId: string,
    planId: string,
    dateOfService: string,
  ): Promise<{ eligible: boolean; reason: string; coverage?: FhirCoverage }> {
    const client = getFhirClient();
    const res = await client.search<FhirCoverage>(ctx, 'Coverage', {
      patient: `Patient/${patientId}`,
    });
    const activeMatch = res.resources.find((cov) => {
      if (cov.status !== 'active') return false;
      const start = cov.period?.start ?? '1900-01-01';
      const end = cov.period?.end ?? '9999-12-31';
      if (dateOfService < start || dateOfService > end) return false;
      const planClass = cov.class?.find((c) => c.value === planId);
      return Boolean(planClass);
    });

    if (activeMatch) {
      return {
        eligible: true,
        reason: `Active Coverage/${activeMatch.id} verified for ${dateOfService}.`,
        coverage: activeMatch,
      };
    }

    return {
      eligible: false,
      reason: `No active Coverage found for Patient/${patientId} under plan ${planId} on ${dateOfService}.`,
    };
  },

  /**
   * Build & validate Plan Directory publishing FHIR Bundle, showing diff against prior published snapshot.
   */
  async buildAndValidateDirectoryBundle(ctx: FhirRequestContext): Promise<{
    bundle: FhirBundle;
    outcome: FhirOperationOutcome;
    validationOk: boolean;
    addedKeys: string[];
    removedKeys: string[];
  }> {
    const client = getFhirClient();
    const [plans, orgs, affs, roles, locs] = await Promise.all([
      client.search<FhirInsurancePlan>(ctx, 'InsurancePlan', { _count: 100 }),
      client.search<FhirOrganization>(ctx, 'Organization', { _count: 100 }),
      client.search<FhirOrganizationAffiliation>(ctx, 'OrganizationAffiliation', { _count: 100 }),
      client.search<FhirPractitionerRole>(ctx, 'PractitionerRole', { _count: 100 }),
      client.search<FhirLocation>(ctx, 'Location', { _count: 100 }),
    ]);

    const allResources = [
      ...plans.resources,
      ...orgs.resources,
      ...affs.resources,
      ...roles.resources,
      ...locs.resources,
    ];

    const bundle: FhirBundle = {
      resourceType: 'Bundle',
      type: 'collection',
      timestamp: new Date().toISOString(),
      total: allResources.length,
      entry: allResources.map((res) => ({
        fullUrl: `${res.resourceType}/${res.id}`,
        resource: res,
      })),
    };

    const outcome = await client.operation<FhirOperationOutcome>(ctx, '$validate', {
      resourceType: 'Bundle',
      resource: bundle,
    });
    const validationOk = !outcome.issue?.some(
      (i) => i.severity === 'error' || i.severity === 'fatal',
    );

    const state = getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
    const currentKeys = allResources.map((r) => `${r.resourceType}/${r.id}`);
    const prevSet = new Set(state.lastPublished?.resourceKeys ?? []);
    const currSet = new Set(currentKeys);

    return {
      bundle,
      outcome,
      validationOk,
      addedKeys: currentKeys.filter((k) => !prevSet.has(k)),
      removedKeys: Array.from(prevSet).filter((k) => !currSet.has(k)),
    };
  },

  async publishDirectorySnapshot(
    ctx: FhirRequestContext,
    actor: { name: string; role: RoleName },
  ): Promise<DirectoryPublishSnapshot> {
    const built = await this.buildAndValidateDirectoryBundle(ctx);
    if (!built.validationOk) {
      throw new AppError({
        message: 'Directory bundle failed $validate and cannot be published.',
        statusCode: 422,
        code: 'VALIDATION_FAILED',
        rawOutcome: built.outcome,
      });
    }
    const state = getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
    const snapshot: DirectoryPublishSnapshot = {
      publishedAt: new Date().toISOString(),
      resourceCount: built.bundle.entry?.length ?? 0,
      resourceKeys: (built.bundle.entry ?? [])
        .map((e) => e.fullUrl ?? '')
        .filter(Boolean),
      validationOk: true,
    };
    state.lastPublished = snapshot;

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'export',
      resourceType: 'Bundle',
      outcomeDesc: `Published Plan Directory FHIR bundle (${snapshot.resourceCount} resources)`,
    });
    return snapshot;
  },

  async getPlanReports(ctx: FhirRequestContext) {
    const state = getOrInitPlanState(ctx.tenantId, ctx.tenantCode);
    const providers = await providerService.listProviders(ctx);
    const providerPlanCounts = new Map<string, { name: string; plans: Set<string> }>();

    for (const net of state.networks) {
      const planName = state.plans.find((p) => p.id === net.planId)?.name ?? net.planId;
      for (const pid of net.assignedProviderIds) {
        const prov = providers.find((p) => p.id === pid);
        const rec = providerPlanCounts.get(pid) ?? {
          name: prov?.fullName ?? pid,
          plans: new Set<string>(),
        };
        rec.plans.add(planName);
        providerPlanCounts.set(pid, rec);
      }
    }

    const multiPlanProviders = Array.from(providerPlanCounts.entries())
      .filter(([, v]) => v.plans.size > 1)
      .map(([id, v]) => ({ id, name: v.name, plans: Array.from(v.plans) }));

    const expiringContracts = state.contracts.filter(
      (c) => c.status !== 'Terminated' && c.effectiveEnd <= '2026-12-31',
    );
    const adequacyGaps = this.evaluateNetworkAdequacy(ctx).filter(
      (g) => g.status === 'Gap Detected',
    );

    return {
      networksByPlan: state.plans.map((p) => ({
        planId: p.id,
        planName: p.name,
        networkCount: state.networks.filter((n) => n.planId === p.id).length,
        endDate: p.effectiveEnd,
      })),
      multiPlanProviders,
      expiringContracts,
      adequacyGaps,
    };
  },
};
