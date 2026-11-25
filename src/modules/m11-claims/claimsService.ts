import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { auditService } from '../../services';
import {
  AppError,
  type FhirClaim,
  type FhirClaimResponse,
  type FhirPaymentReconciliation,
  type RoleName,
} from '../../types';
import { providerService } from '../m3-directory/providerService';
import { providerOpsService } from '../m22-provider-ops/providerOpsService';
import { planService } from '../m23-plans/planService';

export type ClaimDecision = 'Paid' | 'Denied' | 'Pended';

export interface ClaimServiceLineInput {
  code: string;
  modifier?: string;
  description?: string;
  diagnosisCode: string;
  units: number;
  billedUsd: number;
  dateOfService: string;
}

export interface ClaimSubmissionInput {
  patientId: string;
  patientName: string;
  billingProviderId: string;
  renderingProviderId: string;
  planId: string;
  priorAuthNumber?: string;
  lines: ClaimServiceLineInput[];
}

export interface PipelineStageTrace {
  stage:
    | '1. Edit Checks'
    | '2. Member Eligibility (M23 Coverage)'
    | '3. Provider Enrollment (M3 Active)'
    | '4. Network Participation (M22/M23)'
    | '5. Prior Authorization (M23 Rules)'
    | '6. Pricing (M23 Rate Schedule)';
  status: 'Pass' | 'Fail' | 'Pend';
  code?: string;
  detail: string;
}

export interface AdjudicatedLineResult {
  sequence: number;
  code: string;
  modifier: string;
  diagnosisCode: string;
  units: number;
  billedUsd: number;
  allowedUsd: number;
  paidUsd: number;
  adjustmentUsd: number;
  scheduleName?: string;
}

export interface ClaimRecord {
  id: string;
  claimNumber: string;
  patientId: string;
  patientName: string;
  billingProviderId: string;
  billingProviderName: string;
  renderingProviderId: string;
  renderingProviderName: string;
  renderingNpi: string;
  planId: string;
  planName: string;
  dateOfService: string;
  submittedAt: string;
  adjudicatedAt: string;
  daysToPay: number;
  decision: ClaimDecision;
  denialCode?: string;
  denialReason?: string;
  totalBilledUsd: number;
  totalAllowedUsd: number;
  totalPaidUsd: number;
  lines: AdjudicatedLineResult[];
  pipelineTrace: PipelineStageTrace[];
  fhirClaimId?: string;
  fhirClaimResponseId?: string;
  fhirPaymentReconciliationId?: string;
  remittanceSummary?: string;
}

