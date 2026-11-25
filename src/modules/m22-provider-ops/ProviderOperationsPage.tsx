import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Download,
  Mail,
  Plus,
  Upload,
} from 'lucide-react';
import {
  Button,
  Input,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  TextArea,
  useToast,
} from '../../components';
import { Guard } from '../../app/Guard';
import { useAuth, usePermission } from '../../app/AuthContext';
import { buildCsvString, downloadTextFile } from '../../services';
import { useTenantContext } from '../../tenancy';
import type { FhirCommunication } from '../../types';
import {
  providerService,
  type ProviderDirectoryRow,
  type ProviderEnrollmentStatus,
} from '../m3-directory/providerService';
import {
  ROSTER_CSV_TEMPLATE,
  providerOpsService,
  type NetworkParticipationStatus,
  type RosterCommitSummary,
  type RosterRowValidation,
  type SelfServiceField,
} from './providerOpsService';

export function ProviderOperationsPage() {
  const { activeTenant, fhirContext, seedReady } = useTenantContext();
  const { user } = useAuth();
  const { notify } = useToast();
  const canEdit = usePermission('m22-provider-ops', 'edit');
  const canApprove = usePermission('m22-provider-ops', 'approve');
  const canCreate = usePermission('m22-provider-ops', 'create');

  const [activeTab, setActiveTab] = useState('bulk');
  const [providers, setProviders] = useState<ProviderDirectoryRow[]>([]);
  const [messages, setMessages] = useState<FhirCommunication[]>([]);
  const [tick, setTick] = useState(0);

  // Staff list / Bulk state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>('all');
  const [bulkStatusTarget, setBulkStatusTarget] = useState<ProviderEnrollmentStatus>('Suspended');
  const [bulkReason, setBulkReason] = useState('Administrative review');
  const [bulkEffectiveDate, setBulkEffectiveDate] = useState('2026-11-24');

  // Roster upload state
  const [rosterFormat, setRosterFormat] = useState<'csv' | 'json'>('csv');
  const [rosterText, setRosterText] = useState(ROSTER_CSV_TEMPLATE);
  const [rosterValidation, setRosterValidation] = useState<RosterRowValidation[]>([]);
  const [rosterSummary, setRosterSummary] = useState<RosterCommitSummary | null>(null);

  // Affiliation form
  const [affPracId, setAffPracId] = useState('');
  const [affOrgName, setAffOrgName] = useState('Capital Valley Medical Group');
  const [affStart, setAffStart] = useState('2026-01-01');
  const [affEnd, setAffEnd] = useState('2027-12-31');

  // Network bulk update
  const [netBulkIds, setNetBulkIds] = useState<string[]>([]);
  const [netBulkStatus, setNetBulkStatus] = useState<NetworkParticipationStatus>('Participating');

  // Self-service change request
  const [crPracId, setCrPracId] = useState('');
  const [crField, setCrField] = useState<SelfServiceField>('phone');
  const [crAfter, setCrAfter] = useState('');

  // Targeted message
  const [msgSubject, setMsgSubject] = useState('');
  const [msgBody, setMsgBody] = useState('');

  // Delegated user
  const [delName, setDelName] = useState('');
  const [delEmail, setDelEmail] = useState('');
  const [delExpires, setDelExpires] = useState('2027-12-31');

  const loadData = useCallback(async () => {
    const [provs, comms] = await Promise.all([
      providerService.listProviders(fhirContext),
      providerOpsService.listMessages(fhirContext),
    ]);
    setProviders(provs);
    setMessages(comms);
    if (provs.length > 0 && !affPracId) setAffPracId(provs[0].id);
    if (provs.length > 0 && !crPracId) setCrPracId(provs[0].id);
  }, [fhirContext, affPracId, crPracId]);

  useEffect(() => {
    if (seedReady) {
      void loadData();
    }
  }, [seedReady, loadData, tick]);

  const opsState = providerOpsService.getState(activeTenant.id);
  const qualityScores = useMemo(
    () =>
      providerOpsService.computeDataQualityScores(
        providers,
        Number(activeTenant.configOverrides['directory.staleDaysThreshold'] ?? 90),
      ),
    [providers, activeTenant.configOverrides],
  );

  const staleIds = useMemo(
    () => new Set(qualityScores.filter((q) => q.isStale).map((q) => q.practitionerId)),
    [qualityScores],
  );

  const presetFilteredProviders = useMemo(() => {
    if (activePresetId === 'all') return providers;
    const preset = opsState.savedFilters.find((f) => f.id === activePresetId);
    if (!preset) return providers;
    return providers.filter((p) => {
      if (preset.status !== 'all' && p.status !== preset.status) return false;
      if (preset.acceptingOnly && !p.acceptingNewPatients) return false;
      if (preset.staleOnly && !staleIds.has(p.id)) return false;
      return true;
    });
  }, [providers, activePresetId, opsState.savedFilters, staleIds]);

  const handleBulkStatusChange = async () => {
    if (selectedIds.length === 0) return;
    try {
      for (const id of selectedIds) {
        await providerOpsService.changeProviderStatus(
          fhirContext,
          id,
          bulkStatusTarget,
          bulkReason,
          bulkEffectiveDate,
          { name: user.name, role: user.role },
        );
      }
      notify({
        title: `Updated ${selectedIds.length} provider(s) to ${bulkStatusTarget}`,
        description:
          bulkStatusTarget !== 'Active'
            ? 'ProviderStatusChanged published; claims blocked for non-active providers.'
            : 'ProviderStatusChanged published.',
        variant: 'success',
      });
      setSelectedIds([]);
      setTick((t) => t + 1);
    } catch (err) {
      notify({
        title: 'Status change failed',
        description: err instanceof Error ? err.message : 'Error',
        variant: 'error',
      });
    }
  };

  const handleValidateRoster = () => {
    try {
      const results = providerOpsService.validateRosterRows(rosterText, rosterFormat);
      setRosterValidation(results);
      setRosterSummary(null);
    } catch (err) {
      notify({
        title: 'Roster parse error',
        description: err instanceof Error ? err.message : 'Invalid format',
        variant: 'error',
      });
    }
  };

  const handleCommitRoster = async () => {
    const summary = await providerOpsService.commitRoster(
      fhirContext,
      rosterValidation,
      { name: user.name, role: user.role },
    );
    setRosterSummary(summary);
    notify({
      title: 'Roster transaction committed',
      description: `Created ${summary.created}, Updated ${summary.updated}, Skipped ${summary.skipped}, Failed ${summary.failed}`,
      variant: 'success',
    });
    setTick((t) => t + 1);
  };

  const handleAddAffiliation = () => {
    const prac = providers.find((p) => p.id === affPracId);
    if (!prac) return;
    try {
      providerOpsService.addAffiliation(activeTenant.id, {
        practitionerId: prac.id,
        practitionerName: prac.fullName,
        organizationId: `org-${affOrgName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        organizationName: affOrgName,
        locationName: `${prac.city} Practice Site`,
        role: prac.providerType,
        specialty: prac.specialty,
        billingAuthority: true,
        startDate: affStart,
        endDate: affEnd || undefined,
      });
      notify({ title: 'Affiliation added', variant: 'success' });
      setTick((t) => t + 1);
    } catch (err) {
      notify({
        title: 'Overlap validation blocked affiliation',
        description: err instanceof Error ? err.message : 'Overlap detected',
        variant: 'error',
      });
    }
  };

  const handleSubmitChangeRequest = async () => {
    const prac = providers.find((p) => p.id === crPracId);
    if (!prac || !crAfter.trim()) return;
    const beforeVal =
      crField === 'phone'
        ? prac.phone
        : crField === 'address'
          ? prac.street
          : crField === 'acceptingNewPatients'
            ? String(prac.acceptingNewPatients)
            : 'Current Record';
    const rec = await providerOpsService.submitChangeRequest(
      fhirContext,
      {
        practitionerId: prac.id,
        practitionerName: prac.fullName,
        field: crField,
        beforeValue: beforeVal,
        afterValue: crAfter.trim(),
      },
      { name: user.name, role: user.role },
    );
    notify({
      title: `Change Request ${rec.status}`,
      description: `FHIR Task/${rec.taskId} created.`,
      variant: 'success',
    });
    setCrAfter('');
    setTick((t) => t + 1);
  };

  const handleSendMessage = async () => {
    if (!msgSubject.trim() || !msgBody.trim()) return;
    const recipients = selectedIds.length > 0 ? selectedIds : providers.slice(0, 2).map((p) => p.id);
    await providerOpsService.sendTargetedMessage(
      fhirContext,
      recipients,
      msgSubject.trim(),
      msgBody.trim(),
      { name: user.name, role: user.role },
    );
    notify({
      title: `Message delivered to ${recipients.length} provider(s)`,
      variant: 'success',
    });
    setMsgSubject('');
    setMsgBody('');
    setTick((t) => t + 1);
  };

  // Group affiliations into tree view by organization
  const affiliationTree = useMemo(() => {
    const map = new Map<string, typeof opsState.affiliations>();
    for (const aff of opsState.affiliations) {
      const list = map.get(aff.organizationName) ?? [];
      list.push(aff);
      map.set(aff.organizationName, list);
    }
    return Array.from(map.entries());
  }, [opsState.affiliations]);

  return (
    <Guard
      moduleId="m22-provider-ops"
      action="view"
      moduleName="Provider Management Operations (M22)"
      showForbiddenPage
    >
      <div className="space-y-6">
        <PageHeader
          kicker={`M22 · Tenant ${activeTenant.code}`}
          title="Provider Management Operations"
          description="Execute bulk status actions, validate and commit provider rosters via transaction bundles, manage affiliations and network participation, process self-service change requests, and monitor directory quality."
        />

        <Tabs
          activeTab={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: 'bulk', label: 'Staff List & Status', count: presetFilteredProviders.length },
            { id: 'roster', label: 'Roster Upload' },
            { id: 'affiliations', label: 'Affiliations Tree', count: opsState.affiliations.length },
            { id: 'network', label: 'Network Participation', count: opsState.networkParticipations.length },
            { id: 'changes', label: 'Self-Service Changes', count: opsState.changeRequests.length },
            { id: 'quality', label: 'Quality, Messages & Delegates' },
          ]}
        />

        {/* Tab 1: Staff list, saved filters, bulk status management */}
        {activeTab === 'bulk' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setActivePresetId('all')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${activePresetId === 'all' ? 'bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}
                >
                  All ({providers.length})
                </button>
                {opsState.savedFilters.map((flt) => (
                  <button
                    key={flt.id}
                    type="button"
                    onClick={() => setActivePresetId(flt.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${activePresetId === flt.id ? 'bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}
                  >
                    {flt.name}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                onClick={() => {
                  const csv = buildCsvString(
                    ['Name', 'NPI', 'Status', 'City', 'Last Verified'],
                    presetFilteredProviders.map((p) => [p.fullName, p.npi, p.status, p.city, p.lastVerifiedDate ?? '']),
                  );
                  downloadTextFile(`${activeTenant.code}-staff-ops.csv`, csv, 'text/csv');
                }}
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Export Selected View</span>
              </Button>
            </div>

            {selectedIds.length > 0 && canEdit && (
              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-900 dark:bg-brand-950/30">
                <p className="w-full text-xs font-semibold text-brand-900 dark:text-brand-200">
                  Bulk Status Action ({selectedIds.length} provider(s) selected)
                </p>
                <div className="w-44">
                  <Select
                    label="New Status"
                    value={bulkStatusTarget}
                    options={['Active', 'Suspended', 'Terminated', 'Revalidation Due'].map((s) => ({ value: s, label: s }))}
                    onChange={(e) => setBulkStatusTarget(e.target.value as ProviderEnrollmentStatus)}
                  />
                </div>
                <div className="flex-1 min-w-48">
                  <Input label="Reason" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} />
                </div>
                <div className="w-40">
                  <Input label="Effective Date" type="date" value={bulkEffectiveDate} onChange={(e) => setBulkEffectiveDate(e.target.value)} />
                </div>
                <Button variant="primary" onClick={() => void handleBulkStatusChange()}>
                  Apply Status
                </Button>
              </div>
            )}

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label="Select all providers"
                          checked={
                            presetFilteredProviders.length > 0 &&
                            selectedIds.length === presetFilteredProviders.length
                          }
                          onChange={(e) =>
                            setSelectedIds(
                              e.target.checked
                                ? presetFilteredProviders.map((p) => p.id)
                                : [],
                            )
                          }
                        />
                      </th>
                      <th className="px-4 py-3">Provider</th>
                      <th className="px-4 py-3">NPI</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Claims Eligibility</th>
                      <th className="px-4 py-3">Last Verified</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {presetFilteredProviders.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            aria-label={`Select ${p.fullName}`}
                            checked={selectedIds.includes(p.id)}
                            onChange={(e) =>
                              setSelectedIds((prev) =>
                                e.target.checked
                                  ? [...prev, p.id]
                                  : prev.filter((id) => id !== p.id),
                              )
                            }
                          />
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                          {p.fullName}
                        </td>
                        <td className="px-4 py-2.5 font-mono tabular-nums">{p.npi}</td>
                        <td className="px-4 py-2.5">
                          <SemanticStatus
                            label={p.status}
                            tone={p.status === 'Active' ? 'success' : p.status === 'Suspended' || p.status === 'Terminated' ? 'danger' : 'warning'}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          {p.status === 'Active' ? (
                            <span className="text-emerald-700 dark:text-emerald-400">Eligible</span>
                          ) : (
                            <span className="font-medium text-red-700 dark:text-red-400">Blocked (Non-Active)</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {p.lastVerifiedDate ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Roster Upload & Transaction Bundle */}
        {activeTab === 'roster' && (
          <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Select
                  aria-label="Roster format"
                  value={rosterFormat}
                  options={[
                    { value: 'csv', label: 'Format: CSV' },
                    { value: 'json', label: 'Format: JSON' },
                  ]}
                  onChange={(e) => setRosterFormat(e.target.value as 'csv' | 'json')}
                />
                <Button
                  size="sm"
                  onClick={() =>
                    downloadTextFile('provider-roster-template.csv', ROSTER_CSV_TEMPLATE, 'text/csv')
                  }
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Download CSV Template</span>
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleValidateRoster}>Validate Rows</Button>
                {canEdit && (
                  <Button
                    variant="primary"
                    disabled={rosterValidation.length === 0}
                    onClick={() => void handleCommitRoster()}
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Commit Valid Rows to FHIR</span>
                  </Button>
                )}
              </div>
            </div>

            <TextArea
              label="Roster Payload (edit inline to fix errors and re-validate)"
              rows={7}
              value={rosterText}
              onChange={(e) => setRosterText(e.target.value)}
              className="font-mono text-xs"
            />

            {rosterSummary && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 font-mono text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
                Transaction Result: created={rosterSummary.created} · updated={rosterSummary.updated} · skipped={rosterSummary.skipped} · failed={rosterSummary.failed}
              </div>
            )}

            {rosterValidation.length > 0 && (
              <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-800">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">NPI</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Taxonomy</th>
                      <th className="px-3 py-2">Validation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {rosterValidation.map((v) => (
                      <tr key={v.row.rowNumber}>
                        <td className="px-3 py-2 font-mono">{v.row.rowNumber}</td>
                        <td className="px-3 py-2 font-mono">{v.row.npi}</td>
                        <td className="px-3 py-2">{v.row.given} {v.row.family}</td>
                        <td className="px-3 py-2 font-mono">{v.row.taxonomyCode}</td>
                        <td className="px-3 py-2">
                          {v.valid ? (
                            <SemanticStatus label="Valid" tone="success" />
                          ) : (
                            <span className="text-red-700 dark:text-red-400">
                              {v.errors.join(' ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Affiliations Tree & Overlap Validation */}
        {activeTab === 'affiliations' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-7">
              {affiliationTree.map(([orgName, members]) => (
                <div
                  key={orgName}
                  className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {orgName} ({members.length})
                  </h3>
                  <ul className="mt-3 divide-y divide-slate-200 text-xs dark:divide-slate-800">
                    {members.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-100">
                            {m.practitionerName} · {m.role} ({m.specialty})
                          </p>
                          <p className="text-slate-500">
                            {m.locationName} · Billing Authority: {m.billingAuthority ? 'Yes' : 'No'}
                          </p>
                        </div>
                        <span className="font-mono text-slate-600 dark:text-slate-400">
                          {m.startDate} → {m.endDate ?? 'Present'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {canEdit && (
              <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold">Add Affiliation (Overlap Checked)</h3>
                <Select
                  label="Provider"
                  value={affPracId}
                  options={providers.map((p) => ({ value: p.id, label: `${p.fullName} (${p.npi})` }))}
                  onChange={(e) => setAffPracId(e.target.value)}
                />
                <Input label="Group / Facility Name" value={affOrgName} onChange={(e) => setAffOrgName(e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Start Date" type="date" value={affStart} onChange={(e) => setAffStart(e.target.value)} />
                  <Input label="End Date" type="date" value={affEnd} onChange={(e) => setAffEnd(e.target.value)} />
                </div>
                <Button variant="primary" onClick={handleAddAffiliation}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Add Affiliation</span>
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Network Participation & Bulk Update */}
        {activeTab === 'network' && (
          <div className="space-y-4">
            {netBulkIds.length > 0 && canEdit && (
              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-900 dark:bg-brand-950/30">
                <span className="text-xs font-medium">
                  Preview: Updating {netBulkIds.length} network record(s) to {netBulkStatus}
                </span>
                <Select
                  aria-label="Bulk network status"
                  value={netBulkStatus}
                  options={['Participating', 'Pending', 'Closed', 'Terminated'].map((s) => ({ value: s, label: s }))}
                  onChange={(e) => setNetBulkStatus(e.target.value as NetworkParticipationStatus)}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    providerOpsService.bulkUpdateNetworkParticipation(
                      activeTenant.id,
                      netBulkIds,
                      { status: netBulkStatus },
                    );
                    notify({ title: 'Network participation updated', variant: 'success' });
                    setNetBulkIds([]);
                    setTick((t) => t + 1);
                  }}
                >
                  Apply Bulk Update
                </Button>
              </div>
            )}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                      <th className="w-10 px-4 py-3" />
                      <th className="px-4 py-3">Provider</th>
                      <th className="px-4 py-3">Plan</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Panel Limit</th>
                      <th className="px-4 py-3">Limits / Languages / Accessibility</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {opsState.networkParticipations.map((np) => (
                      <tr key={np.id}>
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            aria-label={`Select ${np.practitionerName} network record`}
                            checked={netBulkIds.includes(np.id)}
                            onChange={(e) =>
                              setNetBulkIds((prev) =>
                                e.target.checked ? [...prev, np.id] : prev.filter((i) => i !== np.id),
                              )
                            }
                          />
                        </td>
                        <td className="px-4 py-2.5 font-medium">{np.practitionerName}</td>
                        <td className="px-4 py-2.5">{np.planName}</td>
                        <td className="px-4 py-2.5">
                          <SemanticStatus
                            label={np.status}
                            tone={np.status === 'Participating' ? 'success' : np.status === 'Pending' ? 'warning' : 'danger'}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{np.panelSizeLimit}</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                          {np.ageLimit} · {np.languages.join(', ')} · {np.accessibility.join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Self-service Change Requests (FHIR Task + Diff + Approval) */}
        {activeTab === 'changes' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {canCreate && (
              <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold">Submit Self-Service Change Request</h3>
                <p className="text-xs text-slate-500">
                  Tenant auto-approve fields: {activeTenant.businessRules.autoApproveSelfServiceFields.join(', ')}. Banking details require approval; ownership changes route to enrollment.
                </p>
                <Select
                  label="Provider"
                  value={crPracId}
                  options={providers.map((p) => ({ value: p.id, label: p.fullName }))}
                  onChange={(e) => setCrPracId(e.target.value)}
                />
                <Select
                  label="Change Field"
                  value={crField}
                  options={[
                    { value: 'phone', label: 'Phone (Auto-approved)' },
                    { value: 'hours', label: 'Practice Hours (Auto-approved)' },
                    { value: 'acceptingNewPatients', label: 'Accepting New Patients (true/false)' },
                    { value: 'address', label: 'Practice Address (Approval required)' },
                    { value: 'taxonomy', label: 'Taxonomy Code (Approval required)' },
                    { value: 'bankingDetails', label: 'Banking / EFT Details (Approval required)' },
                    { value: 'ownershipChange', label: 'Ownership Change (Routes to M5 Enrollment)' },
                  ]}
                  onChange={(e) => setCrField(e.target.value as SelfServiceField)}
                />
                <Input
                  label="Proposed New Value"
                  placeholder="Enter new value..."
                  value={crAfter}
                  onChange={(e) => setCrAfter(e.target.value)}
                />
                <Button variant="primary" onClick={() => void handleSubmitChangeRequest()}>
                  Submit Change Task
                </Button>
              </div>
            )}

            <div className="space-y-3 lg:col-span-7">
              {opsState.changeRequests.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                  No change requests submitted yet. Submit one to create a FHIR Task and test tenant auto-approval vs approval rules.
                </div>
              ) : (
                opsState.changeRequests.map((cr) => (
                  <div
                    key={cr.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="space-y-1">
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {cr.practitionerName} · {cr.field} (Task/{cr.taskId})
                      </p>
                      <p className="font-mono text-slate-600 dark:text-slate-400">
                        Diff: "{cr.beforeValue}" → "{cr.afterValue}"
                      </p>
                      <p className="text-slate-500">Requested by {cr.requestedBy}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <SemanticStatus
                        label={cr.status}
                        tone={
                          cr.status === 'AutoApplied' || cr.status === 'Approved'
                            ? 'success'
                            : cr.status === 'PendingApproval'
                              ? 'warning'
                              : 'info'
                        }
                      />
                      {cr.status === 'PendingApproval' && canApprove && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={async () => {
                            await providerOpsService.approveChangeRequest(fhirContext, cr.id, {
                              name: user.name,
                              role: user.role,
                            });
                            notify({ title: 'Change request approved & applied with Provenance', variant: 'success' });
                            setTick((t) => t + 1);
                          }}
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Approve</span>
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 6: Data Quality, Stale Report, Attestations, Messages & Delegated Users */}
        {activeTab === 'quality' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Directory Data Quality & Stale Report (&gt;90d)</h3>
                  {canEdit && (
                    <Button
                      size="sm"
                      onClick={() => {
                        providerOpsService.launchAttestationCampaign(
                          activeTenant.id,
                          `Stale Record Attestation (${new Date().toISOString().slice(0, 10)})`,
                          '2027-02-01',
                          qualityScores.filter((q) => q.isStale).length,
                        );
                        notify({ title: 'Attestation campaign launched', variant: 'success' });
                        setTick((t) => t + 1);
                      }}
                    >
                      Launch Attestation Campaign
                    </Button>
                  )}
                </div>
                <div className="divide-y divide-slate-200 text-xs dark:divide-slate-800">
                  {qualityScores.map((q) => (
                    <div key={q.practitionerId} className="flex items-center justify-between py-2">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">{q.fullName}</p>
                        <p className="font-mono text-slate-500">
                          Score {q.score}% · Verified {q.daysSinceVerified}d ago
                        </p>
                      </div>
                      <SemanticStatus
                        label={q.isStale ? 'Stale Record' : 'Verified'}
                        tone={q.isStale ? 'warning' : 'success'}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold">Targeted Provider Messages ({messages.length})</h3>
                <Input label="Subject" value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} />
                <TextArea label="Message Body" rows={3} value={msgBody} onChange={(e) => setMsgBody(e.target.value)} />
                <Button variant="primary" size="sm" onClick={() => void handleSendMessage()}>
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Send Communication</span>
                </Button>
                {messages.slice(0, 3).map((m) => (
                  <p key={m.id} className="border-t border-slate-200 pt-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
                    <span className="font-mono">{m.sent?.slice(0, 16)}</span> · {m.payload?.[0]?.contentString}
                  </p>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-semibold">Delegated Practice Users (Scoped Permissions & Expiry)</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Input placeholder="Delegate full name" value={delName} onChange={(e) => setDelName(e.target.value)} />
                <Input placeholder="Delegate email" value={delEmail} onChange={(e) => setDelEmail(e.target.value)} />
                <Input type="date" value={delExpires} onChange={(e) => setDelExpires(e.target.value)} />
                <Button
                  variant="secondary"
                  disabled={!canEdit || !delName.trim() || !delEmail.trim()}
                  onClick={() => {
                    providerOpsService.addDelegatedUser(activeTenant.id, {
                      practitionerId: providers[0]?.id ?? 'prac-1',
                      practitionerName: providers[0]?.fullName ?? 'Provider',
                      delegateName: delName.trim(),
                      delegateEmail: delEmail.trim(),
                      permissions: ['Directory updates', 'Roster upload'],
                      expiresAt: delExpires,
                      active: true,
                    });
                    setDelName('');
                    setDelEmail('');
                    setTick((t) => t + 1);
                  }}
                >
                  Add Delegate
                </Button>
              </div>
              <ul className="mt-4 divide-y divide-slate-200 text-xs dark:divide-slate-800">
                {opsState.delegatedUsers.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between py-2.5">
                    <span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{d.delegateName}</span> ({d.delegateEmail}) · {d.permissions.join(', ')}
                    </span>
                    <span className="font-mono text-slate-500">Expires {d.expiresAt}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </Guard>
  );
}
