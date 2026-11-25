import { useEffect, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Download,
  FileSignature,
  Share2,
  Users,
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
  providerService,
  type ProviderDirectoryRow,
} from '../m3-directory/providerService';
import { planService } from '../m23-plans/planService';
import {
  credentialingService,
  type CredentialingFileStatus,
  type PsvResult,
} from './credentialingService';

function fileTone(status: CredentialingFileStatus): SemanticTone {
  switch (status) {
    case 'Clean - Auto Approved':
    case 'Committee Approved':
      return 'success';
    case 'Committee Review':
    case 'Committee Deferred':
      return 'warning';
    case 'Committee Denied':
      return 'danger';
    default:
      return 'info';
  }
}

function psvTone(result: PsvResult): SemanticTone {
  if (result === 'Verified') return 'success';
  if (result === 'Flagged') return 'danger';
  return 'neutral';
}

export function CredentialingPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'files' | 'committee' | 'contracts' | 'share'>('files');
  const [providers, setProviders] = useState<ProviderDirectoryRow[]>([]);
  const [tick, setTick] = useState(0);

  const state = credentialingService.getState(activeTenant.id);
  const planState = planService.getState(fhirContext);

  const [selectedFileId, setSelectedFileId] = useState<string>(() => state.files[0]?.id ?? '');
  const [newFileProviderId, setNewFileProviderId] = useState('');

  // Committee vote state
  const [voteChoice, setVoteChoice] = useState<'Approve' | 'Defer' | 'Deny'>('Approve');
  const [voteComment, setVoteComment] = useState('');
  const [minutesPreview, setMinutesPreview] = useState<string | null>(null);

  // Contract form
  const [ctrProviderId, setCtrProviderId] = useState('');
  const [ctrTemplateId, setCtrTemplateId] = useState(state.templates[0]?.id ?? 'tpl-ffs-2026');
  const [ctrPlanId, setCtrPlanId] = useState(planState.plans[0]?.id ?? '');
  const [ctrNetworkId, setCtrNetworkId] = useState(planState.networks[0]?.id ?? '');
  const [ctrStart, setCtrStart] = useState('2026-01-01');
  const [ctrEnd, setCtrEnd] = useState('2026-12-31');
  const [ctrSigner, setCtrSigner] = useState('');
  const [amendTitle, setAmendTitle] = useState('');
  const [amendSummary, setAmendSummary] = useState('');
  const [amendTargetId, setAmendTargetId] = useState<string | null>(null);

  // Share with plan
  const [sharePlanId, setSharePlanId] = useState(planState.plans[0]?.id ?? '');
  const [bundlePreview, setBundlePreview] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void providerService.listProviders(fhirContext).then((list) => {
      if (!mounted) return;
      setProviders(list);
      setNewFileProviderId(list[0]?.id ?? '');
      setCtrProviderId(list[0]?.id ?? '');
      setCtrSigner(list[0]?.fullName ?? '');
    });
    const st = credentialingService.getState(activeTenant.id);
    setSelectedFileId(st.files[0]?.id ?? '');
    const ps = planService.getState(fhirContext);
    setCtrPlanId(ps.plans[0]?.id ?? '');
    setCtrNetworkId(ps.networks[0]?.id ?? '');
    setSharePlanId(ps.plans[0]?.id ?? '');
    return () => {
      mounted = false;
    };
  }, [activeTenant.id, fhirContext]);

  const activeFile = state.files.find((f) => f.id === selectedFileId) ?? state.files[0];

  const handleOpenFileForProvider = () => {
    const prov = providers.find((p) => p.id === newFileProviderId);
    if (!prov) return;
    const created = credentialingService.createCredentialingFile(activeTenant.id, prov);
    setSelectedFileId(created.id);
    setTick((t) => t + 1);
    showToast(`Credentialing file ready for ${prov.fullName}.`, 'success');
  };

  const handlePsvChange = (psvId: string, result: PsvResult) => {
    if (!activeFile) return;
    credentialingService.updatePsvItem(
      activeTenant.id,
      activeFile.id,
      psvId,
      { result },
      `${user.name} (${user.role})`,
    );
    setTick((t) => t + 1);
  };

  const handleVerifyAllClean = () => {
    if (!activeFile) return;
    credentialingService.markAllPsvVerified(
      activeTenant.id,
      activeFile.id,
      `${user.name} (${user.role})`,
    );
    setTick((t) => t + 1);
    showToast('All 8 PSV items marked Verified.', 'success');
  };

  const handleEvaluateFile = async () => {
    if (!activeFile) return;
    try {
      const updated = await credentialingService.evaluateAndFinalizeFile(
        fhirContext,
        activeFile.id,
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      if (updated.status === 'Clean - Auto Approved') {
        showToast(
          `Clean file auto-approved! Next recredentialing due ${updated.nextRecredentialingDue}.`,
          'success',
        );
      } else {
        showToast('Flagged PSV items detected — routed to Credentialing Committee.', 'warning');
        setTab('committee');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to evaluate credentialing file.', 'error');
    }
  };

  const handleCommitteeVote = async (
    finalizeOutcome?: 'Committee Approved' | 'Committee Deferred' | 'Committee Denied',
  ) => {
    if (!activeFile) return;
    try {
      await credentialingService.recordCommitteeVoteAndDecision(
        fhirContext,
        activeFile.id,
        {
          vote: voteChoice,
          comment: voteComment || `Voted ${voteChoice}`,
          finalizeOutcome,
        },
        { name: user.name, role: user.role },
      );
      setVoteComment('');
      setTick((t) => t + 1);
      showToast(
        finalizeOutcome ? `Committee finalized: ${finalizeOutcome}.` : 'Committee vote recorded.',
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Committee action failed.', 'error');
    }
  };

  const handleSignContract = async () => {
    const prov = providers.find((p) => p.id === ctrProviderId);
    if (!prov) {
      showToast('Select a provider first.', 'warning');
      return;
    }
    try {
      const ctr = await credentialingService.createAndSignContract(
        fhirContext,
        {
          practitionerId: prov.id,
          providerName: prov.fullName,
          npi: prov.npi,
          templateId: ctrTemplateId,
          planId: ctrPlanId,
          networkId: ctrNetworkId || undefined,
          effectiveStart: ctrStart,
          effectiveEnd: ctrEnd,
          signerName: ctrSigner || prov.fullName,
        },
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      showToast(
        `Contract executed and provider linked to M23 network (${ctr.networkName ?? ctr.planName}).`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Contract signing failed.', 'error');
    }
  };

  const handleAddAmendment = () => {
    if (!amendTargetId || !amendTitle.trim()) return;
    credentialingService.addContractAmendment(
      activeTenant.id,
      amendTargetId,
      {
        title: amendTitle.trim(),
        effectiveDate: new Date().toISOString().slice(0, 10),
        summary: amendSummary.trim() || 'Rate / terms addendum attached.',
      },
      `${user.name} (${user.role})`,
    );
    setAmendTargetId(null);
    setAmendTitle('');
    setAmendSummary('');
    setTick((t) => t + 1);
    showToast('Contract amendment added.', 'success');
  };

  const handleShareWithPlan = async () => {
    if (!activeFile) return;
    try {
      const shared = await credentialingService.shareCredentialingWithPlan(
        fhirContext,
        activeFile.id,
        sharePlanId,
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      setBundlePreview(shared.bundleJson);
      showToast(`Shared FHIR Bundle (${shared.resourceCount} resources) with ${shared.targetPlanName}.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Share with plan failed.', 'error');
    }
  };

  const approvedCount = state.files.filter((f) => f.status.includes('Approved')).length;
  const committeeCount = state.files.filter((f) => f.status === 'Committee Review').length;

  return (
    <Guard moduleId="m9-credentialing" action="view">
      <div className="space-y-6" data-tick={tick}>
        <PageHeader
          kicker="M9 · Credentialing & Contracting"
          title="Credentialing & Contracting"
          description="8-item Primary Source Verification (PSV), Committee review, 36-month recredentialing scheduler, M23 network contracting, and delegated plan sharing."
        />

        {/* KPI Strip */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Credentialing Files</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {state.files.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {approvedCount} approved · {committeeCount} in committee
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Recredentialing Cycle</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {state.recredentialingMonths} mo
              </span>
              <select
                aria-label="Recredentialing cycle months"
                className="rounded border border-slate-300 bg-transparent px-1.5 py-0.5 text-xs dark:border-slate-700"
                value={state.recredentialingMonths}
                onChange={(e) => {
                  credentialingService.setRecredentialingMonths(activeTenant.id, Number(e.target.value));
                  setTick((t) => t + 1);
                }}
              >
                <option value={24}>24 mo</option>
                <option value={36}>36 mo (NCQA)</option>
                <option value={48}>48 mo</option>
              </select>
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Configurable per tenant</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Executed Contracts</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {state.contracts.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Linked to M23 Plan Networks</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Shared Plan Bundles</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {state.sharedPackets.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">FHIR Bundle + Provenance</div>
          </div>
        </div>

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'files', label: `PSV Checklist (${state.files.length})` },
            { id: 'committee', label: `Committee Review (${committeeCount})` },
            { id: 'contracts', label: `Contracting & Networks (${state.contracts.length})` },
            { id: 'share', label: `Share with Plan (${state.sharedPackets.length})` },
          ]}
        />

        {tab === 'files' && (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left file list */}
            <div className="space-y-4 lg:col-span-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Start Credentialing File
                </h2>
                <div className="mt-3 flex gap-2">
                  <div className="flex-1">
                    <Select
                      label="Directory Provider"
                      value={newFileProviderId}
                      onChange={(e) => setNewFileProviderId(e.target.value)}
                      options={providers.map((p) => ({
                        value: p.id,
                        label: `${p.fullName} (${p.npi})`,
                      }))}
                    />
                  </div>
                </div>
                <Button className="mt-3 w-full" onClick={handleOpenFileForProvider}>
                  <Award className="h-4 w-4" />
                  Open / Resume File
                </Button>
              </div>

              <div className="space-y-2">
                {state.files.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedFileId(f.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      activeFile?.id === f.id
                        ? 'border-blue-500 bg-blue-50/50 dark:border-blue-400 dark:bg-blue-950/30'
                        : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {f.providerName}
                      </span>
                      <SemanticStatus tone={fileTone(f.status)} label={f.status} />
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      NPI <span className="font-mono">{f.npi}</span> · {f.specialty}
                    </div>
                    {f.nextRecredentialingDue && (
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Recredentialing due: <span className="tabular-nums">{f.nextRecredentialingDue}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Right PSV 8-item checklist */}
            <div className="lg:col-span-8">
              {activeFile ? (
                <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {activeFile.providerName}
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        NPI {activeFile.npi} · {activeFile.specialty} · Recredentialing Due:{' '}
                        {activeFile.nextRecredentialingDue ?? 'Pending completion'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={handleVerifyAllClean}>
                        Verify All 8 Clean
                      </Button>
                      <Button size="sm" onClick={() => void handleEvaluateFile()}>
                        <CheckCircle2 className="h-4 w-4" />
                        Complete / Route File
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <tr>
                          <th className="py-2 pr-3">PSV Element</th>
                          <th className="py-2 pr-3">Primary Source</th>
                          <th className="py-2 pr-3">Verified / Verifier</th>
                          <th className="py-2 pr-3">Result</th>
                          <th className="py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {activeFile.psvItems.map((item) => (
                          <tr key={item.id}>
                            <td className="py-2.5 pr-3 font-medium text-slate-900 dark:text-slate-100">
                              {item.category}
                              {item.notes && (
                                <div className="text-xs font-normal text-slate-500 dark:text-slate-400">
                                  {item.notes}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 pr-3 text-xs text-slate-600 dark:text-slate-300">
                              {item.source}
                            </td>
                            <td className="py-2.5 pr-3 text-xs text-slate-600 dark:text-slate-300">
                              <div>{item.verifiedDate ?? '—'}</div>
                              <div className="text-slate-400">{item.verifier ?? 'Not verified'}</div>
                            </td>
                            <td className="py-2.5 pr-3">
                              <SemanticStatus tone={psvTone(item.result)} label={item.result} />
                            </td>
                            <td className="py-2.5">
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant={item.result === 'Verified' ? 'primary' : 'ghost'}
                                  onClick={() => handlePsvChange(item.id, 'Verified')}
                                >
                                  Verify
                                </Button>
                                <Button
                                  size="sm"
                                  variant={item.result === 'Flagged' ? 'danger' : 'ghost'}
                                  onClick={() => handlePsvChange(item.id, 'Flagged')}
                                >
                                  Flag
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {tab === 'committee' && activeFile && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Credentialing Committee Docket — {activeFile.providerName}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Meeting: {activeFile.committeeMeetingDate ?? 'Next scheduled session'} · Status: {activeFile.status}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setMinutesPreview(credentialingService.exportCommitteeMinutes(activeTenant.id, activeFile.id))
                  }
                >
                  <Download className="h-4 w-4" />
                  Export Minutes
                </Button>
              </div>

              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                <div className="text-xs font-semibold uppercase text-slate-500">Agenda</div>
                <p className="mt-1 text-slate-700 dark:text-slate-300">
                  {activeFile.committeeAgenda || 'No flagged findings; routine oversight.'}
                </p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Recorded Votes ({activeFile.votes.length})
                </h3>
                <ul className="mt-2 divide-y divide-slate-200 text-sm dark:divide-slate-800">
                  {activeFile.votes.map((v) => (
                    <li key={v.id} className="py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {v.voterName} ({v.voterRole})
                        </span>
                        <SemanticStatus
                          tone={v.vote === 'Approve' ? 'success' : v.vote === 'Defer' ? 'warning' : 'danger'}
                          label={v.vote}
                        />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{v.comment}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <Users className="h-4 w-4" />
                Cast Vote & Finalize
              </h3>
              <Select
                label="Vote"
                value={voteChoice}
                onChange={(e) => setVoteChoice(e.target.value as 'Approve' | 'Defer' | 'Deny')}
                options={[
                  { value: 'Approve', label: 'Approve Credentialing' },
                  { value: 'Defer', label: 'Defer for Additional Info' },
                  { value: 'Deny', label: 'Deny Credentialing' },
                ]}
              />
              <TextArea
                label="Committee Rationale / Notes"
                rows={3}
                value={voteComment}
                onChange={(e) => setVoteComment(e.target.value)}
                placeholder="Document peer review rationale..."
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void handleCommitteeVote()}>
                  Record Vote Only
                </Button>
                <Button onClick={() => void handleCommitteeVote('Committee Approved')}>
                  Finalize Approved
                </Button>
                <Button variant="danger" onClick={() => void handleCommitteeVote('Committee Denied')}>
                  Finalize Denied
                </Button>
              </div>
            </div>
          </div>
        )}

        {tab === 'contracts' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <FileSignature className="h-4 w-4" />
                Generate & E-Sign Provider Contract
              </h2>
              <Select
                label="Provider"
                value={ctrProviderId}
                onChange={(e) => {
                  setCtrProviderId(e.target.value);
                  const found = providers.find((p) => p.id === e.target.value);
                  if (found) setCtrSigner(found.fullName);
                }}
                options={providers.map((p) => ({ value: p.id, label: `${p.fullName} (${p.npi})` }))}
              />
              <Select
                label="Program Contract Template"
                value={ctrTemplateId}
                onChange={(e) => setCtrTemplateId(e.target.value)}
                options={state.templates.map((t) => ({ value: t.id, label: `${t.program}: ${t.name}` }))}
              />
              <Select
                label="Target Plan (M23)"
                value={ctrPlanId}
                onChange={(e) => setCtrPlanId(e.target.value)}
                options={planState.plans.map((p) => ({ value: p.id, label: `${p.planCode} — ${p.name}` }))}
              />
              <Select
                label="Assign to Network (M23)"
                value={ctrNetworkId}
                onChange={(e) => setCtrNetworkId(e.target.value)}
                options={planState.networks.map((n) => ({
                  value: n.id,
                  label: `${n.name} (${n.county})`,
                }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Effective Start" type="date" value={ctrStart} onChange={(e) => setCtrStart(e.target.value)} />
                <Input label="Effective End" type="date" value={ctrEnd} onChange={(e) => setCtrEnd(e.target.value)} />
              </div>
              <Input
                label="E-Signature (Authorized Signer)"
                value={ctrSigner}
                onChange={(e) => setCtrSigner(e.target.value)}
                placeholder="Type full legal name"
              />
              <Button className="w-full" onClick={() => void handleSignContract()}>
                Execute Contract & Link Network
              </Button>
            </div>

            <div className="space-y-4 lg:col-span-7">
              {state.contracts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  No M9 contracts executed yet for this tenant. Use the form on the left to merge a template, e-sign, and link to an M23 network.
                </div>
              ) : (
                state.contracts.map((ctr) => (
                  <div
                    key={ctr.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {ctr.providerName} — {ctr.templateName}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {ctr.planName} · Network: {ctr.networkName ?? 'None'} · Term {ctr.effectiveStart} to {ctr.effectiveEnd}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <SemanticStatus tone="success" label={ctr.status} />
                        <Button size="sm" variant="secondary" onClick={() => setAmendTargetId(ctr.id)}>
                          Add Amendment
                        </Button>
                      </div>
                    </div>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-3 font-mono text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      {ctr.renderedText}
                    </pre>
                    {ctr.amendments.length > 0 && (
                      <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-800">
                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                          Amendments ({ctr.amendments.length})
                        </div>
                        <ul className="mt-1 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                          {ctr.amendments.map((a) => (
                            <li key={a.id}>
                              • <span className="font-medium">{a.title}</span> ({a.effectiveDate}): {a.summary}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'share' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <Share2 className="h-4 w-4" />
                Share Delegated Credentialing Packet with Health Plan (FHIR Bundle + Provenance)
              </h2>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <Select
                  label="Credentialing File"
                  value={activeFile?.id ?? ''}
                  onChange={(e) => setSelectedFileId(e.target.value)}
                  options={state.files.map((f) => ({
                    value: f.id,
                    label: `${f.providerName} (${f.status})`,
                  }))}
                />
                <Select
                  label="Recipient Plan (M23)"
                  value={sharePlanId}
                  onChange={(e) => setSharePlanId(e.target.value)}
                  options={planState.plans.map((p) => ({
                    value: p.id,
                    label: `${p.planCode} — ${p.name}`,
                  }))}
                />
                <div className="flex items-end">
                  <Button className="w-full" onClick={() => void handleShareWithPlan()}>
                    Share Credentialing Bundle
                  </Button>
                </div>
              </div>
            </div>

            {state.sharedPackets.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Disclosure History
                </h3>
                <div className="mt-3 divide-y divide-slate-200 text-sm dark:divide-slate-800">
                  {state.sharedPackets.map((pkt) => (
                    <div key={pkt.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {pkt.providerName} → {pkt.targetPlanName}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {pkt.resourceCount} FHIR resources · Provenance/{pkt.provenanceId} · Shared by {pkt.sharedBy}
                        </div>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => setBundlePreview(pkt.bundleJson)}>
                        Inspect Bundle JSON
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <Modal
          open={Boolean(minutesPreview)}
          onClose={() => setMinutesPreview(null)}
          title="Credentialing Committee Minutes Export"
        >
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 font-mono text-xs dark:bg-slate-950">
            {minutesPreview}
          </pre>
        </Modal>

        <Modal
          open={Boolean(bundlePreview)}
          onClose={() => setBundlePreview(null)}
          title="Shared Credentialing FHIR Bundle"
        >
          <pre className="max-h-96 overflow-auto rounded bg-slate-50 p-3 font-mono text-xs dark:bg-slate-950">
            {bundlePreview}
          </pre>
        </Modal>

        <Modal
          open={Boolean(amendTargetId)}
          onClose={() => setAmendTargetId(null)}
          title="Add Contract Amendment"
        >
          <div className="space-y-3">
            <Input
              label="Amendment Title"
              value={amendTitle}
              onChange={(e) => setAmendTitle(e.target.value)}
              placeholder="e.g., 2026 Value-Based Care Addendum"
            />
            <TextArea
              label="Amendment Summary"
              rows={3}
              value={amendSummary}
              onChange={(e) => setAmendSummary(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAmendTargetId(null)}>
                Cancel
              </Button>
              <Button onClick={handleAddAmendment}>Save Amendment</Button>
            </div>
          </div>
        </Modal>
      </div>
    </Guard>
  );
}
