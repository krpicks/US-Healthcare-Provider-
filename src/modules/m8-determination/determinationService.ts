import { eventBus } from '../../events';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { auditService } from '../../services';
import { tenantService } from '../../tenancy';
import {
  AppError,
  type FhirCommunication,
  type FhirProvenance,
  type RoleName,
} from '../../types';
import { providerService } from '../m3-directory/providerService';
import {
  enrollmentService,
  type EnrollmentApplication,
} from '../m5-enrollment/enrollmentService';

export type SlaHealth = 'On track' | 'At risk' | 'Breached';

export interface PendingTwoPersonDecision {
  id: string;
  applicationId: string;
  applicationNumber: string;
  providerName: string;
  decisionType: 'Approve' | 'Deny';
  effectiveDate?: string;
  contractProgram?: string;
  rateScheduleId?: string;
  reasonCodes?: string[];
  notes: string;
  requestedBy: string;
  requestedAt: string;
  status: 'PendingSignOff' | 'SignedOff' | 'Rejected';
  signedOffBy?: string;
  signedOffAt?: string;
}

export interface DecisionRecord {
  id: string;
  applicationId: string;
  applicationNumber: string;
  providerName: string;
  npi: string;
  outcome: 'Approved' | 'Denied' | 'Escalated';
  effectiveDate?: string;
  reasonCodes: string[];
  notes: string;
  decidedBy: string;
  approvedBy?: string;
  decidedAt: string;
  letterText: string;
  provenanceId?: string;
}

