import { eventBus } from '../../events';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { auditService } from '../../services';
import { tenantService } from '../../tenancy';
import {
  AppError,
  type FhirBundle,
  type FhirDocumentReference,
  type FhirPractitioner,
  type FhirProvenance,
  type FhirTask,
  type RoleName,
} from '../../types';
import { providerService } from '../m3-directory/providerService';
import { planService } from '../m23-plans/planService';

export type PsvResult = 'Pending' | 'Verified' | 'Flagged';

export interface PsvChecklistItem {
  id: string;
  category:
    | 'Education'
    | 'Training / Residency'
    | 'Board Certification'
    | 'State License'
    | '5-Year Work History'
    | 'Malpractice History'
    | 'Sanctions & Exclusions'
    | 'Hospital Privileges';
  source: string;
  verifiedDate?: string;
  verifier?: string;
  result: PsvResult;
  documentName?: string;
  documentReferenceId?: string;
  notes?: string;
}

export interface CommitteeVote {
  id: string;
  voterName: string;
  voterRole: RoleName;
  vote: 'Approve' | 'Defer' | 'Deny';
  comment: string;
  votedAt: string;
}

export type CredentialingFileStatus =
  | 'In Progress'
  | 'Clean - Auto Approved'
  | 'Committee Review'
  | 'Committee Approved'
  | 'Committee Deferred'
  | 'Committee Denied';

export interface CredentialingFile {
  id: string;
  practitionerId: string;
  providerName: string;
  npi: string;
  specialty: string;
  status: CredentialingFileStatus;
  createdAt: string;
  completedAt?: string;
  nextRecredentialingDue?: string;
  psvItems: PsvChecklistItem[];
  committeeAgenda?: string;
  committeeMeetingDate?: string;
  committeeNotes?: string;
  votes: CommitteeVote[];
  taskId?: string;
  provenanceId?: string;
}

export interface ContractTemplate {
  id: string;
  program: 'FFS' | 'Managed Care' | 'CHIP';
  name: string;
  version: string;
  bodyTemplate: string;
}

export interface ProviderContractRecord {
  id: string;
  practitionerId: string;
  providerName: string;
  npi: string;
  templateId: string;
  templateName: string;
  program: 'FFS' | 'Managed Care' | 'CHIP';
  planId: string;
  planName: string;
  networkId?: string;
  networkName?: string;
  rateScheduleName: string;
  effectiveStart: string;
  effectiveEnd: string;
  status: 'Draft' | 'Sent' | 'Signed' | 'Active' | 'Amended';
  renderedText: string;
  signedBy?: string;
  signedAt?: string;
  documentReferenceId?: string;
  amendments: Array<{
    id: string;
    title: string;
    effectiveDate: string;
    summary: string;
    addedBy: string;
  }>;
}

export interface SharedCredentialingRecord {
  id: string;
  fileId: string;
  providerName: string;
  targetPlanId: string;
  targetPlanName: string;
  sharedAt: string;
  sharedBy: string;
  resourceCount: number;
  provenanceId?: string;
  bundleJson: string;
}

interface TenantCredentialingState {
  recredentialingMonths: number;
  files: CredentialingFile[];
  templates: ContractTemplate[];
  contracts: ProviderContractRecord[];
  sharedPackets: SharedCredentialingRecord[];
}

const DEFAULT_PSV_CATEGORIES: Array<{
  category: PsvChecklistItem['category'];
  defaultSource: string;
}> = [
  { category: 'Education', defaultSource: 'AMA Physician Masterfile / ECFMG' },
  { category: 'Training / Residency', defaultSource: 'ACGME Program Verification' },
  { category: 'Board Certification', defaultSource: 'ABMS / AOA CertiFACTS' },
  { category: 'State License', defaultSource: 'State Medical Licensing Board' },
  { category: '5-Year Work History', defaultSource: 'CAQH ProView / Employer Attestation' },
  { category: 'Malpractice History', defaultSource: 'NPDB Continuous Query & COI' },
  { category: 'Sanctions & Exclusions', defaultSource: 'OIG-LEIE / SAM.gov / State Medicaid' },
  { category: 'Hospital Privileges', defaultSource: 'Primary Admitting Hospital Medical Staff Office' },
];