export interface PriorAuthRequest {
  id: string;
  authNumber: string;
  patientId: string;
  patientName: string;
  providerId: string;
  providerName: string;
  planId: string;
  planName: string;
  procedureCode: string;
  clinicalNotes: string;
  status: 'Pending' | 'Approved' | 'Denied';
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface HelpDeskTicket {
  id: string;
  ticketNumber: string;
  providerId: string;
  providerName: string;
  claimNumber?: string;
  category: 'Claim Denial Inquiry' | 'EDI / ERA Remittance' | 'Prior Auth' | 'Enrollment / Network';
  subject: string;
  description: string;
  status: 'Open' | 'In Progress' | 'Resolved';
  createdAt: string;
  resolutionNotes?: string;
}

export interface ClaimsDashboardMetrics {
  totalClaims: number;
  paidCount: number;
  deniedCount: number;
  pendedCount: number;
  totalBilledUsd: number;
  totalPaidUsd: number;
  averageDaysToPay: number;
  denialPareto: Array<{ code: string; count: number; pct: number }>;
}

interface TenantClaimsState {
  claims: ClaimRecord[];
  priorAuths: PriorAuthRequest[];
  tickets: HelpDeskTicket[];
}

const tenantClaimsStore = new Map<string, TenantClaimsState>();

function getState(tenantId: string): TenantClaimsState {
  let st = tenantClaimsStore.get(tenantId);
  if (!st) {
    const isTenantB = tenantId.includes('health-center');
    st = {
      claims: [],
      priorAuths: [
        {
          id: `pa-seed-1-${tenantId}`,
          authNumber: 'PA-2026-1001',
          patientId: isTenantB ? 'pat-b-1' : 'pat-a-1',
          patientName: isTenantB ? 'Marcus Rivera' : 'Jane Doe',
          providerId: isTenantB ? 'prac-b-1' : 'prac-a-1',
          providerName: isTenantB ? 'Dr. Rachel Goldstein' : 'Dr. Elena Vargas',
          planId: isTenantB ? 'plan-ffs-fqhc-network-b' : 'plan-ffs-state-medicaid-a',
          planName: 'State Medicaid Fee-For-Service Core',
          procedureCode: '70551',
          clinicalNotes: 'Refractory migraine > 8 weeks with focal neurological symptoms.',
          status: 'Pending',
          requestedAt: '2026-02-15T11:00:00Z',
        },
      ],
      tickets: [
        {
          id: `tkt-seed-1-${tenantId}`,
          ticketNumber: 'HD-2026-0041',
          providerId: isTenantB ? 'prac-b-1' : 'prac-a-1',
          providerName: isTenantB ? 'Dr. Rachel Goldstein' : 'Dr. Elena Vargas',
          category: 'EDI / ERA Remittance',
          subject: 'Verify 835 electronic remittance routing',
          description: 'Confirm EFT/ERA remittance delivery schedule for Q1 2026 claims.',
          status: 'Open',
          createdAt: '2026-02-20T14:20:00Z',
        },
      ],
    };
    tenantClaimsStore.set(tenantId, st);
  }
  return st;
}

export const claimsService = {
  getState(tenantId: string): TenantClaimsState {
    return getState(tenantId);
  },

  resetForTests(tenantId?: string): void {
    if (tenantId) {
      tenantClaimsStore.delete(tenantId);
    } else {
      tenantClaimsStore.clear();
    }
  },

  /**
   * Executes the strict 6-stage claim adjudication pipeline:
   * 1) Edit checks
   * 2) Member eligibility (M23 Coverage)
   * 3) Provider active enrollment on DOS (M3 -> PROVIDER_NOT_ACTIVE if Suspended/Terminated)
   * 4) Network participation (M23 networks / M22 participations)
   * 5) Prior authorization (M23 priorAuthRules + M11 approved PA)
   * 6) Fee schedule pricing (M23 lookupEffectiveRate)
   * Persists FHIR Claim, ClaimResponse, and (when Paid) PaymentReconciliation.
   */
  async submitAndAdjudicateClaim(
    ctx: FhirRequestContext,
    input: ClaimSubmissionInput,
    actor: { name: string; role: RoleName },
  ): Promise<ClaimRecord> {
    const st = getState(ctx.tenantId);
    const planState = planService.getState(ctx);
    const plan = planState.plans.find((p) => p.id === input.planId);
    const providers = await providerService.listProviders(ctx);
    const rendering = providers.find((p) => p.id === input.renderingProviderId);
    const billing = providers.find((p) => p.id === input.billingProviderId) ?? rendering;

    const now = new Date().toISOString();
    const claimNumber = `CLM-${new Date().getFullYear()}-${String(10000 + st.claims.length + 1)}`;
    const primaryDos = input.lines[0]?.dateOfService || now.slice(0, 10);
    const totalBilledUsd = Number(
      input.lines.reduce((acc, l) => acc + l.billedUsd * Math.max(1, l.units), 0).toFixed(2),
    );

    const trace: PipelineStageTrace[] = [];
    let decision: ClaimDecision = 'Paid';
    let denialCode: string | undefined;
    let denialReason: string | undefined;

    // Stage 1: Edit Checks
    const editErrors: string[] = [];
    if (!input.patientId) editErrors.push('Patient is required.');
    if (!input.planId || !plan) editErrors.push('Valid InsurancePlan is required.');
    if (!input.lines || input.lines.length === 0) editErrors.push('At least one service line is required.');
    for (const [idx, line] of input.lines.entries()) {
      if (!line.code.trim()) editErrors.push(`Line ${idx + 1}: CPT/HCPCS code required.`);
      if (!line.diagnosisCode.trim()) editErrors.push(`Line ${idx + 1}: ICD-10 diagnosis required.`);
      if (line.units <= 0 || line.billedUsd <= 0) editErrors.push(`Line ${idx + 1}: Units and billed charges must be > 0.`);
    }
    if (editErrors.length > 0) {
      trace.push({
        stage: '1. Edit Checks',
        status: 'Fail',
        code: 'EDIT_CHECK_FAILED',
        detail: editErrors.join(' '),
      });
      decision = 'Denied';
      denialCode = 'EDIT_CHECK_FAILED';
      denialReason = editErrors.join(' ');
    } else {
      trace.push({
        stage: '1. Edit Checks',
        status: 'Pass',
        detail: `${input.lines.length} service line(s) passed structural & coding edits.`,
      });
    }

    // Stage 2: Eligibility via M23 Coverage
    let coverageRef = `Coverage/cov-${input.patientId}`;
    if (decision === 'Paid') {
      const elig = await planService.checkMemberEligibility(
        ctx,
        input.patientId,
        input.planId,
        primaryDos,
      );
      if (!elig.eligible) {
        trace.push({
          stage: '2. Member Eligibility (M23 Coverage)',
          status: 'Fail',
          code: 'MEMBER_NOT_ELIGIBLE',
          detail: elig.reason,
        });
        decision = 'Denied';
        denialCode = 'MEMBER_NOT_ELIGIBLE';
        denialReason = elig.reason;
      } else {
        if (elig.coverage?.id) {
          coverageRef = `Coverage/${elig.coverage.id}`;
        }
        trace.push({
          stage: '2. Member Eligibility (M23 Coverage)',
          status: 'Pass',
          detail: elig.reason,
        });
      }
    }

    // Stage 3: Provider Enrollment Active on Date of Service (M3)
    if (decision === 'Paid') {
      if (!rendering || !billing) {
        const msg = 'Rendering or billing provider not found in M3 Provider Directory.';
        trace.push({
          stage: '3. Provider Enrollment (M3 Active)',
          status: 'Fail',
          code: 'PROVIDER_NOT_ACTIVE',
          detail: msg,
        });
        decision = 'Denied';
        denialCode = 'PROVIDER_NOT_ACTIVE';
        denialReason = msg;
      } else if (rendering.status !== 'Active' || billing.status !== 'Active') {
        const msg = `Provider enrollment is not Active on ${primaryDos} (Rendering: ${rendering.fullName} = ${rendering.status}; Billing: ${billing.fullName} = ${billing.status}).`;
        trace.push({
          stage: '3. Provider Enrollment (M3 Active)',
          status: 'Fail',
          code: 'PROVIDER_NOT_ACTIVE',
          detail: msg,
        });
        decision = 'Denied';
        denialCode = 'PROVIDER_NOT_ACTIVE';
        denialReason = msg;
      } else {
        trace.push({
          stage: '3. Provider Enrollment (M3 Active)',
          status: 'Pass',
          detail: `Rendering (${rendering.fullName}, NPI ${rendering.npi}) & Billing active on ${primaryDos}.`,
        });
      }
    }

    // Stage 4: Network Participation (M23 networks or M22 networkParticipations)
    if (decision === 'Paid' && rendering) {
      const inM23Network = planState.networks.some(
        (n) =>
          n.planId === input.planId &&
          (n.assignedProviderIds.includes(rendering.id) ||
            (billing && n.assignedProviderIds.includes(billing.id))),
      );
      const opsState = providerOpsService.getState(ctx.tenantId);
      const inM22Participation = opsState.networkParticipations.some(
        (np) =>
          np.planId === input.planId &&
          np.status === 'Participating' &&
          (np.practitionerId === rendering.id || (billing && np.practitionerId === billing.id)),
      );

      if (!inM23Network && !inM22Participation) {
        const msg = `${rendering.fullName} is not assigned to an active network for ${plan?.name ?? input.planId}; pended for out-of-network review.`;
        trace.push({
          stage: '4. Network Participation (M22/M23)',
          status: 'Pend',
          code: 'OUT_OF_NETWORK_REVIEW',
          detail: msg,
        });
        decision = 'Pended';
        denialCode = 'OUT_OF_NETWORK_REVIEW';
        denialReason = msg;
      } else {
        trace.push({
          stage: '4. Network Participation (M22/M23)',
          status: 'Pass',
          detail: `Verified active in-network participation for ${plan?.name ?? input.planId}.`,
        });
      }
    }

    // Stage 5: Prior Authorization (M23 priorAuthRules + M11 approved PA)
    if (decision === 'Paid' && rendering) {
      const requiredRule = input.lines
        .map((line) =>
          planState.priorAuthRules.find(
            (r) => r.planId === input.planId && r.code === line.code.trim(),
          ),
        )
        .find(Boolean);

      if (requiredRule) {
        const approvedPa = st.priorAuths.find(
          (pa) =>
            pa.status === 'Approved' &&
            pa.procedureCode === requiredRule.code &&
            pa.planId === input.planId &&
            (pa.patientId === input.patientId ||
              (input.priorAuthNumber && pa.authNumber === input.priorAuthNumber.trim())),
        );
        if (!approvedPa) {
          const msg = `Procedure ${requiredRule.code} (${requiredRule.description}) requires an Approved Prior Authorization under ${plan?.name ?? input.planId}.`;
          trace.push({
            stage: '5. Prior Authorization (M23 Rules)',
            status: 'Fail',
            code: 'PRIOR_AUTH_REQUIRED',
            detail: msg,
          });
          decision = 'Denied';
          denialCode = 'PRIOR_AUTH_REQUIRED';
          denialReason = msg;
        } else {
          trace.push({
            stage: '5. Prior Authorization (M23 Rules)',
            status: 'Pass',
            detail: `Matched Approved Prior Auth ${approvedPa.authNumber} for ${requiredRule.code}.`,
          });
        }
      } else {
        trace.push({
          stage: '5. Prior Authorization (M23 Rules)',
          status: 'Pass',
          detail: 'No prior authorization required for submitted procedure code(s).',
        });
      }
    }

    // Stage 6: Pricing from M23 Rate Schedules
    const adjudicatedLines: AdjudicatedLineResult[] = [];
    let totalAllowedUsd = 0;
    let totalPaidUsd = 0;

    if (decision === 'Paid' && rendering) {
      let missingRateCode: string | undefined;
      for (const [idx, line] of input.lines.entries()) {
        const rate = planService.lookupEffectiveRate(ctx, {
          code: line.code.trim(),
          modifier: line.modifier?.trim() ?? '',
          planId: input.planId,
          providerType: rendering.providerType,
          dateOfService: line.dateOfService,
        });
        const lineBilled = Number((line.billedUsd * line.units).toFixed(2));
        if (!rate.found || rate.rateUsd === undefined) {
          missingRateCode = line.code;
          adjudicatedLines.push({
            sequence: idx + 1,
            code: line.code,
            modifier: line.modifier ?? '',
            diagnosisCode: line.diagnosisCode,
            units: line.units,
            billedUsd: lineBilled,
            allowedUsd: 0,
            paidUsd: 0,
            adjustmentUsd: lineBilled,
          });
        } else {
          const allowed = Number(Math.min(lineBilled, rate.rateUsd * line.units).toFixed(2));
          const adj = Number(Math.max(0, lineBilled - allowed).toFixed(2));
          totalAllowedUsd += allowed;
          totalPaidUsd += allowed;
          adjudicatedLines.push({
            sequence: idx + 1,
            code: line.code,
            modifier: line.modifier ?? '',
            diagnosisCode: line.diagnosisCode,
            units: line.units,
            billedUsd: lineBilled,
            allowedUsd: allowed,
            paidUsd: allowed,
            adjustmentUsd: adj,
            scheduleName: rate.scheduleName,
          });
        }
      }

      if (missingRateCode) {
        const msg = `No effective M23 fee schedule rate found for code ${missingRateCode} on ${primaryDos}; pended for manual pricing.`;
        trace.push({
          stage: '6. Pricing (M23 Rate Schedule)',
          status: 'Pend',
          code: 'RATE_NOT_FOUND',
          detail: msg,
        });
        decision = 'Pended';
        denialCode = 'RATE_NOT_FOUND';
        denialReason = msg;
        totalAllowedUsd = 0;
        totalPaidUsd = 0;
      } else {
        totalAllowedUsd = Number(totalAllowedUsd.toFixed(2));
        totalPaidUsd = Number(totalPaidUsd.toFixed(2));
        trace.push({
          stage: '6. Pricing (M23 Rate Schedule)',
          status: 'Pass',
          detail: `Priced from M23 rate schedule: Allowed $${totalAllowedUsd.toFixed(2)}, Paid $${totalPaidUsd.toFixed(2)}.`,
        });
      }
    } else {
      for (const [idx, line] of input.lines.entries()) {
        const lineBilled = Number((line.billedUsd * line.units).toFixed(2));
        adjudicatedLines.push({
          sequence: idx + 1,
          code: line.code,
          modifier: line.modifier ?? '',
          diagnosisCode: line.diagnosisCode,
          units: line.units,
          billedUsd: lineBilled,
          allowedUsd: 0,
          paidUsd: 0,
          adjustmentUsd: lineBilled,
        });
      }
    }

    // Persist FHIR Claim, ClaimResponse, and PaymentReconciliation
    const client = getFhirClient();
    const fhirClaim: FhirClaim = {
      resourceType: 'Claim',
      identifier: [{ system: 'http://providerlink.local/sid/claim-number', value: claimNumber }],
      status: 'active',
      type: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/claim-type',
            code: 'professional',
            display: 'Professional',
          },
        ],
      },
      use: 'claim',
      patient: { reference: `Patient/${input.patientId}`, display: input.patientName },
      created: now,
      insurer: { reference: `InsurancePlan/${input.planId}`, display: plan?.name },
      provider: {
        reference: `Practitioner/${input.renderingProviderId}`,
        display: rendering?.fullName,
      },
      priority: { coding: [{ code: 'normal' }] },
      diagnosis: input.lines.map((l, idx) => ({
        sequence: idx + 1,
        diagnosisCodeableConcept: {
          coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: l.diagnosisCode }],
        },
      })),
      insurance: [{ sequence: 1, focal: true, coverage: { reference: coverageRef } }],
      item: input.lines.map((l, idx) => ({
        sequence: idx + 1,
        productOrService: {
          coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: l.code, display: l.description }],
        },
        servicedDate: l.dateOfService,
        quantity: { value: l.units },
        unitPrice: { value: l.billedUsd, currency: 'USD' },
        net: { value: Number((l.billedUsd * l.units).toFixed(2)), currency: 'USD' },
      })),
      total: { value: totalBilledUsd, currency: 'USD' },
    };
    const createdClaim = await client.create(ctx, fhirClaim);

    const fhirResp: FhirClaimResponse = {
      resourceType: 'ClaimResponse',
      status: 'active',
      type: fhirClaim.type,
      use: 'claim',
      patient: fhirClaim.patient,
      created: now,
      insurer: { reference: `InsurancePlan/${input.planId}`, display: plan?.name ?? input.planId },
      request: { reference: `Claim/${createdClaim.id}` },
      outcome: decision === 'Paid' ? 'complete' : decision === 'Denied' ? 'error' : 'queued',
      disposition:
        decision === 'Paid'
          ? `Paid $${totalPaidUsd.toFixed(2)} per M23 fee schedule.`
          : denialReason ?? decision,
      total: [
        { category: { text: 'submitted' }, amount: { value: totalBilledUsd, currency: 'USD' } },
        { category: { text: 'benefit' }, amount: { value: totalPaidUsd, currency: 'USD' } },
      ],
      ...(denialCode
        ? {
            error: [
              {
                code: {
                  coding: [
                    {
                      system: 'http://providerlink.local/CodeSystem/claim-adjudication-error',
                      code: denialCode,
                      display: denialReason,
                    },
                  ],
                  text: denialReason,
                },
              },
            ],
          }
        : {}),
    };
    const createdResp = await client.create(ctx, fhirResp);

    let paymentReconId: string | undefined;
    let remittanceSummary: string | undefined;
    if (decision === 'Paid') {
      const recon: FhirPaymentReconciliation = {
        resourceType: 'PaymentReconciliation',
        status: 'active',
        created: now,
        paymentIssuer: { reference: `InsurancePlan/${input.planId}`, display: plan?.name },
        paymentDate: now.slice(0, 10),
        paymentAmount: { value: totalPaidUsd, currency: 'USD' },
        outcome: 'complete',
        disposition: `ERA-835 Payment issued for ${claimNumber} to ${billing?.fullName ?? rendering?.fullName}`,
        detail: [
          {
            type: { text: 'payment' },
            request: { reference: `Claim/${createdClaim.id}` },
            response: { reference: `ClaimResponse/${createdResp.id}` },
            date: now.slice(0, 10),
            amount: { value: totalPaidUsd, currency: 'USD' },
          },
        ],
      };
      const createdRecon = await client.create(ctx, recon);
      paymentReconId = createdRecon.id;
      remittanceSummary = `ERA 835 · PaymentReconciliation/${createdRecon.id} · Billed $${totalBilledUsd.toFixed(2)} · Allowed $${totalAllowedUsd.toFixed(2)} · Paid $${totalPaidUsd.toFixed(2)} · Contractual Adj $${(totalBilledUsd - totalPaidUsd).toFixed(2)}`;
    }

    const record: ClaimRecord = {
      id: `m11clm-${Date.now().toString(36)}`,
      claimNumber,
      patientId: input.patientId,
      patientName: input.patientName,
      billingProviderId: billing?.id ?? input.billingProviderId,
      billingProviderName: billing?.fullName ?? input.billingProviderId,
      renderingProviderId: rendering?.id ?? input.renderingProviderId,
      renderingProviderName: rendering?.fullName ?? input.renderingProviderId,
      renderingNpi: rendering?.npi ?? '',
      planId: input.planId,
      planName: plan?.name ?? input.planId,
      dateOfService: primaryDos,
      submittedAt: now,
      adjudicatedAt: now,
      daysToPay: decision === 'Paid' ? 3 : 0,
      decision,
      denialCode,
      denialReason,
      totalBilledUsd,
      totalAllowedUsd,
      totalPaidUsd,
      lines: adjudicatedLines,
      pipelineTrace: trace,
      fhirClaimId: createdClaim.id,
      fhirClaimResponseId: createdResp.id,
      fhirPaymentReconciliationId: paymentReconId,
      remittanceSummary,
    };
    st.claims.unshift(record);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Claim',
      resourceId: createdClaim.id,
      outcomeDesc: `Adjudicated ${claimNumber} -> ${decision}${denialCode ? ` (${denialCode})` : ` ($${totalPaidUsd.toFixed(2)})`}`,
    });

    return record;
  },

  submitPriorAuth(
    tenantId: string,
    input: Omit<PriorAuthRequest, 'id' | 'authNumber' | 'status' | 'requestedAt'>,
  ): PriorAuthRequest {
    const st = getState(tenantId);
    const created: PriorAuthRequest = {
      ...input,
      id: `pa-${Date.now().toString(36)}`,
      authNumber: `PA-${new Date().getFullYear()}-${String(1001 + st.priorAuths.length)}`,
      status: 'Pending',
      requestedAt: new Date().toISOString(),
    };
    st.priorAuths.unshift(created);
    return created;
  },

  decidePriorAuth(
    tenantId: string,
    priorAuthId: string,
    decision: 'Approved' | 'Denied',
    actorLabel: string,
  ): PriorAuthRequest {
    const st = getState(tenantId);
    const pa = st.priorAuths.find((p) => p.id === priorAuthId);
    if (!pa) {
      throw new AppError({ message: 'Prior Authorization request not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    pa.status = decision;
    pa.decidedAt = new Date().toISOString();
    pa.decidedBy = actorLabel;
    return pa;
  },

  createHelpDeskTicket(
    tenantId: string,
    input: Omit<HelpDeskTicket, 'id' | 'ticketNumber' | 'status' | 'createdAt'>,
  ): HelpDeskTicket {
    const st = getState(tenantId);
    const created: HelpDeskTicket = {
      ...input,
      id: `tkt-${Date.now().toString(36)}`,
      ticketNumber: `HD-${new Date().getFullYear()}-${String(100 + st.tickets.length + 1)}`,
      status: 'Open',
      createdAt: new Date().toISOString(),
    };
    st.tickets.unshift(created);
    return created;
  },

  resolveHelpDeskTicket(
    tenantId: string,
    ticketId: string,
    resolutionNotes: string,
  ): HelpDeskTicket {
    const st = getState(tenantId);
    const tkt = st.tickets.find((t) => t.id === ticketId);
    if (!tkt) {
      throw new AppError({ message: 'Ticket not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    tkt.status = 'Resolved';
    tkt.resolutionNotes = resolutionNotes;
    return tkt;
  },

  getDashboardMetrics(tenantId: string): ClaimsDashboardMetrics {
    const st = getState(tenantId);
    const totalClaims = st.claims.length;
    const paid = st.claims.filter((c) => c.decision === 'Paid');
    const denied = st.claims.filter((c) => c.decision === 'Denied');
    const pended = st.claims.filter((c) => c.decision === 'Pended');

    const totalBilledUsd = Number(st.claims.reduce((s, c) => s + c.totalBilledUsd, 0).toFixed(2));
    const totalPaidUsd = Number(paid.reduce((s, c) => s + c.totalPaidUsd, 0).toFixed(2));
    const averageDaysToPay =
      paid.length > 0
        ? Number((paid.reduce((s, c) => s + c.daysToPay, 0) / paid.length).toFixed(1))
        : 0;

    const counts = new Map<string, number>();
    for (const c of [...denied, ...pended]) {
      const code = c.denialCode ?? 'OTHER';
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    const nonPaidTotal = denied.length + pended.length;
    const denialPareto = Array.from(counts.entries())
      .map(([code, count]) => ({
        code,
        count,
        pct: nonPaidTotal > 0 ? Math.round((count / nonPaidTotal) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      totalClaims,
      paidCount: paid.length,
      deniedCount: denied.length,
      pendedCount: pended.length,
      totalBilledUsd,
      totalPaidUsd,
      averageDaysToPay,
      denialPareto,
    };
  },
};