export interface AppealRecord {
  id: string;
  applicationId: string;
  applicationNumber: string;
  providerName: string;
  filedAt: string;
  windowEndsAt: string;
  reason: string;
  supportingDocuments: string[];
  status: 'Open' | 'Upheld' | 'Overturned' | 'Remanded';
  resolutionNotes?: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface RfiPolicyConfig {
  reminderDaysBeforeDue: [number, number];
  autoWithdrawAfterDays: number;
  appealWindowDays: number;
}

export const DEFICIENCY_CATALOGUE = [
  'Missing or expired State Medical License',
  'Missing Malpractice Certificate of Insurance ($1M/$3M)',
  'Incomplete 5%+ Ownership & Control Disclosure (42 CFR 455.104)',
  'IRS TIN / W-9 legal name mismatch',
  'Unresolved SAM / OIG-LEIE or state sanction inquiry',
  'Incomplete practice location hours or ADA accessibility info',
];

export const DENIAL_REASON_CODES = [
  'D01 — Active Federal or State Exclusion (OIG-LEIE / SAM)',
  'D02 — License Revoked, Suspended, or Expired',
  'D03 — Material Misrepresentation or Falsification',
  'D04 — Failed On-Site Facility Inspection',
  'D05 — Failure to Respond to RFI Within Required Window',
  'D06 — Disqualifying Criminal Conviction (42 CFR 455.416)',
];

interface TenantDeterminationState {
  pendingSignOffs: PendingTwoPersonDecision[];
  decisions: DecisionRecord[];
  appeals: AppealRecord[];
  policy: RfiPolicyConfig;
}

const tenantDeterminationStore = new Map<string, TenantDeterminationState>();

function getState(tenantId: string): TenantDeterminationState {
  let st = tenantDeterminationStore.get(tenantId);
  if (!st) {
    st = {
      pendingSignOffs: [],
      decisions: [],
      appeals: [],
      policy: {
        reminderDaysBeforeDue: [7, 2],
        autoWithdrawAfterDays: 30,
        appealWindowDays: 60,
      },
    };
    tenantDeterminationStore.set(tenantId, st);
  }
  return st;
}

export function computeSlaHealth(
  app: EnrollmentApplication,
): { health: SlaHealth; daysRemaining: number } {
  if (!app.slaDueDate) {
    return { health: 'On track', daysRemaining: 30 };
  }
  const dueMs = Date.parse(app.slaDueDate);
  const diffDays = Math.ceil((dueMs - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { health: 'Breached', daysRemaining: diffDays };
  if (diffDays <= 5) return { health: 'At risk', daysRemaining: diffDays };
  return { health: 'On track', daysRemaining: diffDays };
}

function buildDecisionLetter(
  tenantName: string,
  app: EnrollmentApplication,
  outcome: 'Approved' | 'Denied',
  effectiveDate?: string,
  reasonCodes: string[] = [],
  appealWindowDays = 60,
): string {
  const providerName = `${app.applicantPrefix} ${app.applicantGiven} ${app.applicantFamily}`.trim();
  if (outcome === 'Approved') {
    return [
      `${tenantName} — OFFICIAL NOTICE OF PROVIDER ENROLLMENT APPROVAL`,
      `Date: ${new Date().toISOString().slice(0, 10)}`,
      `Application: ${app.applicationNumber} · NPI: ${app.npi}`,
      `Dear ${providerName},`,
      `Your enrollment as a Medicaid ${app.providerType} (${app.contractProgram}) has been APPROVED effective ${effectiveDate ?? new Date().toISOString().slice(0, 10)}.`,
      `Your record has been queued for MMIS loading (M10) and Directory publication (M3).`,
      `— Synthetic Prototype Notice (Do not use for live PHI)`,
    ].join('\n');
  }
  return [
    `${tenantName} — OFFICIAL NOTICE OF ENROLLMENT DENIAL & APPEAL RIGHTS`,
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `Application: ${app.applicationNumber} · NPI: ${app.npi}`,
    `Dear ${providerName},`,
    `Your Medicaid enrollment application has been DENIED for the following reason(s):`,
    ...reasonCodes.map((r) => `  • ${r}`),
    `APPEAL RIGHTS: Under 42 CFR 455.422, you may file a written administrative appeal within ${appealWindowDays} calendar days of this notice.`,
    `— Synthetic Prototype Notice (Do not use for live PHI)`,
  ].join('\n');
}

export const determinationService = {
  getState(tenantId: string): TenantDeterminationState {
    return getState(tenantId);
  },

  resetForTests(tenantId?: string): void {
    if (tenantId) {
      tenantDeterminationStore.delete(tenantId);
    } else {
      tenantDeterminationStore.clear();
    }
  },

  updatePolicy(tenantId: string, patch: Partial<RfiPolicyConfig>): RfiPolicyConfig {
    const st = getState(tenantId);
    st.policy = { ...st.policy, ...patch };
    return st.policy;
  },

  bulkAssign(tenantId: string, applicationIds: string[], analystName: string): void {
    for (const id of applicationIds) {
      const app = enrollmentService.getApplicationById(tenantId, id);
      if (app) {
        app.assignedAnalyst = analystName;
      }
    }
  },

  getNextCase(tenantId: string): EnrollmentApplication | undefined {
    const open = enrollmentService
      .listApplications(tenantId)
      .filter((a) => ['In Review', 'Submitted', 'In Validation', 'In Screening'].includes(a.status));
    return open.sort((a, b) => (a.slaDueDate ?? '9999').localeCompare(b.slaDueDate ?? '9999'))[0];
  },

  requiresTwoPersonApproval(
    app: EnrollmentApplication,
    decisionType: 'Approve' | 'Deny',
  ): boolean {
    if (decisionType === 'Deny') return true;
    if (decisionType === 'Approve' && app.riskTier === 'High') return true;
    return false;
  },

  canSignOffTwoPerson(role: RoleName): boolean {
    return role === 'AgencyApprover' || role === 'PlatformAdmin';
  },

  async submitDecision(
    ctx: FhirRequestContext,
    input: {
      applicationId: string;
      decisionType: 'Approve' | 'Deny' | 'Escalate';
      effectiveDate?: string;
      contractProgram?: string;
      rateScheduleId?: string;
      reasonCodes?: string[];
      notes: string;
    },
    actor: { name: string; role: RoleName },
  ): Promise<{
    status: 'Finalized' | 'PendingSignOff' | 'Escalated';
    decision?: DecisionRecord;
    pending?: PendingTwoPersonDecision;
  }> {
    const app = enrollmentService.getApplicationById(ctx.tenantId, input.applicationId);
    if (!app) {
      throw new AppError({ message: 'Application not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    const st = getState(ctx.tenantId);

    if (input.decisionType === 'Escalate') {
      app.assignedAnalyst = 'Program Integrity / Agency Approver';
      const dec: DecisionRecord = {
        id: `dec-${Date.now().toString(36)}`,
        applicationId: app.id,
        applicationNumber: app.applicationNumber,
        providerName: `${app.applicantGiven} ${app.applicantFamily}`,
        npi: app.npi,
        outcome: 'Escalated',
        reasonCodes: input.reasonCodes ?? ['Program Integrity Review'],
        notes: input.notes,
        decidedBy: `${actor.name} (${actor.role})`,
        decidedAt: new Date().toISOString(),
        letterText: '',
      };
      st.decisions.unshift(dec);
      enrollmentService.transitionStatus(
        ctx.tenantId,
        app.id,
        'In Review',
        `${actor.name} (${actor.role})`,
        `Escalated to Program Integrity / AgencyApprover: ${input.notes}`,
      );
      return { status: 'Escalated', decision: dec };
    }

    if (input.decisionType === 'Deny' && (!input.reasonCodes || input.reasonCodes.length === 0)) {
      throw new AppError({
        message: 'At least one denial reason code is required.',
        statusCode: 400,
        code: 'DENIAL_REASON_REQUIRED',
      });
    }

    // Enforce Two-Person Rule for Denials and High-Risk Approvals
    if (
      this.requiresTwoPersonApproval(app, input.decisionType) &&
      !this.canSignOffTwoPerson(actor.role)
    ) {
      const pending: PendingTwoPersonDecision = {
        id: `pso-${Date.now().toString(36)}`,
        applicationId: app.id,
        applicationNumber: app.applicationNumber,
        providerName: `${app.applicantGiven} ${app.applicantFamily}`,
        decisionType: input.decisionType,
        effectiveDate: input.effectiveDate,
        contractProgram: input.contractProgram,
        rateScheduleId: input.rateScheduleId,
        reasonCodes: input.reasonCodes,
        notes: input.notes,
        requestedBy: `${actor.name} (${actor.role})`,
        requestedAt: new Date().toISOString(),
        status: 'PendingSignOff',
      };
      st.pendingSignOffs.unshift(pending);
      enrollmentService.transitionStatus(
        ctx.tenantId,
        app.id,
        'In Review',
        `${actor.name} (${actor.role})`,
        `Proposed ${input.decisionType} queued for mandatory AgencyApprover two-person sign-off.`,
      );
      return { status: 'PendingSignOff', pending };
    }

    const decision = await this.finalizeDecision(
      ctx,
      app,
      { ...input, decisionType: input.decisionType },
      actor,
      `${actor.name} (${actor.role})`,
    );
    return { status: 'Finalized', decision };
  },

  async signOffPendingDecision(
    ctx: FhirRequestContext,
    pendingId: string,
    actor: { name: string; role: RoleName },
  ): Promise<DecisionRecord> {
    if (!this.canSignOffTwoPerson(actor.role)) {
      throw new AppError({
        message: 'Two-person sign-off requires AgencyApprover or PlatformAdmin role.',
        statusCode: 403,
        code: 'APPROVER_REQUIRED',
      });
    }
    const st = getState(ctx.tenantId);
    const pending = st.pendingSignOffs.find((p) => p.id === pendingId);
    if (!pending || pending.status !== 'PendingSignOff') {
      throw new AppError({ message: 'Pending sign-off item not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    const app = enrollmentService.getApplicationById(ctx.tenantId, pending.applicationId);
    if (!app) {
      throw new AppError({ message: 'Application not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    pending.status = 'SignedOff';
    pending.signedOffBy = `${actor.name} (${actor.role})`;
    pending.signedOffAt = new Date().toISOString();

    return this.finalizeDecision(
      ctx,
      app,
      {
        applicationId: app.id,
        decisionType: pending.decisionType,
        effectiveDate: pending.effectiveDate,
        contractProgram: pending.contractProgram,
        rateScheduleId: pending.rateScheduleId,
        reasonCodes: pending.reasonCodes,
        notes: pending.notes,
      },
      actor,
      pending.requestedBy,
    );
  },

  async finalizeDecision(
    ctx: FhirRequestContext,
    app: EnrollmentApplication,
    input: {
      applicationId: string;
      decisionType: 'Approve' | 'Deny';
      effectiveDate?: string;
      contractProgram?: string;
      rateScheduleId?: string;
      reasonCodes?: string[];
      notes: string;
    },
    approver: { name: string; role: RoleName },
    requestedByLabel: string,
  ): Promise<DecisionRecord> {
    const client = getFhirClient();
    const st = getState(ctx.tenantId);
    const tenant = tenantService.getTenantById(ctx.tenantId);
    const outcome = input.decisionType === 'Approve' ? 'Approved' : 'Denied';
    const effectiveDate = input.effectiveDate || new Date().toISOString().slice(0, 10);

    const prov: FhirProvenance = {
      resourceType: 'Provenance',
      target: [{ reference: `Task/${app.taskId ?? app.id}` }],
      recorded: new Date().toISOString(),
      reason: [
        {
          text: `Determination: ${outcome}. ${input.notes} ${(input.reasonCodes ?? []).join('; ')}`,
        },
      ],
      agent: [
        { who: { display: requestedByLabel } },
        { who: { display: `${approver.name} (${approver.role})` } },
      ],
    };
    const createdProv = await client.create(ctx, prov);

    const letterText = buildDecisionLetter(
      tenant?.legalName ?? 'State Medicaid Agency',
      app,
      outcome,
      effectiveDate,
      input.reasonCodes ?? [],
      st.policy.appealWindowDays,
    );

    const comm: FhirCommunication = {
      resourceType: 'Communication',
      status: 'completed',
      category: [{ text: outcome === 'Approved' ? 'Approval Decision Letter' : 'Denial Decision Letter' }],
      sent: new Date().toISOString(),
      sender: { display: `${approver.name} (${approver.role})` },
      payload: [{ contentString: letterText }],
    };
    await client.create(ctx, comm);

    // On Approval, publish/activate Provider in M3 FHIR Directory automatically
    let practitionerId: string | undefined;
    if (outcome === 'Approved') {
      const loc = app.locations[0];
      const created = await providerService.createOrUpdateProvider(
        ctx,
        {
          prefix: app.applicantPrefix,
          given: app.applicantGiven,
          family: app.applicantFamily,
          npi: app.npi,
          medicaidId: app.priorMedicaidId,
          providerType: app.providerType,
          taxonomyCode: app.taxonomyCode,
          specialty: app.specialty,
          licenseNumber: app.licenseNumber,
          licenseState: app.licenseState,
          status: 'Active',
          acceptingNewPatients: loc?.acceptingNewPatients ?? true,
          street: loc?.street ?? '100 Main St',
          city: loc?.city ?? 'Albany',
          state: loc?.state ?? 'NY',
          postalCode: loc?.postalCode ?? '12207',
          phone: app.applicantPhone,
          email: app.applicantEmail,
          tin: app.tin,
          dob: app.dob,
          organizationName: app.organizationName,
        },
        approver,
      );
      practitionerId = created.provider.id;
    }

    enrollmentService.transitionStatus(
      ctx.tenantId,
      app.id,
      outcome,
      `${approver.name} (${approver.role})`,
      outcome === 'Approved'
        ? `Approved effective ${effectiveDate} (Provenance/${createdProv.id}).`
        : `Denied (${(input.reasonCodes ?? []).join(', ')}) (Provenance/${createdProv.id}).`,
    );

    const decision: DecisionRecord = {
      id: `dec-${Date.now().toString(36)}`,
      applicationId: app.id,
      applicationNumber: app.applicationNumber,
      providerName: `${app.applicantGiven} ${app.applicantFamily}`,
      npi: app.npi,
      outcome,
      effectiveDate: outcome === 'Approved' ? effectiveDate : undefined,
      reasonCodes: input.reasonCodes ?? [],
      notes: input.notes,
      decidedBy: requestedByLabel,
      approvedBy: `${approver.name} (${approver.role})`,
      decidedAt: new Date().toISOString(),
      letterText,
      provenanceId: createdProv.id,
    };
    st.decisions.unshift(decision);

    await auditService.record({
      ctx,
      actorName: approver.name,
      actorRole: approver.role,
      action: 'update',
      resourceType: 'Task',
      resourceId: app.taskId,
      outcomeDesc: `Determination ${outcome} for ${app.applicationNumber} (NPI ${app.npi})`,
    });

    eventBus.publish({
      type: outcome === 'Approved' ? 'ProviderApproved' : 'ProviderDenied',
      tenantId: ctx.tenantId,
      sourceModule: 'M8',
      payload: {
        applicationId: app.id,
        applicationNumber: app.applicationNumber,
        practitionerId,
        providerName: decision.providerName,
        npi: app.npi,
        providerType: app.providerType,
        effectiveDate,
        stateCode: app.licenseState || 'NY',
        reasonCodes: input.reasonCodes ?? [],
      },
    });

    return decision;
  },

  async pendWithRfi(
    ctx: FhirRequestContext,
    applicationId: string,
    deficiencies: string[],
    dueDate: string,
    notes: string,
    actor: { name: string; role: RoleName },
  ): Promise<FhirCommunication> {
    if (deficiencies.length === 0) {
      throw new AppError({ message: 'Select at least one deficiency.', statusCode: 400, code: 'DEFICIENCY_REQUIRED' });
    }
    enrollmentService.addRfiToApplication(
      ctx.tenantId,
      applicationId,
      { deficiencies, dueDate, notes },
      `${actor.name} (${actor.role})`,
    );
    const client = getFhirClient();
    const comm: FhirCommunication = {
      resourceType: 'Communication',
      status: 'completed',
      category: [{ text: 'RFI Deficiency Notice' }],
      sent: new Date().toISOString(),
      sender: { display: `${actor.name} (${actor.role})` },
      payload: [
        {
          contentString: `RFI issued (due ${dueDate}; reminders scheduled at 7 and 2 days prior): ${deficiencies.join('; ')}. ${notes}`,
        },
      ],
    };
    const created = await client.create(ctx, comm);
    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Communication',
      resourceId: created.id,
      outcomeDesc: `Issued RFI for application ${applicationId} due ${dueDate}`,
    });
    return created;
  },

  fileAppeal(
    tenantId: string,
    applicationId: string,
    reason: string,
    documents: string[],
  ): AppealRecord {
    const app = enrollmentService.getApplicationById(tenantId, applicationId);
    if (!app || app.status !== 'Denied') {
      throw new AppError({
        message: 'Appeals can only be filed for Denied enrollment applications.',
        statusCode: 400,
        code: 'APPEAL_NOT_ELIGIBLE',
      });
    }
    const st = getState(tenantId);
    const now = new Date();
    const windowEnd = new Date(
      now.getTime() + st.policy.appealWindowDays * 24 * 60 * 60 * 1000,
    );
    const appeal: AppealRecord = {
      id: `apl-${Date.now().toString(36)}`,
      applicationId: app.id,
      applicationNumber: app.applicationNumber,
      providerName: `${app.applicantGiven} ${app.applicantFamily}`,
      filedAt: now.toISOString(),
      windowEndsAt: windowEnd.toISOString().slice(0, 10),
      reason,
      supportingDocuments: documents,
      status: 'Open',
    };
    st.appeals.unshift(appeal);
    return appeal;
  },

  async resolveAppeal(
    ctx: FhirRequestContext,
    appealId: string,
    outcome: 'Upheld' | 'Overturned' | 'Remanded',
    resolutionNotes: string,
    actor: { name: string; role: RoleName },
  ): Promise<AppealRecord> {
    const st = getState(ctx.tenantId);
    const appeal = st.appeals.find((a) => a.id === appealId);
    if (!appeal) {
      throw new AppError({ message: 'Appeal not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    appeal.status = outcome;
    appeal.resolutionNotes = resolutionNotes;
    appeal.decidedBy = `${actor.name} (${actor.role})`;
    appeal.decidedAt = new Date().toISOString();

    if (outcome === 'Overturned' || outcome === 'Remanded') {
      enrollmentService.transitionStatus(
        ctx.tenantId,
        appeal.applicationId,
        'In Review',
        `${actor.name} (${actor.role})`,
        `Appeal ${appeal.id} ${outcome}: case re-opened into In Review.`,
      );
    }

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Task',
      resourceId: appeal.applicationId,
      outcomeDesc: `Resolved appeal ${appeal.id} with outcome ${outcome}`,
    });
    return appeal;
  },
};