const DEFAULT_TEMPLATES: ContractTemplate[] = [
  {
    id: 'tpl-ffs-2026',
    program: 'FFS',
    name: 'State Medicaid Fee-For-Service Provider Agreement',
    version: '2026.1',
    bodyTemplate: [
      'MEDICAID FEE-FOR-SERVICE PARTICIPATING PROVIDER AGREEMENT',
      'Agency: {{tenantName}}',
      'Provider: {{providerName}} (NPI: {{npi}})',
      'Plan: {{planName}} | Fee Schedule: {{rateSchedule}}',
      'Term: {{effectiveStart}} through {{effectiveEnd}}',
      '1. Compliance: Provider agrees to 42 CFR Part 455 enrollment, screening, and record-retention requirements.',
      '2. Reimbursement: Agency reimburses covered services per the effective fee schedule published in M23.',
      '3. Termination: Either party may terminate with 30 days written notice; immediate suspension applies upon OIG/SAM exclusion.',
    ].join('\n'),
  },
  {
    id: 'tpl-mco-2026',
    program: 'Managed Care',
    name: 'Managed Care Organization (MCO) Participating Agreement',
    version: '2026.2',
    bodyTemplate: [
      'MANAGED CARE NETWORK PROVIDER PARTICIPATION AGREEMENT',
      'Tenant / Agency: {{tenantName}}',
      'Provider: {{providerName}} (NPI: {{npi}})',
      'Managed Care Plan: {{planName}} | Rate Schedule: {{rateSchedule}}',
      'Effective Period: {{effectiveStart}} to {{effectiveEnd}}',
      '1. Network Adequacy: Provider maintains accurate directory availability and timely access standards.',
      '2. Credentialing: Continued participation is contingent upon 36-month NCQA-aligned recredentialing.',
      '3. Claims & Prior Authorization: Provider submits X12 837 claims and complies with M23 prior authorization rules.',
    ].join('\n'),
  },
  {
    id: 'tpl-chip-2026',
    program: 'CHIP',
    name: 'ChildHealth Plus (CHIP) Pediatric Provider Agreement',
    version: '2026.1',
    bodyTemplate: [
      'CHILD HEALTH INSURANCE PROGRAM (CHIP) PROVIDER AGREEMENT',
      'Sponsor: {{tenantName}}',
      'Provider: {{providerName}} (NPI: {{npi}})',
      'Plan: {{planName}} | Fee Schedule: {{rateSchedule}}',
      'Effective Dates: {{effectiveStart}} – {{effectiveEnd}}',
      '1. EPSDT & Preventive Care: Provider adheres to pediatric immunization and EPSDT periodicity schedules.',
      '2. Non-Balance Billing: Provider accepts CHIP contracted rates as payment in full.',
    ].join('\n'),
  },
];

const tenantCredentialingStore = new Map<string, TenantCredentialingState>();

function addMonthsIso(baseDateIso: string, months: number): string {
  const dt = new Date(baseDateIso);
  dt.setMonth(dt.getMonth() + months);
  return dt.toISOString().slice(0, 10);
}

function buildPsvChecklist(
  preset: 'clean' | 'flagged' | 'in-progress',
): PsvChecklistItem[] {
  const today = new Date().toISOString().slice(0, 10);
  return DEFAULT_PSV_CATEGORIES.map((item, idx) => {
    let result: PsvResult = 'Pending';
    let notes = '';
    if (preset === 'clean') {
      result = 'Verified';
      notes = 'Primary source confirmed with zero discrepancies.';
    } else if (preset === 'flagged') {
      result = idx === 5 ? 'Flagged' : 'Verified';
      notes =
        idx === 5
          ? 'One closed 2022 malpractice settlement ($75k) requires committee review.'
          : 'Primary source verified.';
    } else {
      result = idx < 5 ? 'Verified' : 'Pending';
      notes = idx < 5 ? 'Verified via primary source.' : 'Awaiting verification response.';
    }
    return {
      id: `psv-${idx + 1}`,
      category: item.category,
      source: item.defaultSource,
      verifiedDate: result !== 'Pending' ? today : undefined,
      verifier: result !== 'Pending' ? 'Jordan Patel (CredentialingSpecialist)' : undefined,
      result,
      documentName: result !== 'Pending' ? `${item.category.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_psv.pdf` : undefined,
      notes,
    };
  });
}

