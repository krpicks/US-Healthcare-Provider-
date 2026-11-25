import { canRoleUnmask } from '../../app/rbac';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { maskSensitiveValue } from '../../rules';
import { auditService } from '../../services/auditService';
import {
  AppError,
  type FhirConsent,
  type RoleName,
} from '../../types';

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  pkceRequired: boolean;
  audience: string;
  scopes: string;
}

export interface SmartScopeEntry {
  scope: string;
  description: string;
  granted: boolean;
}

export interface SessionPolicyState {
  startedAt: number;
  timeoutMinutes: number;
  warningThresholdSeconds: number;
}

export interface BreakGlassSession {
  id: string;
  actorName: string;
  actorRole: RoleName;
  reason: string;
  activatedAt: number;
  expiresAt: number;
  active: boolean;
}

export interface UnmaskEventRecord {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: RoleName;
  targetId: string;
  fieldLabel: string;
  reason: string;
}

export interface SensitiveSampleRecord {
  id: string;
  patientId: string;
  title: string;
  securityLabel: 'PSY' | 'ETH' | 'HIV' | 'SDV' | 'N';
  summary: string;
}

export interface HipaaSafeguardItem {
  id: string;
  citation: string;
  control: string;
  status: 'Compliant' | 'In Progress' | 'Gap';
  owner: string;
  evidenceLink: string;
}

