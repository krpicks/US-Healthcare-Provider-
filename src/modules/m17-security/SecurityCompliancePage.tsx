import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { ALL_ROLES, Guard, useAuth } from '../../app';
import {
  Button,
  Input,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  useToast,
  type SemanticTone,
} from '../../components';
import { useTenantContext } from '../../tenancy';
import type { RoleName } from '../../types';
import {
  SECURITY_HYGIENE_NOTES,
  securityService,
} from './securityService';

function safeguardTone(status: 'Compliant' | 'In Progress' | 'Gap'): SemanticTone {
  if (status === 'Compliant') return 'success';
  if (status === 'In Progress') return 'warning';
  return 'danger';
}

export function SecurityCompliancePage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user, setRole, canUnmask } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'session' | 'scopes' | 'consent' | 'hipaa' | 'reviews' | 'hygiene'>('session');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [tick, setTick] = useState(0);

  // Scope test & Unmask state
  const [testScope, setTestScope] = useState('user/Practitioner.write');
  const [unmaskReason, setUnmaskReason] = useState('');
  const [revealedValue, setRevealedValue] = useState<string | null>(null);

  // Break-glass & Consent form
  const [bgReason, setBgReason] = useState('');
  const [bgMinutes, setBgMinutes] = useState(30);
  const [consentProvision, setConsentProvision] = useState<'deny' | 'permit'>('deny');
  const [consentLabel, setConsentLabel] = useState<'PSY' | 'ETH' | 'HIV' | 'SDV'>('HIV');

  const state = securityService.getState(activeTenant.id);
  const remainingSec = securityService.getSessionRemainingSeconds(activeTenant.id, nowMs);
  const expiringWarning = remainingSec <= state.session.warningThresholdSeconds;
  const breakGlassActive = securityService.isBreakGlassActive(activeTenant.id, nowMs);
  const sensitiveView = securityService.getVisibleSensitiveRecords(activeTenant.id);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const handleTestScope = () => {
    try {
      securityService.assertSmartScope(activeTenant.id, testScope);
      showToast(`SMART scope "${testScope}" permitted (200 OK).`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '403 Insufficient Scope', 'error');
    }
  };

  const handleUnmask = async () => {
    try {
      const res = await securityService.requestAuditedUnmask(
        fhirContext,
        {
          targetId: 'pat-jane-doe-state-medicaid-a',
          fieldLabel: 'Synthetic SSN',
          rawValue: '999-00-1234',
          kind: 'ssn',
          reason: unmaskReason,
        },
        { name: user.name, role: user.role },
      );
      setRevealedValue(res.unmasked);
      setUnmaskReason('');
      setTick((t) => t + 1);
      showToast('PII unmasked and FHIR AuditEvent recorded.', 'warning');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unmask denied (403).', 'error');
    }
  };

  const handleBreakGlass = async () => {
    try {
      await securityService.activateBreakGlass(
        fhirContext,
        { reason: bgReason, durationMinutes: bgMinutes },
        { name: user.name, role: user.role },
      );
      setBgReason('');
      setNowMs(Date.now());
      setTick((t) => t + 1);
      showToast(`Break-glass activated for ${bgMinutes} minutes and audited.`, 'warning');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to activate break-glass.', 'error');
    }
  };

  const handleSaveConsent = async () => {
    try {
      const created = await securityService.saveConsentDirective(
        fhirContext,
        {
          patientId: 'pat-jane-doe-state-medicaid-a',
          patientName: 'Jane Doe',
          provisionType: consentProvision,
          securityLabels: [consentLabel],
        },
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      showToast(`Saved FHIR Consent/${created.id} (${consentProvision} ${consentLabel}).`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Consent creation failed.', 'error');
    }
  };

  return (
    <Guard moduleId="m17-security" action="view">
      <div className="space-y-6" data-tick={tick}>
        <PageHeader
          kicker="M17 · Security, Privacy & Compliance"
          title="Security, Privacy & HIPAA Compliance"
          description="Demo role session timeout controls, OIDC configuration, SMART scope enforcement, audited PII unmasking, time-limited break-glass access, FHIR Consent sensitive-record hiding, HIPAA safeguards, access reviews, and legal hold."
        />

        {expiringWarning && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              Session Timeout Warning: Your demo session expires in {remainingSec}s.
            </div>
            <Button
              size="sm"
              onClick={() => {
                securityService.extendSession(activeTenant.id);
                setNowMs(Date.now());
                showToast('Session extended by 15 minutes.', 'success');
              }}
            >
              Extend Session
            </Button>
          </div>
        )}

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'session', label: 'Demo Login & OIDC' },
            { id: 'scopes', label: 'SMART Scopes & Unmask' },
            { id: 'consent', label: `Break-Glass & Consent (${state.consents.length})` },
            { id: 'hipaa', label: `HIPAA Safeguards (${state.hipaaSafeguards.length})` },
            { id: 'reviews', label: 'Access Review & Legal Hold' },
            { id: 'hygiene', label: 'Security Hygiene' },
          ]}
        />

        {tab === 'session' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                Demo Login &amp; Session Timeout
              </h2>
              <Select
                label="Active Demo Role"
                value={user.role}
                onChange={(e) => {
                  setRole(e.target.value as RoleName);
                  securityService.extendSession(activeTenant.id);
                  setRevealedValue(null);
                  showToast(`Switched active role to ${e.target.value}.`, 'info');
                }}
                options={ALL_ROLES.map((r) => ({ value: r, label: r }))}
              />
              <div className="rounded-md bg-slate-50 p-3 text-xs dark:bg-slate-950">
                <div>Signed in as: <strong>{user.name}</strong> ({user.email})</div>
                <div className="mt-1">
                  Session time remaining:{' '}
                  <span className="font-mono font-semibold">
                    {Math.floor(remainingSec / 60)}m {remainingSec % 60}s
                  </span>
                </div>
                <div className="mt-1">Unmask Privilege: {canUnmask ? 'Allowed (Audited)' : 'Restricted (403)'}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    securityService.simulateSessionExpiringSoon(activeTenant.id);
                    setNowMs(Date.now());
                  }}
                >
                  Simulate Timeout Warning
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    securityService.extendSession(activeTenant.id);
                    setNowMs(Date.now());
                    showToast('Session timer reset.', 'success');
                  }}
                >
                  Reset Timer
                </Button>
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-7">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                OIDC Identity Provider Configuration (PKCE SPA)
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Issuer URL"
                  value={state.oidc.issuerUrl}
                  onChange={(e) => {
                    securityService.updateOidcConfig(activeTenant.id, { issuerUrl: e.target.value });
                    setTick((t) => t + 1);
                  }}
                />
                <Input
                  label="Public Client ID"
                  value={state.oidc.clientId}
                  onChange={(e) => {
                    securityService.updateOidcConfig(activeTenant.id, { clientId: e.target.value });
                    setTick((t) => t + 1);
                  }}
                />
                <Input
                  label="Redirect URI"
                  value={state.oidc.redirectUri}
                  onChange={(e) => {
                    securityService.updateOidcConfig(activeTenant.id, { redirectUri: e.target.value });
                    setTick((t) => t + 1);
                  }}
                />
                <Input
                  label="FHIR Audience"
                  value={state.oidc.audience}
                  onChange={(e) => {
                    securityService.updateOidcConfig(activeTenant.id, { audience: e.target.value });
                    setTick((t) => t + 1);
                  }}
                />
              </div>
              <Input
                label="Requested OIDC / SMART Scopes"
                value={state.oidc.scopes}
                onChange={(e) => {
                  securityService.updateOidcConfig(activeTenant.id, { scopes: e.target.value });
                  setTick((t) => t + 1);
                }}
              />
            </div>
          </div>
        )}

        {tab === 'scopes' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                SMART on FHIR Scope Enforcement
              </h2>
              <div className="space-y-2">
                {state.smartScopes.map((s) => (
                  <label
                    key={s.scope}
                    className="flex cursor-pointer items-center justify-between rounded border border-slate-200 p-2.5 text-xs dark:border-slate-800"
                  >
                    <div>
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {s.scope}
                      </div>
                      <div className="text-slate-500">{s.description}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={s.granted}
                      onChange={(e) => {
                        securityService.toggleSmartScope(activeTenant.id, s.scope, e.target.checked);
                        setTick((t) => t + 1);
                      }}
                    />
                  </label>
                ))}
              </div>
              <div className="flex items-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <div className="flex-1">
                  <Select
                    label="Test Service Scope Guard"
                    value={testScope}
                    onChange={(e) => setTestScope(e.target.value)}
                    options={state.smartScopes.map((s) => ({ value: s.scope, label: s.scope }))}
                  />
                </div>
                <Button onClick={handleTestScope}>Test Guard</Button>
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <Eye className="h-4 w-4" aria-hidden="true" />
                Audited PII Masking &amp; Unmask
              </h2>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                <div className="text-xs text-slate-500">Patient/pat-jane-doe · Synthetic SSN</div>
                <div className="mt-1 font-mono text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {revealedValue ?? '***-**-1234'}
                </div>
              </div>
              <Input
                label="Business Justification Reason (Required for AuditEvent)"
                value={unmaskReason}
                onChange={(e) => setUnmaskReason(e.target.value)}
                placeholder="e.g., Verify identity for Medicaid eligibility appeal"
              />
              <div className="flex gap-2">
                <Button onClick={() => void handleUnmask()}>Request Audited Unmask</Button>
                {revealedValue && (
                  <Button variant="secondary" onClick={() => setRevealedValue(null)}>
                    Re-Mask
                  </Button>
                )}
              </div>
              {state.unmaskHistory.length > 0 && (
                <div className="border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
                  <div className="font-semibold text-slate-700 dark:text-slate-300">
                    Recent Unmask Audits ({state.unmaskHistory.length})
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {state.unmaskHistory.slice(0, 5).map((u) => (
                      <li key={u.id} className="text-slate-600 dark:text-slate-400">
                        {u.actorName} ({u.actorRole}) unmasked {u.fieldLabel} — {u.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'consent' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                  <ShieldAlert className="h-4 w-4 text-rose-600" aria-hidden="true" />
                  Emergency Break-Glass Access
                </h2>
                <SemanticStatus
                  tone={breakGlassActive ? 'danger' : 'neutral'}
                  label={breakGlassActive ? 'ACTIVE' : 'Inactive'}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Input
                    label="Emergency Clinical / Audit Reason"
                    value={bgReason}
                    onChange={(e) => setBgReason(e.target.value)}
                    placeholder="e.g., Emergency department care override"
                  />
                </div>
                <Input
                  label="Minutes (5-60)"
                  type="number"
                  min={5}
                  max={60}
                  value={bgMinutes}
                  onChange={(e) => setBgMinutes(Number(e.target.value))}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="danger" onClick={() => void handleBreakGlass()}>
                  Activate Break-Glass
                </Button>
                {breakGlassActive && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      securityService.revokeBreakGlass(activeTenant.id);
                      setTick((t) => t + 1);
                      showToast('Break-glass session revoked.', 'info');
                    }}
                  >
                    Revoke Override
                  </Button>
                )}
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  FHIR Consent Editor
                </h3>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Select
                    label="Provision Type"
                    value={consentProvision}
                    onChange={(e) => setConsentProvision(e.target.value as 'deny' | 'permit')}
                    options={[
                      { value: 'deny', label: 'Deny (Hide Sensitive Records)' },
                      { value: 'permit', label: 'Permit Access' },
                    ]}
                  />
                  <Select
                    label="Confidentiality Security Label"
                    value={consentLabel}
                    onChange={(e) => setConsentLabel(e.target.value as typeof consentLabel)}
                    options={[
                      { value: 'PSY', label: 'PSY — Psychiatry / Behavioral Health' },
                      { value: 'ETH', label: 'ETH — Substance Use (42 CFR Part 2)' },
                      { value: 'HIV', label: 'HIV — HIV/AIDS Status' },
                      { value: 'SDV', label: 'SDV — Domestic Violence' },
                    ]}
                  />
                </div>
                <Button className="mt-3" variant="secondary" onClick={() => void handleSaveConsent()}>
                  Create FHIR Consent Resource
                </Button>
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <Lock className="h-4 w-4" aria-hidden="true" />
                Sensitive-Record Hiding Rule Preview
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Active deny Consent labels: <strong>{sensitiveView.restrictedLabels.join(', ') || 'None'}</strong>.
                Currently hidden: <strong>{sensitiveView.hiddenCount}</strong> record(s)
                {breakGlassActive ? ' (Overridden by active Break-Glass!)' : ''}.
              </p>
              <div className="space-y-2">
                {sensitiveView.visible.map((rec) => (
                  <div
                    key={rec.id}
                    className="rounded border border-slate-200 p-3 text-xs dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {rec.title}
                      </span>
                      <SemanticStatus
                        tone={rec.securityLabel === 'N' ? 'success' : 'warning'}
                        label={`Label: ${rec.securityLabel}`}
                      />
                    </div>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">{rec.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'hipaa' && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-3">Citation</th>
                  <th className="px-4 py-3">Technical Safeguard</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {state.hipaaSafeguards.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-3 font-mono text-xs">{h.citation}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{h.control}</div>
                      <div className="font-mono text-xs text-slate-500">Evidence: {h.evidenceLink}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">{h.owner}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <SemanticStatus tone={safeguardTone(h.status)} label={h.status} />
                        <select
                          aria-label={`Update status for ${h.citation}`}
                          className="rounded border border-slate-300 bg-transparent px-1.5 py-0.5 text-xs dark:border-slate-700"
                          value={h.status}
                          onChange={(e) => {
                            securityService.updateSafeguard(activeTenant.id, h.id, {
                              status: e.target.value as typeof h.status,
                            });
                            setTick((t) => t + 1);
                          }}
                        >
                          <option value="Compliant">Compliant</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Gap">Gap</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'reviews' && (
          <div className="space-y-6">
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                  <tr>
                    <th className="px-4 py-3">User / Role</th>
                    <th className="px-4 py-3">Last Active</th>
                    <th className="px-4 py-3">Review Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {state.accessReviews.map((ar) => (
                    <tr key={ar.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100">{ar.userName}</div>
                        <div className="text-xs text-slate-500">{ar.role} · {ar.email}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{ar.lastActive}</td>
                      <td className="px-4 py-3">
                        <SemanticStatus
                          tone={
                            ar.reviewStatus === 'Certified'
                              ? 'success'
                              : ar.reviewStatus === 'Revoked'
                                ? 'danger'
                                : 'warning'
                          }
                          label={ar.reviewStatus}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={async () => {
                              await securityService.decideAccessReview(fhirContext, ar.id, 'Certified', {
                                name: user.name,
                                role: user.role,
                              });
                              setTick((t) => t + 1);
                              showToast(`Certified ${ar.userName}.`, 'success');
                            }}
                          >
                            Certify
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={async () => {
                              await securityService.decideAccessReview(fhirContext, ar.id, 'Revoked', {
                                name: user.name,
                                role: user.role,
                              });
                              setTick((t) => t + 1);
                              showToast(`Revoked access for ${ar.userName}.`, 'warning');
                            }}
                          >
                            Revoke
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-3">
              <Input
                label="Medicaid Records Retention (Years)"
                type="number"
                value={state.retention.medicaidRetentionYears}
                onChange={(e) => {
                  securityService.updateRetentionPolicy(activeTenant.id, {
                    medicaidRetentionYears: Number(e.target.value),
                  });
                  setTick((t) => t + 1);
                }}
              />
              <Input
                label="Legal Hold Matter ID / Reference"
                value={state.retention.legalHoldMatter}
                onChange={(e) => {
                  securityService.updateRetentionPolicy(activeTenant.id, {
                    legalHoldMatter: e.target.value,
                  });
                  setTick((t) => t + 1);
                }}
                placeholder="e.g., OIG-SUBPOENA-2026-09"
              />
              <div className="flex items-end pb-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={state.retention.legalHoldActive}
                    onChange={(e) => {
                      securityService.updateRetentionPolicy(activeTenant.id, {
                        legalHoldActive: e.target.checked,
                      });
                      setTick((t) => t + 1);
                    }}
                  />
                  Legal Hold Active (Suspend Purge)
                </label>
              </div>
            </div>
          </div>
        )}

        {tab === 'hygiene' && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Platform Security Hygiene Standards
            </h2>
            <ul className="space-y-2">
              {SECURITY_HYGIENE_NOTES.map((note, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Guard>
  );
}