function buildInitialState(tenantId: string): TenantCredentialingState {
  const isTenantB = tenantId.includes('health-center');
  const today = new Date().toISOString().slice(0, 10);
  const files: CredentialingFile[] = [
    {
      id: `cred-1-${tenantId}`,
      practitionerId: isTenantB ? 'prac-b-1' : 'prac-a-1',
      providerName: isTenantB ? 'Dr. Rachel Goldstein' : 'Dr. Elena Vargas',
      npi: isTenantB ? '1457321980' : '1234567893',
      specialty: 'Family Medicine',
      status: 'Clean - Auto Approved',
      createdAt: '2026-01-10T10:00:00Z',
      completedAt: '2026-01-18T14:00:00Z',
      nextRecredentialingDue: addMonthsIso('2026-01-18', 36),
      psvItems: buildPsvChecklist('clean'),
      votes: [],
    },
    {
      id: `cred-2-${tenantId}`,
      practitionerId: isTenantB ? 'prac-b-2' : 'prac-a-3',
      providerName: isTenantB ? 'PA Mateo Morales' : 'Dr. Amara Okafor',
      npi: isTenantB ? '1568432193' : '1456789011',
      specialty: isTenantB ? 'Family Medicine' : 'Psychiatry',
      status: 'Committee Review',
      createdAt: '2026-02-04T09:30:00Z',
      nextRecredentialingDue: addMonthsIso(today, 36),
      psvItems: buildPsvChecklist('flagged'),
      committeeAgenda: 'Review closed 2022 malpractice claim disclosure and hospital peer reference.',
      committeeMeetingDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      committeeNotes: 'Peer reference favorable; awaiting committee vote.',
      votes: [
        {
          id: 'vote-seed-1',
          voterName: 'Dr. Morgan Avery',
          voterRole: 'AgencyApprover',
          vote: 'Approve',
          comment: 'Single resolved claim with strong remediation and clean license.',
          votedAt: '2026-02-12T15:00:00Z',
        },
      ],
    },
  ];

  return {
    recredentialingMonths: 36,
    files,
    templates: DEFAULT_TEMPLATES.map((t) => ({ ...t })),
    contracts: [],
    sharedPackets: [],
  };
}

function getState(tenantId: string): TenantCredentialingState {
  let st = tenantCredentialingStore.get(tenantId);
  if (!st) {
    st = buildInitialState(tenantId);
    tenantCredentialingStore.set(tenantId, st);
  }
  return st;
}

export function renderContractMergeFields(
  templateBody: string,
  values: {
    tenantName: string;
    providerName: string;
    npi: string;
    planName: string;
    rateSchedule: string;
    effectiveStart: string;
    effectiveEnd: string;
  },
): string {
  return templateBody
    .replaceAll('{{tenantName}}', values.tenantName)
    .replaceAll('{{providerName}}', values.providerName)
    .replaceAll('{{npi}}', values.npi)
    .replaceAll('{{planName}}', values.planName)
    .replaceAll('{{rateSchedule}}', values.rateSchedule)
    .replaceAll('{{effectiveStart}}', values.effectiveStart)
    .replaceAll('{{effectiveEnd}}', values.effectiveEnd);
}