export interface AccessReviewEntry {
  id: string;
  userName: string;
  email: string;
  role: RoleName;
  lastActive: string;
  reviewStatus: 'Pending' | 'Certified' | 'Revoked';
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface RetentionPolicyState {
  medicaidRetentionYears: number;
  auditLogRetentionYears: number;
  legalHoldActive: boolean;
  legalHoldMatter: string;
}

export interface SecurityTenantState {
  session: SessionPolicyState;
  oidc: OidcConfig;
  smartScopes: SmartScopeEntry[];
  breakGlass: BreakGlassSession | null;
  unmaskHistory: UnmaskEventRecord[];
  consents: FhirConsent[];
  sensitiveRecords: SensitiveSampleRecord[];
  hipaaSafeguards: HipaaSafeguardItem[];
  accessReviews: AccessReviewEntry[];
  retention: RetentionPolicyState;
}

export const SECURITY_HYGIENE_NOTES = [
  'Never store OAuth client secrets, signing keys, or database passwords in browser source or localStorage.',
  'Mask SSN, DOB, TIN, and financial account numbers by default; require RBAC check + FHIR AuditEvent on every Unmask.',
  'Enforce tenant isolation via X-Tenant-Id / path partition and verify SMART scopes inside service methods before returning PHI.',
  'Require explicit reason and automatic time expiry (<= 60 min) for Break-Glass emergency overrides.',
  'Keep synthetic data clearly labeled ("Prototype - synthetic data only") and avoid logging PHI/PII to browser console.',
];

const DEFAULT_SCOPES: SmartScopeEntry[] = [
  { scope: 'patient/Patient.read', description: 'Read Patient demographics in clinical views', granted: true },
  { scope: 'patient/Condition.read', description: 'Read Conditions for eCR and UDS+ extraction', granted: true },
  { scope: 'user/Practitioner.write', description: 'Create/update Practitioner enrollment master records', granted: true },
  { scope: 'system/Claim.read', description: 'Read Claim & ClaimResponse adjudication history', granted: true },
  { scope: 'system/Consent.write', description: 'Create and update FHIR Consent directives', granted: true },
  { scope: 'system/AuditEvent.read', description: 'Export compliance audit trails', granted: true },
];

const DEFAULT_SAFEGUARDS: HipaaSafeguardItem[] = [
  {
    id: 'hipaa-1',
    citation: '45 CFR 164.312(a)(1)',
    control: 'Access Control — Unique User ID, RBAC Matrix, Auto Logoff',
    status: 'Compliant',
    owner: 'Security Lead',
    evidenceLink: '/settings#rbac',
  },
  {
    id: 'hipaa-2',
    citation: '45 CFR 164.312(b)',
    control: 'Audit Controls — Immutable FHIR AuditEvent on Access & Unmask',
    status: 'Compliant',
    owner: 'Compliance Officer',
    evidenceLink: '/settings#audit',
  },
  {
    id: 'hipaa-3',
    citation: '45 CFR 164.312(c)(1)',
    control: 'Integrity — SHA-256 Document Digests & Provenance Signatures',
    status: 'Compliant',
    owner: 'Platform Architect',
    evidenceLink: '/enrollment',
  },
  {
    id: 'hipaa-4',
    citation: '45 CFR 164.312(e)(1)',
    control: 'Transmission Security — TLS 1.3 + OIDC PKCE + HSTS',
    status: 'In Progress',
    owner: 'Infrastructure Lead',
    evidenceLink: '/gateway',
  },
  {
    id: 'hipaa-5',
    citation: '45 CFR 164.514(b)',
    control: 'De-Identification Safe Harbor for UDS+ Exports',
    status: 'Compliant',
    owner: 'Data Governance',
    evidenceLink: '/uds-plus',
  },
];

const DEFAULT_SENSITIVE_RECORDS: SensitiveSampleRecord[] = [
  {
    id: 'sens-1',
    patientId: 'pat-jane-doe-state-medicaid-a',
    title: 'Behavioral Health Psychotherapy Note',
    securityLabel: 'PSY',
    summary: '42 CFR Part 2 / Sensitive psychiatry encounter summary.',
  },
  {
    id: 'sens-2',
    patientId: 'pat-jane-doe-state-medicaid-a',
    title: 'Substance Use Disorder Intake',
    securityLabel: 'ETH',
    summary: 'Restricted SUD counseling intake note.',
  },
  {
    id: 'sens-3',
    patientId: 'pat-jane-doe-state-medicaid-a',
    title: 'Routine Hypertension Follow-Up',
    securityLabel: 'N',
    summary: 'Standard ambulatory blood pressure check (unrestricted).',
  },
];

const DEFAULT_ACCESS_REVIEWS: AccessReviewEntry[] = [
  { id: 'ar-1', userName: 'Taylor Brooks', email: 'taylor.brooks@agency.synthetic', role: 'EnrollmentAnalyst', lastActive: '2026-11-24', reviewStatus: 'Pending' },
  { id: 'ar-2', userName: 'Robin Hayes', email: 'robin.hayes@agency.synthetic', role: 'AgencyApprover', lastActive: '2026-11-25', reviewStatus: 'Pending' },
  { id: 'ar-3', userName: 'Samira Ali', email: 'samira.ali@interop.synthetic', role: 'IntegrationEngineer', lastActive: '2026-11-25', reviewStatus: 'Certified', reviewedBy: 'Alex Morgan', reviewedAt: '2026-11-20' },
  { id: 'ar-4', userName: 'Morgan Rivera', email: 'morgan.rivera@agency.synthetic', role: 'ProgramIntegrityOfficer', lastActive: '2026-11-23', reviewStatus: 'Pending' },
];

const storeByTenant = new Map<string, SecurityTenantState>();
let secSeq = 100;

function nextSecId(prefix: string): string {
  secSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${secSeq}`;
}

function getOrInitState(tenantId: string): SecurityTenantState {
  const existing = storeByTenant.get(tenantId);
  if (existing) return existing;

  const initial: SecurityTenantState = {
    session: {
      startedAt: Date.now(),
      timeoutMinutes: 15,
      warningThresholdSeconds: 120,
    },
    oidc: {
      issuerUrl: 'https://idp.synthetic.example/realms/providerlink',
      clientId: `providerlink-spa-${tenantId.slice(0, 12)}`,
      redirectUri: 'http://localhost:3000/auth/callback',
      pkceRequired: true,
      audience: 'https://api.providerlink.synthetic/fhir',
      scopes: 'openid profile email fhirUser launch/patient patient/*.read',
    },
    smartScopes: DEFAULT_SCOPES.map((s) => ({ ...s })),
    breakGlass: null,
    unmaskHistory: [],
    consents: [
      {
        resourceType: 'Consent',
        id: `consent-restrict-psy-${tenantId.slice(0, 8)}`,
        status: 'active',
        scope: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy', display: 'Privacy Consent' }],
        },
        category: [
          {
            coding: [{ system: 'http://loinc.org', code: '59284-0', display: 'Patient Consent' }],
          },
        ],
        patient: { reference: 'Patient/pat-jane-doe-state-medicaid-a', display: 'Jane Doe' },
        dateTime: '2026-01-15T10:00:00Z',
        policyRule: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'OPTIN', display: 'Opt-in sensitive restriction' }],
        },
        provision: {
          type: 'deny',
          securityLabel: [
            { system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality', code: 'PSY', display: 'Psychiatry' },
            { system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality', code: 'ETH', display: 'Substance Abuse' },
          ],
        },
      },
    ],
    sensitiveRecords: DEFAULT_SENSITIVE_RECORDS.map((r) => ({ ...r })),
    hipaaSafeguards: DEFAULT_SAFEGUARDS.map((h) => ({ ...h })),
    accessReviews: DEFAULT_ACCESS_REVIEWS.map((a) => ({ ...a })),
    retention: {
      medicaidRetentionYears: 7,
      auditLogRetentionYears: 10,
      legalHoldActive: false,
      legalHoldMatter: '',
    },
  };
  storeByTenant.set(tenantId, initial);
  return initial;
}

export const securityService = {
  getState(tenantId: string): SecurityTenantState {
    return getOrInitState(tenantId);
  },

  resetForTests(): void {
    storeByTenant.clear();
  },

  extendSession(tenantId: string): SessionPolicyState {
    const st = getOrInitState(tenantId);
    st.session.startedAt = Date.now();
    return st.session;
  },

  simulateSessionExpiringSoon(tenantId: string): SessionPolicyState {
    const st = getOrInitState(tenantId);
    // Put session 60 seconds away from timeout
    st.session.startedAt =
      Date.now() - (st.session.timeoutMinutes * 60 - 60) * 1000;
    return st.session;
  },

  getSessionRemainingSeconds(tenantId: string, now = Date.now()): number {
    const st = getOrInitState(tenantId);
    const expiresAt = st.session.startedAt + st.session.timeoutMinutes * 60_000;
    return Math.max(0, Math.floor((expiresAt - now) / 1000));
  },

  updateOidcConfig(tenantId: string, patch: Partial<OidcConfig>): OidcConfig {
    const st = getOrInitState(tenantId);
    Object.assign(st.oidc, patch);
    return st.oidc;
  },

  toggleSmartScope(tenantId: string, scope: string, granted: boolean): SmartScopeEntry[] {
    const st = getOrInitState(tenantId);
    const found = st.smartScopes.find((s) => s.scope === scope);
    if (found) found.granted = granted;
    return st.smartScopes;
  },

  assertSmartScope(tenantId: string, requiredScope: string): void {
    const st = getOrInitState(tenantId);
    const match = st.smartScopes.find((s) => s.scope === requiredScope && s.granted);
    if (!match) {
      throw new AppError({
        message: `SMART scope "${requiredScope}" is not granted for this session (403 Forbidden).`,
        statusCode: 403,
        code: 'INSUFFICIENT_SCOPE',
      });
    }
  },

  async requestAuditedUnmask(
    ctx: FhirRequestContext,
    input: {
      targetId: string;
      fieldLabel: string;
      rawValue: string;
      kind: 'ssn' | 'tin' | 'dob' | 'bank';
      reason: string;
    },
    actor: { name: string; role: RoleName },
  ): Promise<{ masked: string; unmasked: string; auditRecorded: boolean }> {
    if (!canRoleUnmask(actor.role)) {
      throw new AppError({
        message: `Role ${actor.role} is not authorized to unmask sensitive PII/PHI fields.`,
        statusCode: 403,
        code: 'UNMASK_FORBIDDEN',
      });
    }
    if (!input.reason.trim()) {
      throw new AppError({
        message: 'A business justification reason is required to unmask sensitive data.',
        statusCode: 400,
        code: 'REASON_REQUIRED',
      });
    }

    const st = getOrInitState(ctx.tenantId);
    st.unmaskHistory.unshift({
      id: nextSecId('unmask'),
      timestamp: new Date().toISOString(),
      actorName: actor.name,
      actorRole: actor.role,
      targetId: input.targetId,
      fieldLabel: input.fieldLabel,
      reason: input.reason.trim(),
    });

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'unmask',
      resourceType: 'Patient',
      resourceId: input.targetId,
      outcomeDesc: `Audited unmask of ${input.fieldLabel} — Reason: ${input.reason.trim()}`,
    });

    return {
      masked: maskSensitiveValue(input.rawValue, input.kind),
      unmasked: input.rawValue,
      auditRecorded: true,
    };
  },

  async activateBreakGlass(
    ctx: FhirRequestContext,
    input: { reason: string; durationMinutes: number },
    actor: { name: string; role: RoleName },
  ): Promise<BreakGlassSession> {
    if (!input.reason.trim()) {
      throw new AppError({
        message: 'Emergency Break-Glass access requires an explicit clinical or compliance justification.',
        statusCode: 400,
        code: 'BREAK_GLASS_REASON_REQUIRED',
      });
    }
    const clamped = Math.max(5, Math.min(60, input.durationMinutes || 30));
    const now = Date.now();
    const session: BreakGlassSession = {
      id: nextSecId('bg'),
      actorName: actor.name,
      actorRole: actor.role,
      reason: input.reason.trim(),
      activatedAt: now,
      expiresAt: now + clamped * 60_000,
      active: true,
    };

    getOrInitState(ctx.tenantId).breakGlass = session;

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'unmask',
      resourceType: 'Consent',
      resourceId: session.id,
      outcomeDesc: `BREAK-GLASS ACTIVATED for ${clamped} min — Reason: ${session.reason}`,
    });

    return session;
  },

  revokeBreakGlass(tenantId: string): void {
    const st = getOrInitState(tenantId);
    if (st.breakGlass) {
      st.breakGlass.active = false;
    }
  },

  isBreakGlassActive(tenantId: string, now = Date.now()): boolean {
    const bg = getOrInitState(tenantId).breakGlass;
    return Boolean(bg && bg.active && bg.expiresAt > now);
  },

  async saveConsentDirective(
    ctx: FhirRequestContext,
    input: {
      patientId: string;
      patientName: string;
      provisionType: 'deny' | 'permit';
      securityLabels: Array<'PSY' | 'ETH' | 'HIV' | 'SDV'>;
    },
    actor: { name: string; role: RoleName },
  ): Promise<FhirConsent> {
    this.assertSmartScope(ctx.tenantId, 'system/Consent.write');
    const client = getFhirClient();
    const consent: FhirConsent = {
      resourceType: 'Consent',
      status: 'active',
      scope: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/consentscope',
            code: 'patient-privacy',
            display: 'Privacy Consent',
          },
        ],
      },
      category: [
        {
          coding: [{ system: 'http://loinc.org', code: '59284-0', display: 'Patient Consent' }],
        },
      ],
      patient: { reference: `Patient/${input.patientId}`, display: input.patientName },
      dateTime: new Date().toISOString(),
      provision: {
        type: input.provisionType,
        securityLabel: input.securityLabels.map((code) => ({
          system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
          code,
          display: code,
        })),
      },
    };

    const created = await client.create<FhirConsent>(ctx, consent);
    getOrInitState(ctx.tenantId).consents.unshift(created);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Consent',
      resourceId: created.id,
      outcomeDesc: `Saved FHIR Consent (${input.provisionType}: ${input.securityLabels.join(', ')}) for Patient/${input.patientId}`,
    });

    return created;
  },

  getVisibleSensitiveRecords(tenantId: string): {
    visible: SensitiveSampleRecord[];
    hiddenCount: number;
    restrictedLabels: string[];
  } {
    const st = getOrInitState(tenantId);
    const restricted = new Set<string>();
    for (const c of st.consents) {
      if (c.status === 'active' && c.provision?.type === 'deny') {
        for (const lbl of c.provision.securityLabel ?? []) {
          if (lbl.code) restricted.add(lbl.code);
        }
      }
    }

    const bgActive = this.isBreakGlassActive(tenantId);
    if (bgActive) {
      return {
        visible: st.sensitiveRecords,
        hiddenCount: 0,
        restrictedLabels: Array.from(restricted),
      };
    }

    const visible = st.sensitiveRecords.filter((r) => !restricted.has(r.securityLabel));
    return {
      visible,
      hiddenCount: st.sensitiveRecords.length - visible.length,
      restrictedLabels: Array.from(restricted),
    };
  },

  updateSafeguard(
    tenantId: string,
    id: string,
    patch: Partial<Pick<HipaaSafeguardItem, 'status' | 'owner' | 'evidenceLink'>>,
  ): HipaaSafeguardItem {
    const st = getOrInitState(tenantId);
    const item = st.hipaaSafeguards.find((h) => h.id === id);
    if (!item) throw new AppError({ message: 'Safeguard not found.', statusCode: 404, code: 'NOT_FOUND' });
    Object.assign(item, patch);
    return item;
  },

  async decideAccessReview(
    ctx: FhirRequestContext,
    entryId: string,
    decision: 'Certified' | 'Revoked',
    actor: { name: string; role: RoleName },
  ): Promise<AccessReviewEntry> {
    const st = getOrInitState(ctx.tenantId);
    const entry = st.accessReviews.find((a) => a.id === entryId);
    if (!entry) throw new AppError({ message: 'Access review item not found.', statusCode: 404, code: 'NOT_FOUND' });
    entry.reviewStatus = decision;
    entry.reviewedBy = `${actor.name} (${actor.role})`;
    entry.reviewedAt = new Date().toISOString().slice(0, 10);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'AuditEvent',
      resourceId: entry.id,
      outcomeDesc: `Access review ${decision} for ${entry.userName} (${entry.role})`,
    });
    return entry;
  },

  updateRetentionPolicy(
    tenantId: string,
    patch: Partial<RetentionPolicyState>,
  ): RetentionPolicyState {
    const st = getOrInitState(tenantId);
    Object.assign(st.retention, patch);
    return st.retention;
  },
};
