import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  FileWarning,
  Gavel,
  Scale,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Guard, useAuth } from '../../app';
import {
  Button,
  Input,
  Modal,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  TextArea,
  useToast,
  type SemanticTone,
} from '../../components';
import { useTenantContext } from '../../tenancy';
import {
  enrollmentService,
  type EnrollmentApplication,
} from '../m5-enrollment/enrollmentService';
import {
  DEFICIENCY_CATALOGUE,
  DENIAL_REASON_CODES,
  computeSlaHealth,
  determinationService,
  type SlaHealth,
} from './determinationService';

function slaTone(health: SlaHealth): SemanticTone {
  switch (health) {
    case 'On track':
      return 'success';
    case 'At risk':
      return 'warning';
    case 'Breached':
      return 'danger';
  }
}

export function DeterminationPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user, can } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'workqueue' | 'review' | 'appeals' | 'history'>('workqueue');
  const [applications, setApplications] = useState<EnrollmentApplication[]>(() =>
    enrollmentService.listApplications(activeTenant.id),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeAppId, setActiveAppId] = useState<string>(
    () =>
      enrollmentService
        .listApplications(activeTenant.id)
        .find((a) => a.status === 'In Review')?.id ??
      enrollmentService.listApplications(activeTenant.id)[0]?.id ??
      '',
  );
  const [tick, setTick] = useState(0);

  // Decision panel inputs
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [decisionNotes, setDecisionNotes] = useState('');
  const [selectedDenialCodes, setSelectedDenialCodes] = useState<string[]>([DENIAL_REASON_CODES[1]]);
  const [rfiOpen, setRfiOpen] = useState(false);
  const [rfiDeficiencies, setRfiDeficiencies] = useState<string[]>([DEFICIENCY_CATALOGUE[0]]);
  const [rfiDueDate, setRfiDueDate] = useState(() =>
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [rfiNotes, setRfiNotes] = useState('');

  // Appeal filing inputs
  const [appealAppId, setAppealAppId] = useState('');
  const [appealReason, setAppealReason] = useState('');

  // Preview letter modal
  const [letterModalText, setLetterModalText] = useState<string | null>(null);

  useEffect(() => {
    const apps = enrollmentService.listApplications(activeTenant.id);
    setApplications(apps);
    setActiveAppId(apps.find((a) => a.status === 'In Review')?.id ?? apps[0]?.id ?? '');
    setSelectedIds([]);
    return enrollmentService.subscribe(() => {
      setApplications([...enrollmentService.listApplications(activeTenant.id)]);
    });
  }, [activeTenant.id]);

  const detState = determinationService.getState(activeTenant.id);
  const activeApp = applications.find((a) => a.id === activeAppId);
  const deniedApps = applications.filter((a) => a.status === 'Denied');

  const handleNextCase = () => {
    const next = determinationService.getNextCase(activeTenant.id);
    if (!next) {
      showToast('No open cases in workqueue.', 'info');
      return;
    }
    setActiveAppId(next.id);
    setTab('review');
  };

  const handleBulkAssign = () => {
    if (selectedIds.length === 0) return;
    determinationService.bulkAssign(activeTenant.id, selectedIds, user.name);
    setApplications([...enrollmentService.listApplications(activeTenant.id)]);
    setSelectedIds([]);
    showToast(`Assigned ${selectedIds.length} case(s) to ${user.name}.`, 'success');
  };

  const handleDecision = async (decisionType: 'Approve' | 'Deny' | 'Escalate') => {
    if (!activeApp) return;
    try {
      const res = await determinationService.submitDecision(
        fhirContext,
        {
          applicationId: activeApp.id,
          decisionType,
          effectiveDate,
          contractProgram: activeApp.contractProgram,
          reasonCodes: decisionType === 'Deny' ? selectedDenialCodes : undefined,
          notes: decisionNotes || `${decisionType} decision recorded.`,
        },
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      if (res.status === 'PendingSignOff') {
        showToast(
          `Two-person rule: ${decisionType} queued for AgencyApprover sign-off.`,
          'warning',
        );
      } else if (res.status === 'Escalated') {
        showToast('Case escalated to Program Integrity / AgencyApprover.', 'info');
      } else {
        showToast(
          `Case ${activeApp.applicationNumber} ${res.decision?.outcome}. Decision letter generated.`,
          'success',
        );
        if (res.decision?.letterText) {
          setLetterModalText(res.decision.letterText);
        }
      }
      setDecisionNotes('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Decision failed', 'error');
    }
  };

  const handleSignOff = async (pendingId: string) => {
    try {
      const dec = await determinationService.signOffPendingDecision(
        fhirContext,
        pendingId,
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      showToast(`Signed off ${dec.outcome} for ${dec.applicationNumber}.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sign-off failed', 'error');
    }
  };

  const handleIssueRfi = async () => {
    if (!activeApp) return;
    try {
      await determinationService.pendWithRfi(
        fhirContext,
        activeApp.id,
        rfiDeficiencies,
        rfiDueDate,
        rfiNotes || 'Please resolve the listed deficiencies before due date.',
        { name: user.name, role: user.role },
      );
      setRfiOpen(false);
      setRfiNotes('');
      setTick((t) => t + 1);
      showToast(`RFI issued (due ${rfiDueDate}); 7-day and 2-day reminders scheduled.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'RFI failed', 'error');
    }
  };

  const handleFileAppeal = () => {
    const targetId = appealAppId || deniedApps[0]?.id;
    if (!targetId || !appealReason.trim()) {
      showToast('Select a denied case and enter appeal reason.', 'warning');
      return;
    }
    try {
      determinationService.fileAppeal(activeTenant.id, targetId, appealReason.trim(), [
        'appeal_brief_synthetic.pdf',
      ]);
      setAppealReason('');
      setTick((t) => t + 1);
      showToast('Administrative appeal filed within 60-day window.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Appeal filing failed', 'error');
    }
  };

  const handleResolveAppeal = async (
    appealId: string,
    outcome: 'Upheld' | 'Overturned' | 'Remanded',
  ) => {
    try {
      await determinationService.resolveAppeal(
        fhirContext,
        appealId,
        outcome,
        `Appeal ${outcome} by hearing officer.`,
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      showToast(
        outcome === 'Overturned'
          ? 'Appeal Overturned — enrollment case re-opened in Review.'
          : `Appeal ${outcome}.`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Appeal update failed', 'error');
    }
  };

  // Reference tick so state refreshes reflect immediately
  void tick;

  return (
    <Guard moduleId="m8-determination" action="view">
      <div className="space-y-6">
        <PageHeader
          kicker={`M8 · Review, Determination, RFI & Appeals · ${activeTenant.code}`}
          title="Review, Determination & Appeals"
          description="SLA-tracked enrollment workqueue, split-view case determination, two-person AgencyApprover sign-off for denials and high-risk approvals, RFI loops, and administrative appeals."
          actions={
            <Button onClick={handleNextCase}>
              <span>Next Priority Case</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          }
        />

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'workqueue', label: `Workqueue (${applications.length})` },
            { id: 'review', label: 'Case Review & Decision' },
            { id: 'appeals', label: `Appeals Queue (${detState.appeals.length})` },
            { id: 'history', label: `Decision History & Sign-Offs (${detState.decisions.length})` },
          ]}
        />

        {tab === 'workqueue' && (
          <div className="space-y-4">
            {detState.pendingSignOffs.some((p) => p.status === 'PendingSignOff') && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
                <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Pending Two-Person AgencyApprover Sign-Off
                </h2>
                <div className="mt-3 space-y-2">
                  {detState.pendingSignOffs
                    .filter((p) => p.status === 'PendingSignOff')
                    .map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded bg-white p-3 text-xs dark:bg-slate-900"
                      >
                        <div>
                          <span className="font-mono font-semibold">{p.applicationNumber}</span> ·{' '}
                          {p.providerName} · Proposed <strong>{p.decisionType}</strong> by {p.requestedBy}
                        </div>
                        <Button
                          size="sm"
                          disabled={!determinationService.canSignOffTwoPerson(user.role)}
                          onClick={() => void handleSignOff(p.id)}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Sign Off ({user.role})</span>
                        </Button>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {selectedIds.length} selected · Tenant SLA target: {activeTenant.businessRules.slaDays} days
              </p>
              {selectedIds.length > 0 && (
                <Button size="sm" variant="secondary" onClick={handleBulkAssign}>
                  Bulk Assign Selected to Me
                </Button>
              )}
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                      <th className="px-4 py-3 w-10">Select</th>
                      <th className="px-4 py-3">Case</th>
                      <th className="px-4 py-3">Risk</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">SLA Health</th>
                      <th className="px-4 py-3">Assigned Analyst</th>
                      <th className="px-4 py-3 text-right">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {applications.map((app) => {
                      const sla = computeSlaHealth(app);
                      return (
                        <tr key={app.id}>
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              aria-label={`Select ${app.applicationNumber}`}
                              checked={selectedIds.includes(app.id)}
                              onChange={(e) =>
                                setSelectedIds((prev) =>
                                  e.target.checked
                                    ? [...prev, app.id]
                                    : prev.filter((id) => id !== app.id),
                                )
                              }
                            />
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900 dark:text-slate-100">
                              {app.applicationNumber} · {app.applicantGiven} {app.applicantFamily}
                            </p>
                            <p className="font-mono text-xs text-slate-500">
                              NPI {app.npi} · {app.providerType}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-xs">{app.riskTier ?? 'Unscored'}</td>
                          <td className="px-4 py-3">
                            <SemanticStatus
                              tone={
                                app.status === 'Approved'
                                  ? 'success'
                                  : app.status === 'Denied'
                                    ? 'danger'
                                    : app.status === 'RFI Issued'
                                      ? 'warning'
                                      : 'info'
                              }
                              label={app.status}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <SemanticStatus
                              tone={slaTone(sla.health)}
                              label={`${sla.health} (${sla.daysRemaining}d)`}
                            />
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                            {app.assignedAnalyst ?? 'Unassigned'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setActiveAppId(app.id);
                                setTab('review');
                              }}
                            >
                              Open Review
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'review' && activeApp && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left case packet */}
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
                <div>
                  <p className="font-mono text-xs text-slate-500">
                    {activeApp.applicationNumber} · {activeApp.applicationType}
                  </p>
                  <h2 className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {activeApp.applicantPrefix} {activeApp.applicantGiven} {activeApp.applicantFamily}
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {activeApp.organizationName} · NPI {activeApp.npi} · {activeApp.providerType}
                  </p>
                </div>
                <SemanticStatus tone="info" label={activeApp.status} />
              </div>

              <dl className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <dt className="text-slate-500">License</dt>
                  <dd className="font-mono font-medium text-slate-900 dark:text-slate-100">
                    {activeApp.licenseState}-{activeApp.licenseNumber} (exp {activeApp.licenseExpiry})
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Taxonomy / Specialty</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">
                    {activeApp.taxonomyCode} · {activeApp.specialty}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Categorical Risk Tier</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100">
                    {activeApp.riskTier ?? 'Not yet evaluated in M7'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Documents Verified</dt>
                  <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                    {activeApp.documents.filter((d) => d.status === 'Uploaded').length} / {activeApp.documents.length}
                  </dd>
                </div>
              </dl>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Case History
                </h3>
                <ul className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                  {activeApp.history.map((h, i) => (
                    <li key={i}>
                      <span className="font-semibold text-slate-900 dark:text-slate-200">
                        {h.status}
                      </span>{' '}
                      · {new Date(h.timestamp).toLocaleDateString()} · {h.note}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Right determination panel */}
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <Gavel className="h-4 w-4 text-brand-700 dark:text-brand-400" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Determination Decision Panel
                </h3>
              </div>

              <p className="rounded bg-slate-50 p-2.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                Two-person rule: <strong>Denials</strong> and <strong>High-risk Approvals</strong> require <strong>AgencyApprover</strong> sign-off. Current role: <strong>{user.role}</strong>.
              </p>

              <Input
                label="Approval Effective Date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />

              <Select
                label="Denial Reason Code (if Denying)"
                value={selectedDenialCodes[0] ?? DENIAL_REASON_CODES[0]}
                onChange={(e) => setSelectedDenialCodes([e.target.value])}
                options={DENIAL_REASON_CODES.map((c) => ({ value: c, label: c }))}
              />

              <TextArea
                label="Determination Findings & Rationale"
                value={decisionNotes}
                onChange={(e) => setDecisionNotes(e.target.value)}
                placeholder="Document determination notes for FHIR Provenance and decision notice..."
              />

              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button
                  disabled={!can('m8-determination', 'edit')}
                  onClick={() => void handleDecision('Approve')}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>Approve</span>
                </Button>
                <Button
                  variant="danger"
                  disabled={!can('m8-determination', 'edit')}
                  onClick={() => void handleDecision('Deny')}
                >
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                  <span>Deny</span>
                </Button>
                <Button
                  variant="secondary"
                  disabled={!can('m8-determination', 'edit')}
                  onClick={() => setRfiOpen(true)}
                >
                  <FileWarning className="h-4 w-4" aria-hidden="true" />
                  <span>Pend with RFI</span>
                </Button>
                <Button
                  variant="secondary"
                  disabled={!can('m8-determination', 'edit')}
                  onClick={() => void handleDecision('Escalate')}
                >
                  <Scale className="h-4 w-4" aria-hidden="true" />
                  <span>Escalate</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {tab === 'appeals' && (
          <div className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                File Administrative Appeal (60-Day Window)
              </h2>
              {deniedApps.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  No denied applications are currently eligible for appeal. Deny a case in the Review tab to test the appeals lifecycle.
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Select
                    label="Denied Application"
                    value={appealAppId || deniedApps[0]?.id || ''}
                    onChange={(e) => setAppealAppId(e.target.value)}
                    options={deniedApps.map((a) => ({
                      value: a.id,
                      label: `${a.applicationNumber} — ${a.applicantGiven} ${a.applicantFamily}`,
                    }))}
                  />
                  <div className="md:col-span-2">
                    <Input
                      label="Grounds for Appeal"
                      value={appealReason}
                      onChange={(e) => setAppealReason(e.target.value)}
                      placeholder="License reinstated / exclusion cleared with supporting documentation..."
                    />
                  </div>
                  <div>
                    <Button size="sm" onClick={handleFileAppeal}>
                      Submit Appeal
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Appeal / Case</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Window Ends</th>
                    <th className="px-4 py-3">Outcome</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {detState.appeals.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">
                        No administrative appeals filed yet.
                      </td>
                    </tr>
                  ) : (
                    detState.appeals.map((apl) => (
                      <tr key={apl.id}>
                        <td className="px-4 py-3 font-medium">
                          {apl.applicationNumber} · {apl.providerName}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                          {apl.reason}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{apl.windowEndsAt}</td>
                        <td className="px-4 py-3">
                          <SemanticStatus
                            tone={
                              apl.status === 'Overturned'
                                ? 'success'
                                : apl.status === 'Upheld'
                                  ? 'danger'
                                  : 'warning'
                            }
                            label={apl.status}
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {apl.status === 'Open' && (
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void handleResolveAppeal(apl.id, 'Upheld')}
                              >
                                Uphold
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => void handleResolveAppeal(apl.id, 'Overturned')}
                              >
                                Overturn &amp; Re-open
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <th className="px-4 py-3">Case</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Decided / Approved By</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Notice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {detState.decisions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">
                      No determination decisions finalized yet.
                    </td>
                  </tr>
                ) : (
                  detState.decisions.map((d) => (
                    <tr key={d.id}>
                      <td className="px-4 py-3 font-medium">
                        {d.applicationNumber} · {d.providerName}
                      </td>
                      <td className="px-4 py-3">
                        <SemanticStatus
                          tone={d.outcome === 'Approved' ? 'success' : d.outcome === 'Denied' ? 'danger' : 'warning'}
                          label={d.outcome}
                        />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                        {d.approvedBy ?? d.decidedBy}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {new Date(d.decidedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {d.letterText && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setLetterModalText(d.letterText)}
                          >
                            View Letter
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <Modal open={rfiOpen} onClose={() => setRfiOpen(false)} title="Issue Request for Information (RFI)">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Deficiency Catalogue
              </p>
              {DEFICIENCY_CATALOGUE.map((item) => (
                <label key={item} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={rfiDeficiencies.includes(item)}
                    onChange={(e) =>
                      setRfiDeficiencies((prev) =>
                        e.target.checked ? [...prev, item] : prev.filter((x) => x !== item),
                      )
                    }
                  />
                  <span>{item}</span>
                </label>
              ))}
            </div>
            <Input
              label="Response Due Date (Reminders at 7 & 2 days)"
              type="date"
              value={rfiDueDate}
              onChange={(e) => setRfiDueDate(e.target.value)}
            />
            <TextArea
              label="Additional Instructions"
              value={rfiNotes}
              onChange={(e) => setRfiNotes(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRfiOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleIssueRfi()}>Send RFI Notice</Button>
            </div>
          </div>
        </Modal>

        <Modal
          open={Boolean(letterModalText)}
          onClose={() => setLetterModalText(null)}
          title="Decision Notice Letter (M18 Template Preview)"
        >
          <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            {letterModalText}
          </pre>
        </Modal>
      </div>
    </Guard>
  );
}