export const credentialingService = {
  getState(tenantId: string): TenantCredentialingState {
    return getState(tenantId);
  },

  resetForTests(tenantId?: string): void {
    if (tenantId) {
      tenantCredentialingStore.delete(tenantId);
    } else {
      tenantCredentialingStore.clear();
    }
  },

  setRecredentialingMonths(tenantId: string, months: number): number {
    const st = getState(tenantId);
    st.recredentialingMonths = Math.max(12, Math.min(60, months));
    return st.recredentialingMonths;
  },

  createCredentialingFile(
    tenantId: string,
    provider: { id: string; fullName: string; npi: string; specialty: string },
  ): CredentialingFile {
    const st = getState(tenantId);
    const existing = st.files.find((f) => f.practitionerId === provider.id);
    if (existing) return existing;

    const created: CredentialingFile = {
      id: `cred-${Date.now().toString(36)}`,
      practitionerId: provider.id,
      providerName: provider.fullName,
      npi: provider.npi,
      specialty: provider.specialty,
      status: 'In Progress',
      createdAt: new Date().toISOString(),
      psvItems: buildPsvChecklist('in-progress'),
      votes: [],
    };
    st.files.unshift(created);
    return created;
  },

  updatePsvItem(
    tenantId: string,
    fileId: string,
    psvId: string,
    patch: Partial<PsvChecklistItem>,
    actorLabel: string,
  ): CredentialingFile {
    const st = getState(tenantId);
    const file = st.files.find((f) => f.id === fileId);
    if (!file) {
      throw new AppError({ message: 'Credentialing file not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    const today = new Date().toISOString().slice(0, 10);
    file.psvItems = file.psvItems.map((item) =>
      item.id === psvId
        ? {
            ...item,
            ...patch,
            verifiedDate: patch.result && patch.result !== 'Pending' ? patch.verifiedDate ?? today : item.verifiedDate,
            verifier: patch.result && patch.result !== 'Pending' ? patch.verifier ?? actorLabel : item.verifier,
          }
        : item,
    );
    return file;
  },

  markAllPsvVerified(
    tenantId: string,
    fileId: string,
    actorLabel: string,
  ): CredentialingFile {
    const st = getState(tenantId);
    const file = st.files.find((f) => f.id === fileId);
    if (!file) {
      throw new AppError({ message: 'Credentialing file not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    const today = new Date().toISOString().slice(0, 10);
    file.psvItems = file.psvItems.map((item) => ({
      ...item,
      result: 'Verified',
      verifiedDate: item.verifiedDate ?? today,
      verifier: item.verifier ?? actorLabel,
      documentName: item.documentName ?? `${item.category.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_psv.pdf`,
      notes: item.notes || 'Primary source verified cleanly.',
    }));
    return file;
  },

  /**
   * Routes a file once all 8 PSV items are resolved:
   * - Clean files (all 8 Verified) auto-approve and emit CredentialingCompleted.
   * - Flagged files route to Credentialing Committee for vote.
   */
  async evaluateAndFinalizeFile(
    ctx: FhirRequestContext,
    fileId: string,
    actor: { name: string; role: RoleName },
  ): Promise<CredentialingFile> {
    const st = getState(ctx.tenantId);
    const file = st.files.find((f) => f.id === fileId);
    if (!file) {
      throw new AppError({ message: 'Credentialing file not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const pendingCount = file.psvItems.filter((i) => i.result === 'Pending').length;
    if (pendingCount > 0) {
      throw new AppError({
        message: `${pendingCount} PSV item(s) are still Pending. Complete all 8 primary source checks first.`,
        statusCode: 400,
        code: 'PSV_INCOMPLETE',
      });
    }

    const flaggedItems = file.psvItems.filter((i) => i.result === 'Flagged');
    if (flaggedItems.length > 0) {
      file.status = 'Committee Review';
      file.committeeAgenda =
        file.committeeAgenda ||
        `Review flagged PSV item(s): ${flaggedItems.map((f) => f.category).join(', ')}.`;
      file.committeeMeetingDate =
        file.committeeMeetingDate ||
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return file;
    }

    // Clean file auto-approval
    return this.completeCredentialing(ctx, file, 'Clean - Auto Approved', actor, 'All 8 PSV items verified cleanly; auto-approved.');
  },

  async recordCommitteeVoteAndDecision(
    ctx: FhirRequestContext,
    fileId: string,
    input: {
      vote: 'Approve' | 'Defer' | 'Deny';
      comment: string;
      committeeNotes?: string;
      finalizeOutcome?: 'Committee Approved' | 'Committee Deferred' | 'Committee Denied';
    },
    actor: { name: string; role: RoleName },
  ): Promise<CredentialingFile> {
    const st = getState(ctx.tenantId);
    const file = st.files.find((f) => f.id === fileId);
    if (!file) {
      throw new AppError({ message: 'Credentialing file not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    file.votes.push({
      id: `vote-${Date.now().toString(36)}`,
      voterName: actor.name,
      voterRole: actor.role,
      vote: input.vote,
      comment: input.comment,
      votedAt: new Date().toISOString(),
    });
    if (input.committeeNotes !== undefined) {
      file.committeeNotes = input.committeeNotes;
    }

    if (input.finalizeOutcome) {
      return this.completeCredentialing(
        ctx,
        file,
        input.finalizeOutcome,
        actor,
        `Committee decision: ${input.finalizeOutcome} (${file.votes.length} recorded vote(s)). ${input.comment}`,
      );
    }
    return file;
  },

  async completeCredentialing(
    ctx: FhirRequestContext,
    file: CredentialingFile,
    finalStatus: CredentialingFileStatus,
    actor: { name: string; role: RoleName },
    summaryNote: string,
  ): Promise<CredentialingFile> {
    const st = getState(ctx.tenantId);
    const client = getFhirClient();
    const now = new Date().toISOString();

    file.status = finalStatus;
    file.completedAt = now;
    if (finalStatus === 'Clean - Auto Approved' || finalStatus === 'Committee Approved') {
      file.nextRecredentialingDue = addMonthsIso(now, st.recredentialingMonths);
    }

    const task: FhirTask = {
      resourceType: 'Task',
      status: finalStatus.includes('Approved') ? 'completed' : 'rejected',
      intent: 'order',
      code: {
        coding: [
          {
            system: 'http://providerlink.local/CodeSystem/task-type',
            code: 'credentialing',
            display: 'Provider Credentialing',
          },
        ],
      },
      for: { reference: `Practitioner/${file.practitionerId}`, display: file.providerName },
      description: `${file.providerName}: ${finalStatus}. ${summaryNote}`,
      authoredOn: file.createdAt,
      lastModified: now,
    };
    const createdTask = await client.create(ctx, task);
    file.taskId = createdTask.id;

    const prov: FhirProvenance = {
      resourceType: 'Provenance',
      target: [{ reference: `Practitioner/${file.practitionerId}`, display: file.providerName }],
      recorded: now,
      reason: [{ text: summaryNote }],
      agent: [{ who: { display: `${actor.name} (${actor.role})` } }],
    };
    const createdProv = await client.create(ctx, prov);
    file.provenanceId = createdProv.id;

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Task',
      resourceId: createdTask.id,
      outcomeDesc: `Credentialing finalized for ${file.providerName}: ${finalStatus}`,
    });

    if (finalStatus === 'Clean - Auto Approved' || finalStatus === 'Committee Approved') {
      eventBus.publish({
        type: 'CredentialingCompleted',
        tenantId: ctx.tenantId,
        sourceModule: 'M9',
        payload: {
          fileId: file.id,
          practitionerId: file.practitionerId,
          providerName: file.providerName,
          npi: file.npi,
          status: finalStatus,
          nextRecredentialingDue: file.nextRecredentialingDue,
        },
      });
    }

    return file;
  },

  exportCommitteeMinutes(tenantId: string, fileId: string): string {
    const st = getState(tenantId);
    const file = st.files.find((f) => f.id === fileId);
    if (!file) return '';
    const flagged = file.psvItems.filter((i) => i.result === 'Flagged');
    return [
      `# Credentialing Committee Minutes — ${file.providerName} (NPI ${file.npi})`,
      `Meeting Date: ${file.committeeMeetingDate ?? new Date().toISOString().slice(0, 10)}`,
      `Status: ${file.status}`,
      `Recredentialing Cycle: ${st.recredentialingMonths} months (Next Due: ${file.nextRecredentialingDue ?? 'TBD'})`,
      '',
      '## Agenda',
      file.committeeAgenda || 'Standard flagged credentialing review.',
      '',
      '## Flagged PSV Findings',
      ...(flagged.length > 0
        ? flagged.map((f) => `- **${f.category}** (${f.source}): ${f.notes ?? 'Flagged'}`)
        : ['- None']),
      '',
      '## Recorded Votes',
      ...(file.votes.length > 0
        ? file.votes.map(
            (v) => `- ${v.voterName} (${v.voterRole}): **${v.vote}** — ${v.comment} [${v.votedAt.slice(0, 10)}]`,
          )
        : ['- No votes recorded yet.']),
      '',
      '## Committee Notes',
      file.committeeNotes || 'None.',
    ].join('\n');
  },

  async createAndSignContract(
    ctx: FhirRequestContext,
    input: {
      practitionerId: string;
      providerName: string;
      npi: string;
      templateId: string;
      planId: string;
      networkId?: string;
      effectiveStart: string;
      effectiveEnd: string;
      signerName: string;
    },
    actor: { name: string; role: RoleName },
  ): Promise<ProviderContractRecord> {
    const st = getState(ctx.tenantId);
    const tpl = st.templates.find((t) => t.id === input.templateId);
    if (!tpl) {
      throw new AppError({ message: 'Contract template not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    const planState = planService.getState(ctx);
    const plan = planState.plans.find((p) => p.id === input.planId) ?? planState.plans[0];
    const network = input.networkId
      ? planState.networks.find((n) => n.id === input.networkId)
      : planState.networks.find((n) => n.planId === plan?.id);
    const rateSchedule =
      planState.rateSchedules.find((rs) => plan && rs.assignedPlanIds.includes(plan.id)) ??
      planState.rateSchedules[0];
    const tenant = tenantService.getTenantById(ctx.tenantId);

    const renderedText = renderContractMergeFields(tpl.bodyTemplate, {
      tenantName: tenant?.legalName ?? 'State Medicaid Agency',
      providerName: input.providerName,
      npi: input.npi,
      planName: plan?.name ?? input.planId,
      rateSchedule: rateSchedule ? `${rateSchedule.name} (v${rateSchedule.version})` : 'Standard Schedule',
      effectiveStart: input.effectiveStart,
      effectiveEnd: input.effectiveEnd,
    });

    const now = new Date().toISOString();
    const client = getFhirClient();
    const docRef: FhirDocumentReference = {
      resourceType: 'DocumentReference',
      status: 'current',
      type: { text: tpl.name },
      subject: { reference: `Practitioner/${input.practitionerId}`, display: input.providerName },
      date: now,
      description: `Executed Provider Contract (${tpl.program}) signed by ${input.signerName}`,
      content: [
        {
          attachment: {
            contentType: 'text/plain',
            title: `${tpl.program}_${input.npi}_contract.txt`,
            creation: now,
          },
        },
      ],
    };
    const createdDoc = await client.create(ctx, docRef);

    // Link network assignment directly into M23 Plan Management
    if (network) {
      planService.assignProvidersToNetwork(ctx, network.id, [input.practitionerId]);
    }

    const record: ProviderContractRecord = {
      id: `m9ctr-${Date.now().toString(36)}`,
      practitionerId: input.practitionerId,
      providerName: input.providerName,
      npi: input.npi,
      templateId: tpl.id,
      templateName: tpl.name,
      program: tpl.program,
      planId: plan?.id ?? input.planId,
      planName: plan?.name ?? input.planId,
      networkId: network?.id,
      networkName: network?.name,
      rateScheduleName: rateSchedule?.name ?? 'Standard Fee Schedule',
      effectiveStart: input.effectiveStart,
      effectiveEnd: input.effectiveEnd,
      status: 'Active',
      renderedText,
      signedBy: input.signerName,
      signedAt: now,
      documentReferenceId: createdDoc.id,
      amendments: [],
    };
    st.contracts.unshift(record);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'DocumentReference',
      resourceId: createdDoc.id,
      outcomeDesc: `Executed ${tpl.program} contract for ${input.providerName} and assigned to ${network?.name ?? plan?.name}`,
    });

    eventBus.publish({
      type: 'ContractSigned',
      tenantId: ctx.tenantId,
      sourceModule: 'M9',
      payload: {
        contractId: record.id,
        practitionerId: record.practitionerId,
        providerName: record.providerName,
        planId: record.planId,
        networkId: record.networkId,
        program: record.program,
      },
    });

    return record;
  },

  addContractAmendment(
    tenantId: string,
    contractId: string,
    amendment: { title: string; effectiveDate: string; summary: string },
    actorLabel: string,
  ): ProviderContractRecord {
    const st = getState(tenantId);
    const ctr = st.contracts.find((c) => c.id === contractId);
    if (!ctr) {
      throw new AppError({ message: 'Contract not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    ctr.amendments.unshift({
      ...amendment,
      id: `amd-${Date.now().toString(36)}`,
      addedBy: actorLabel,
    });
    ctr.status = 'Amended';
    return ctr;
  },

  /**
   * Share Credentialing with Plan: packages Practitioner + credentialing Task + PSV DocumentReferences + Provenance into a FHIR Bundle.
   */
  async shareCredentialingWithPlan(
    ctx: FhirRequestContext,
    fileId: string,
    targetPlanId: string,
    actor: { name: string; role: RoleName },
  ): Promise<SharedCredentialingRecord> {
    const st = getState(ctx.tenantId);
    const file = st.files.find((f) => f.id === fileId);
    if (!file) {
      throw new AppError({ message: 'Credentialing file not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    const planState = planService.getState(ctx);
    const plan = planState.plans.find((p) => p.id === targetPlanId) ?? planState.plans[0];
    const client = getFhirClient();
    const now = new Date().toISOString();

    let practitioner: FhirPractitioner | undefined;
    try {
      practitioner = await client.read<FhirPractitioner>(ctx, 'Practitioner', file.practitionerId);
    } catch {
      const all = await providerService.listProviders(ctx);
      practitioner = all.find((p) => p.npi === file.npi)?.resource;
    }

    const psvDoc: FhirDocumentReference = {
      resourceType: 'DocumentReference',
      id: `psv-summary-${file.id}`,
      status: 'current',
      type: { text: 'NCQA Primary Source Verification Packet' },
      subject: { reference: `Practitioner/${file.practitionerId}`, display: file.providerName },
      date: now,
      description: `8-item PSV packet (${file.status}), next recredentialing ${file.nextRecredentialingDue ?? 'TBD'}`,
      content: [
        {
          attachment: {
            contentType: 'application/json',
            title: `${file.npi}_psv_packet.json`,
            creation: now,
          },
        },
      ],
    };

    const prov = await client.create<FhirProvenance>(ctx, {
      resourceType: 'Provenance',
      target: [{ reference: `Practitioner/${file.practitionerId}`, display: file.providerName }],
      recorded: now,
      reason: [{ text: `Shared delegated credentialing packet with ${plan?.name ?? targetPlanId}` }],
      agent: [{ who: { display: `${actor.name} (${actor.role})` } }],
    });

    const entries: NonNullable<FhirBundle['entry']> = [];
    if (practitioner) {
      entries.push({ fullUrl: `Practitioner/${practitioner.id}`, resource: practitioner });
    }
    entries.push({ fullUrl: `DocumentReference/${psvDoc.id}`, resource: psvDoc });
    entries.push({ fullUrl: `Provenance/${prov.id}`, resource: prov });

    const bundle: FhirBundle = {
      resourceType: 'Bundle',
      type: 'collection',
      timestamp: now,
      total: entries.length,
      entry: entries,
    };

    const record: SharedCredentialingRecord = {
      id: `share-${Date.now().toString(36)}`,
      fileId: file.id,
      providerName: file.providerName,
      targetPlanId: plan?.id ?? targetPlanId,
      targetPlanName: plan?.name ?? targetPlanId,
      sharedAt: now,
      sharedBy: `${actor.name} (${actor.role})`,
      resourceCount: entries.length,
      provenanceId: prov.id,
      bundleJson: JSON.stringify(bundle, null, 2),
    };
    st.sharedPackets.unshift(record);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'export',
      resourceType: 'Bundle',
      resourceId: prov.id,
      outcomeDesc: `Shared credentialing FHIR Bundle (${entries.length} resources) for ${file.providerName} with ${record.targetPlanName}`,
    });

    return record;
  },
};
