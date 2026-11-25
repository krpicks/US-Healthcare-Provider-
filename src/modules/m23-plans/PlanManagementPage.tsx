import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  FileSignature,
  Plus,
  Send,
  Upload,
} from 'lucide-react';
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
} from '../../components';
import { Guard } from '../../app/Guard';
import { useAuth, usePermission } from '../../app/AuthContext';
import { downloadTextFile } from '../../services';
import { useTenantContext } from '../../tenancy';
import { providerService, type ProviderDirectoryRow } from '../m3-directory/providerService';
import { patientService, type PatientSummaryRow } from '../m4-patients/patientService';
import { planService, type PlanType } from './planService';

export function PlanManagementPage() {
  const { activeTenant, fhirContext, seedReady } = useTenantContext();
  const { user } = useAuth();
  const { notify } = useToast();
  const canEdit = usePermission('m23-plans', 'edit');
  const canCreate = usePermission('m23-plans', 'create');

  const [activeTab, setActiveTab] = useState('catalogue');
  const [tick, setTick] = useState(0);
  const [providers, setProviders] = useState<ProviderDirectoryRow[]>([]);
  const [patients, setPatients] = useState<PatientSummaryRow[]>([]);

  const state = planService.getState(fhirContext);
  const adequacyReports = planService.evaluateNetworkAdequacy(fhirContext);

  const [selectedPlanId, setSelectedPlanId] = useState<string>(state.plans[0]?.id ?? '');
  const [createModal, setCreateModal] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanCode, setNewPlanCode] = useState('');
  const [newPlanType, setNewPlanType] = useState<PlanType>('MCO');

  // Effective rate lookup tester
  const [rateCode, setRateCode] = useState('99213');
  const [ratePlanId, setRatePlanId] = useState(state.plans[0]?.id ?? '');
  const [rateProviderType, setRateProviderType] = useState('Individual Physician');
  const [rateDate, setRateDate] = useState('2026-11-10');
  const [rateResult, setRateResult] = useState<string | null>(null);
  const [feeCsvText, setFeeCsvText] = useState(
    'code,modifier,description,rateUsd,effectiveStart,effectiveEnd\n99215,,Office visit high complexity,185.20,2026-01-01,2026-12-31',
  );

  // Eligibility checker
  const [eligPatientId, setEligPatientId] = useState('');
  const [eligPlanId, setEligPlanId] = useState(state.plans[0]?.id ?? '');
  const [eligDate, setEligDate] = useState('2026-11-10');
  const [eligResult, setEligResult] = useState<{ eligible: boolean; reason: string } | null>(null);

  // Directory publishing preview
  const [publishPreview, setPublishPreview] = useState<{
    resourceCount: number;
    validationOk: boolean;
    addedCount: number;
    removedCount: number;
  } | null>(null);

  // Reports
  const [reports, setReports] = useState<Awaited<ReturnType<typeof planService.getPlanReports>> | null>(null);

  useEffect(() => {
    if (!seedReady) return;
    const s = planService.getState(fhirContext);
    setSelectedPlanId(s.plans[0]?.id ?? '');
    setRatePlanId(s.plans[0]?.id ?? '');
    setEligPlanId(s.plans[0]?.id ?? '');
    void Promise.all([
      providerService.listProviders(fhirContext),
      patientService.listPatients(fhirContext),
      planService.getPlanReports(fhirContext),
    ]).then(([provs, pats, rep]) => {
      setProviders(provs);
      setPatients(pats);
      setReports(rep);
      if (pats[0]) setEligPatientId(pats[0].id);
    });
  }, [fhirContext, seedReady, tick]);

  const activePlan =
    state.plans.find((p) => p.id === selectedPlanId) ?? state.plans[0];

  const handleCreatePlan = async () => {
    if (!newPlanCode.trim() || !newPlanName.trim()) return;
    await planService.createOrActivatePlan(
      fhirContext,
      {
        planCode: newPlanCode.trim(),
        name: newPlanName.trim(),
        type: newPlanType,
        market: 'Medicaid',
        effectiveStart: '2026-01-01',
        effectiveEnd: '2026-12-31',
        status: 'Draft',
        serviceArea: ['Statewide'],
        enrollmentRules: 'Standard Medicaid eligibility',
        contactEmail: 'plan-ops@synthetic.example',
        appealsInfo: '60-day appeal window',
        benefits: activePlan?.benefits ?? [],
      },
      { name: user.name, role: user.role },
    );
    notify({ title: `Plan ${newPlanCode} created`, variant: 'success' });
    setCreateModal(false);
    setNewPlanCode('');
    setNewPlanName('');
    setTick((t) => t + 1);
  };

  const handlePreviewPublish = async () => {
    const res = await planService.buildAndValidateDirectoryBundle(fhirContext);
    setPublishPreview({
      resourceCount: res.bundle.entry?.length ?? 0,
      validationOk: res.validationOk,
      addedCount: res.addedKeys.length,
      removedCount: res.removedKeys.length,
    });
  };

  const handlePublishDirectory = async () => {
    const snap = await planService.publishDirectorySnapshot(fhirContext, {
      name: user.name,
      role: user.role,
    });
    notify({
      title: 'Plan Directory FHIR bundle published',
      description: `${snap.resourceCount} validated resources published.`,
      variant: 'success',
    });
    setTick((t) => t + 1);
  };

  return (
    <Guard
      moduleId="m23-plans"
      action="view"
      moduleName="Plan Management (M23)"
      showForbiddenPage
    >
      <div className="space-y-6">
        <PageHeader
          kicker={`M23 · Tenant ${activeTenant.code} · ${state.plans.length} Plans`}
          title="Plan Management, Networks & Rate Schedules"
          description="Administer Medicaid FFS/MCO/CHIP plans, benefits, network adequacy standards, provider contracts, versioned fee schedules, eligibility rules, and FHIR directory publishing."
          actions={
            canCreate ? (
              <Button variant="primary" onClick={() => setCreateModal(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>New Plan</span>
              </Button>
            ) : undefined
          }
        />

        <Tabs
          activeTab={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: 'catalogue', label: 'Plans & Benefits', count: state.plans.length },
            { id: 'networks', label: 'Networks & Adequacy', count: state.networks.length },
            { id: 'contracts', label: 'Contracts', count: state.contracts.length },
            { id: 'rates', label: 'Rate Schedules', count: state.rateSchedules.length },
            { id: 'eligibility', label: 'Prior Auth & Eligibility' },
            { id: 'publish', label: 'FHIR Publish & Reports' },
          ]}
        />

        {/* Tab 1: Plan Catalogue & Benefits */}
        {activeTab === 'catalogue' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-5">
              {state.plans.map((plan) => (
                <div
                  key={plan.id}
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                    activePlan?.id === plan.id
                      ? 'border-brand-600 bg-brand-50/40 dark:border-brand-400 dark:bg-brand-950/30'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs text-slate-500">
                        {plan.planCode} · {plan.type} · v{plan.version}
                      </p>
                      <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {plan.name}
                      </h3>
                    </div>
                    <SemanticStatus
                      label={plan.status}
                      tone={plan.status === 'Active' ? 'success' : plan.status === 'Draft' ? 'warning' : 'neutral'}
                    />
                  </div>
                  <p className="mt-2 font-mono text-xs text-slate-500">
                    {plan.effectiveStart} → {plan.effectiveEnd} · {plan.serviceArea.join(', ')}
                  </p>
                </div>
              ))}
            </div>

            {activePlan && (
              <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
                  <div>
                    <h2 className="text-base font-semibold">{activePlan.name}</h2>
                    <p className="text-xs text-slate-500">
                      {activePlan.enrollmentRules} · Appeals: {activePlan.appealsInfo}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      {activePlan.status === 'Draft' && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={async () => {
                            await planService.activatePlan(fhirContext, activePlan.id, {
                              name: user.name,
                              role: user.role,
                            });
                            notify({ title: `Plan ${activePlan.planCode} activated`, variant: 'success' });
                            setTick((t) => t + 1);
                          }}
                        >
                          Activate Plan
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={async () => {
                          const copy = await planService.copyPlanToNextYear(
                            fhirContext,
                            activePlan.id,
                            { name: user.name, role: user.role },
                          );
                          notify({ title: `Copied to ${copy.planCode}`, variant: 'success' });
                          setTick((t) => t + 1);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Copy to Next Year</span>
                      </Button>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Benefit Summary ({activePlan.benefits.length} categories)
                  </h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                          <th className="py-2 pr-3">Category</th>
                          <th className="py-2 pr-3">Limits</th>
                          <th className="py-2 pr-3 text-right">Copay</th>
                          <th className="py-2">PA / Referral</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {activePlan.benefits.map((b) => (
                          <tr key={b.id}>
                            <td className="py-2 pr-3 font-medium">{b.category}</td>
                            <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{b.limits}</td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums">${b.copayUsd}</td>
                            <td className="py-2 text-slate-600 dark:text-slate-400">
                              PA: {b.priorAuthRequired ? 'Required' : 'No'} · Ref: {b.referralRequired ? 'Yes' : 'No'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Networks & Adequacy Check */}
        {activeTab === 'networks' && (
          <div className="space-y-5">
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Network & Plan</th>
                    <th className="px-4 py-3">Category / County</th>
                    <th className="px-4 py-3 text-right">Assigned / Required</th>
                    <th className="px-4 py-3">Adequacy</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {adequacyReports.map((rep) => (
                    <tr key={rep.networkId}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{rep.networkName}</p>
                        <p className="text-slate-500">{rep.planName}</p>
                      </td>
                      <td className="px-4 py-3">{rep.category} · {rep.county}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {rep.assignedCount} / {rep.requiredCount}
                        {rep.ratioGap > 0 && (
                          <span className="ml-1.5 text-red-700 dark:text-red-400">(-{rep.ratioGap})</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <SemanticStatus
                          label={rep.status}
                          tone={rep.status === 'Adequate' ? 'success' : 'warning'}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canEdit && (
                          <Button
                            size="sm"
                            onClick={() => {
                              const activeIds = providers
                                .filter((p) => p.status === 'Active')
                                .map((p) => p.id);
                              planService.assignProvidersToNetwork(
                                fhirContext,
                                rep.networkId,
                                activeIds,
                              );
                              notify({ title: 'Bulk assigned active providers to network', variant: 'success' });
                              setTick((t) => t + 1);
                            }}
                          >
                            Bulk Assign Active Providers
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Plan-Provider Contracts */}
        {activeTab === 'contracts' && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <th className="px-4 py-3">Provider & Plan</th>
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Term</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {state.contracts.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{c.practitionerName}</p>
                      <p className="text-slate-500">{c.planName}</p>
                    </td>
                    <td className="px-4 py-3">{c.templateName}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{c.effectiveStart} → {c.effectiveEnd}</td>
                    <td className="px-4 py-3">
                      <SemanticStatus
                        label={c.status}
                        tone={c.status === 'Active' || c.status === 'Signed' ? 'success' : 'warning'}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.status !== 'Active' && canEdit && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={async () => {
                            await planService.signContract(
                              fhirContext,
                              c.id,
                              user.name,
                              { name: user.name, role: user.role },
                            );
                            notify({ title: 'Contract signed & ContractSigned event published', variant: 'success' });
                            setTick((t) => t + 1);
                          }}
                        >
                          <FileSignature className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>E-Sign & Activate</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 4: Rate Schedules & Effective Rate Lookup */}
        {activeTab === 'rates' && state.rateSchedules[0] && (
          <div className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-semibold">Effective Rate Lookup (Used by M11 Claims Pricing)</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-5">
                <Input label="CPT/HCPCS" value={rateCode} onChange={(e) => setRateCode(e.target.value)} />
                <Select
                  label="Plan"
                  value={ratePlanId}
                  options={state.plans.map((p) => ({ value: p.id, label: p.planCode }))}
                  onChange={(e) => setRatePlanId(e.target.value)}
                />
                <Select
                  label="Provider Type"
                  value={rateProviderType}
                  options={activeTenant.businessRules.providerTypes.map((t) => ({ value: t, label: t }))}
                  onChange={(e) => setRateProviderType(e.target.value)}
                />
                <Input label="Date of Service" type="date" value={rateDate} onChange={(e) => setRateDate(e.target.value)} />
                <div className="flex items-end">
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => {
                      const res = planService.lookupEffectiveRate(fhirContext, {
                        code: rateCode.trim(),
                        planId: ratePlanId,
                        providerType: rateProviderType,
                        dateOfService: rateDate,
                      });
                      setRateResult(
                        res.found
                          ? `Effective Rate: $${res.rateUsd?.toFixed(2)} (${res.scheduleName})`
                          : 'No matching effective rate for selected code, plan, provider type, and date.',
                      );
                    }}
                  >
                    Lookup Rate
                  </Button>
                </div>
              </div>
              {rateResult && (
                <p className="mt-3 font-mono text-xs font-medium text-brand-800 dark:text-brand-300">
                  {rateResult}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    {state.rateSchedules[0].name} (v{state.rateSchedules[0].version})
                  </h3>
                  <p className="text-xs text-slate-500">
                    {state.rateSchedules[0].entries.length} procedure rate entries
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    const csv = planService.exportFeeScheduleCsv(
                      fhirContext,
                      state.rateSchedules[0].id,
                    );
                    downloadTextFile('fee-schedule.csv', csv, 'text/csv');
                  }}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Export CSV</span>
                </Button>
              </div>
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                    <th className="py-2">Code</th>
                    <th className="py-2">Modifier</th>
                    <th className="py-2">Description</th>
                    <th className="py-2 text-right">Rate (USD)</th>
                    <th className="py-2 text-right">Effective Dates</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {state.rateSchedules[0].entries.map((e, idx) => (
                    <tr key={`${e.code}-${idx}`}>
                      <td className="py-2 font-mono font-medium">{e.code}</td>
                      <td className="py-2 font-mono">{e.modifier || '—'}</td>
                      <td className="py-2">{e.description}</td>
                      <td className="py-2 text-right font-mono tabular-nums">${e.rateUsd.toFixed(2)}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-slate-500">
                        {e.effectiveStart} → {e.effectiveEnd}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {canEdit && (
                <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <TextArea
                    label="Import Additional Fee Schedule Rows (CSV)"
                    rows={3}
                    value={feeCsvText}
                    onChange={(e) => setFeeCsvText(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      try {
                        planService.importFeeScheduleCsv(
                          fhirContext,
                          state.rateSchedules[0].id,
                          feeCsvText,
                        );
                        notify({ title: 'Fee schedule rows imported & version incremented', variant: 'success' });
                        setTick((t) => t + 1);
                      } catch (err) {
                        notify({
                          title: 'Import failed',
                          description: err instanceof Error ? err.message : 'Invalid CSV',
                          variant: 'error',
                        });
                      }
                    }}
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Import CSV Rows</span>
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 5: Prior Auth Rules & Eligibility Checker */}
        {activeTab === 'eligibility' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-semibold">Member Eligibility Check (FHIR Coverage)</h3>
              <Select
                label="Patient"
                value={eligPatientId}
                options={patients.map((p) => ({ value: p.id, label: `${p.fullName} (${p.mrn})` }))}
                onChange={(e) => setEligPatientId(e.target.value)}
              />
              <Select
                label="Plan"
                value={eligPlanId}
                options={state.plans.map((p) => ({ value: p.id, label: p.name }))}
                onChange={(e) => setEligPlanId(e.target.value)}
              />
              <Input label="Date of Service" type="date" value={eligDate} onChange={(e) => setEligDate(e.target.value)} />
              <Button
                variant="primary"
                onClick={async () => {
                  const res = await planService.checkMemberEligibility(
                    fhirContext,
                    eligPatientId,
                    eligPlanId,
                    eligDate,
                  );
                  setEligResult(res);
                }}
              >
                Verify Eligibility
              </Button>
              {eligResult && (
                <div className="rounded-md border border-slate-200 p-3 text-xs dark:border-slate-800">
                  <SemanticStatus
                    label={eligResult.eligible ? 'Eligible' : 'Not Eligible'}
                    tone={eligResult.eligible ? 'success' : 'danger'}
                  />
                  <p className="mt-1 text-slate-600 dark:text-slate-400">{eligResult.reason}</p>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-semibold">Prior Authorization Rules ({state.priorAuthRules.length})</h3>
              <ul className="divide-y divide-slate-200 text-xs dark:divide-slate-800">
                {state.priorAuthRules.map((pa) => (
                  <li key={pa.id} className="py-3">
                    <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      CPT {pa.code} — {pa.description}
                    </p>
                    <p className="mt-1 text-slate-600 dark:text-slate-400">{pa.criteriaText}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Tab 6: Directory Publishing & Reports */}
        {activeTab === 'publish' && (
          <div className="space-y-6">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-semibold">FHIR Plan Directory Publishing ($validate + Diff)</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Builds a FHIR Bundle of InsurancePlan, Organization, OrganizationAffiliation, PractitionerRole, and Location resources, runs $validate, and compares against the last published snapshot.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void handlePreviewPublish()}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>Build, $validate & Diff</span>
                </Button>
                {canEdit && (
                  <Button variant="primary" onClick={() => void handlePublishDirectory()}>
                    <Send className="h-4 w-4" aria-hidden="true" />
                    <span>Publish Directory Snapshot</span>
                  </Button>
                )}
              </div>
              {publishPreview && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-xs dark:border-slate-800 dark:bg-slate-950">
                  Resources: {publishPreview.resourceCount} · $validate:{' '}
                  {publishPreview.validationOk ? 'PASS' : 'FAIL'} · Diff: +{publishPreview.addedCount} added / -{publishPreview.removedCount} removed
                </div>
              )}
              {state.lastPublished && (
                <p className="font-mono text-xs text-slate-500">
                  Last published: {state.lastPublished.publishedAt.slice(0, 19)} ({state.lastPublished.resourceCount} resources)
                </p>
              )}
            </div>

            {reports && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">Networks by Plan</p>
                  <ul className="mt-2 space-y-1 text-slate-600 dark:text-slate-400">
                    {reports.networksByPlan.map((n) => (
                      <li key={n.planId}>
                        {n.planName}: <span className="font-mono">{n.networkCount}</span> (ends {n.endDate})
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Expiring Contracts ({reports.expiringContracts.length})
                  </p>
                  <ul className="mt-2 space-y-1 text-slate-600 dark:text-slate-400">
                    {reports.expiringContracts.map((c) => (
                      <li key={c.id}>
                        {c.practitionerName} — ends <span className="font-mono">{c.effectiveEnd}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Adequacy Gaps ({reports.adequacyGaps.length})
                  </p>
                  <ul className="mt-2 space-y-1 text-slate-600 dark:text-slate-400">
                    {reports.adequacyGaps.length === 0 ? (
                      <li>All networks meet configured adequacy standards.</li>
                    ) : (
                      reports.adequacyGaps.map((g) => (
                        <li key={g.networkId}>
                          {g.networkName} ({g.county}): gap of {g.ratioGap} provider(s)
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        <Modal
          open={createModal}
          title="Create Insurance Plan"
          onClose={() => setCreateModal(false)}
          footer={
            <>
              <Button onClick={() => setCreateModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => void handleCreatePlan()}>
                Create Plan
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input label="Plan Code" required placeholder="e.g. DUAL-2026" value={newPlanCode} onChange={(e) => setNewPlanCode(e.target.value)} />
            <Input label="Plan Name" required placeholder="e.g. Dual Eligible Special Needs Plan" value={newPlanName} onChange={(e) => setNewPlanName(e.target.value)} />
            <Select
              label="Plan Type"
              value={newPlanType}
              options={['FFS', 'MCO', 'CHIP', 'Dual', 'Other'].map((t) => ({ value: t, label: t }))}
              onChange={(e) => setNewPlanType(e.target.value as PlanType)}
            />
          </div>
        </Modal>
      </div>
    </Guard>
  );
}
