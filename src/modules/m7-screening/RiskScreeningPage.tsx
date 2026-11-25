import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Fingerprint,
  ShieldAlert,
  SlidersHorizontal,
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
  screeningService,
  type RiskLevel,
  type RiskScoringRule,
  type ScreeningCaseRecord,
} from './screeningService';

function tierTone(tier: RiskLevel): SemanticTone {
  switch (tier) {
    case 'High':
      return 'danger';
    case 'Moderate':
      return 'warning';
    case 'Limited':
      return 'success';
  }
}

export function RiskScreeningPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user, can } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'workbench' | 'rules'>('workbench');
  const [applications, setApplications] = useState<EnrollmentApplication[]>(() =>
    enrollmentService.listApplications(activeTenant.id),
  );
  const [selectedAppId, setSelectedAppId] = useState<string>(
    () => enrollmentService.listApplications(activeTenant.id)[0]?.id ?? '',
  );
  const [screeningCase, setScreeningCase] = useState<ScreeningCaseRecord | undefined>(
    () =>
      selectedAppId
        ? screeningService.getState(activeTenant.id).cases[selectedAppId]
        : undefined,
  );
  const [rules, setRules] = useState<RiskScoringRule[]>(() => [
    ...screeningService.getState(activeTenant.id).rules,
  ]);
  const [ruleVersions, setRuleVersions] = useState(() => [
    ...screeningService.getState(activeTenant.id).ruleVersions,
  ]);

  // Override modal
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideTier, setOverrideTier] = useState<RiskLevel>('Limited');
  const [overrideReason, setOverrideReason] = useState('');

  useEffect(() => {
    const apps = enrollmentService.listApplications(activeTenant.id);
    setApplications(apps);
    const first = apps[0]?.id ?? '';
    setSelectedAppId(first);
    setScreeningCase(first ? screeningService.getState(activeTenant.id).cases[first] : undefined);
    setRules([...screeningService.getState(activeTenant.id).rules]);
    setRuleVersions([...screeningService.getState(activeTenant.id).ruleVersions]);
    return enrollmentService.subscribe(() => {
      setApplications([...enrollmentService.listApplications(activeTenant.id)]);
    });
  }, [activeTenant.id]);

  const selectedApp = applications.find((a) => a.id === selectedAppId);

  const handleSelectApp = (id: string) => {
    setSelectedAppId(id);
    setScreeningCase(screeningService.getState(activeTenant.id).cases[id]);
  };

  const handleAssignScreening = async () => {
    if (!selectedAppId) return;
    try {
      const assigned = await screeningService.assignScreening(
        fhirContext,
        selectedAppId,
        { name: user.name, role: user.role },
      );
      setScreeningCase({ ...assigned });
      showToast(
        `Assigned ${assigned.effectiveTier} risk screening (RiskAssessment/${assigned.riskAssessmentId}).`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to assign screening', 'error');
    }
  };

  const handleSaveProgress = async (next: ScreeningCaseRecord) => {
    try {
      const updated = await screeningService.updateScreeningTasks(
        fhirContext,
        next.applicationId,
        {
          databaseCheckDone: next.databaseCheckDone,
          siteVisit: next.siteVisit,
          fingerprints: next.fingerprints,
        },
        { name: user.name, role: user.role },
      );
      setScreeningCase({ ...updated });
      if (updated.status === 'Completed') {
        showToast(
          `Screening completed for ${updated.applicationNumber}. Case moved to M8 In Review.`,
          'success',
        );
      } else {
        showToast('Screening task progress saved.', 'info');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
  };

  const handleConfirmOverride = async () => {
    if (!screeningCase) return;
    try {
      const updated = await screeningService.overrideRiskTier(
        fhirContext,
        screeningCase.applicationId,
        overrideTier,
        overrideReason,
        { name: user.name, role: user.role },
      );
      setScreeningCase({ ...updated });
      setOverrideOpen(false);
      setOverrideReason('');
      showToast(`Risk tier overridden to ${overrideTier} with Provenance.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Override failed', 'error');
    }
  };

  return (
    <Guard moduleId="m7-screening" action="view">
      <div className="space-y-6">
        <PageHeader
          kicker={`M7 · Risk-Based Screening · ${activeTenant.code}`}
          title="Risk-Based Screening Workbench"
          description="42 CFR 455.450 Limited / Moderate / High categorical risk evaluation, FHIR RiskAssessment generation, on-site facility inspection forms, and >=5% owner fingerprint tracking."
        />

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'workbench', label: 'Screening Workbench' },
            { id: 'rules', label: `Risk Scoring Rules (v${ruleVersions[0]?.version ?? 1})` },
          ]}
        />

        {tab === 'workbench' && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between dark:border-slate-800 dark:bg-slate-900">
              <div className="w-full max-w-md">
                <Select
                  label="Select Enrollment Case"
                  value={selectedAppId}
                  onChange={(e) => handleSelectApp(e.target.value)}
                  options={applications.map((a) => ({
                    value: a.id,
                    label: `${a.applicationNumber} — ${a.applicantGiven} ${a.applicantFamily} (${a.providerType} · ${a.status})`,
                  }))}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={!selectedAppId || !can('m7-screening', 'edit')}
                  onClick={() => void handleAssignScreening()}
                >
                  <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                  <span>{screeningCase ? 'Re-evaluate Risk Tier' : 'Evaluate & Assign Screening'}</span>
                </Button>
                {screeningCase && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setOverrideTier(screeningCase.effectiveTier);
                      setOverrideOpen(true);
                    }}
                  >
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    <span>Override Risk Tier</span>
                  </Button>
                )}
              </div>
            </div>

            {!screeningCase && selectedApp && (
              <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  Preview Risk Assessment for {selectedApp.applicationNumber}
                </p>
                {(() => {
                  const preview = screeningService.evaluateRiskTier(activeTenant.id, selectedApp);
                  return (
                    <div className="mt-2 space-y-2">
                      <SemanticStatus tone={tierTone(preview.tier)} label={`Projected Tier: ${preview.tier}`} />
                      <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-slate-400">
                        {preview.rationale.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </div>
            )}

            {screeningCase && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div>
                    <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                      {screeningCase.applicationNumber} · RiskAssessment/{screeningCase.riskAssessmentId} · {screeningCase.taskIds.length} FHIR Tasks
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                      {screeningCase.providerName} (NPI {screeningCase.npi})
                    </h2>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      {screeningCase.rationale.join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <SemanticStatus
                      tone={tierTone(screeningCase.effectiveTier)}
                      label={`${screeningCase.effectiveTier} Risk`}
                    />
                    <SemanticStatus
                      tone={screeningCase.status === 'Completed' ? 'success' : 'info'}
                      label={screeningCase.status}
                    />
                  </div>
                </div>

                {/* Task 1: Database checks (all tiers) */}
                <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        1. Federal &amp; State Database Verification (Required for Limited / Moderate / High)
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Confirm NPPES, OIG-LEIE, SAM.gov, PECOS, and state licensure database screening.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={screeningCase.databaseCheckDone}
                        onChange={(e) =>
                          setScreeningCase({
                            ...screeningCase,
                            databaseCheckDone: e.target.checked,
                          })
                        }
                      />
                      Verified
                    </label>
                  </div>
                </div>

                {/* Task 2: Site Visit (Moderate & High) */}
                {screeningCase.requiresSiteVisit && (
                  <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      2. Unannounced On-Site Facility Inspection (Required for Moderate &amp; High Risk)
                    </h3>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <Input
                        label="Inspector Name"
                        value={screeningCase.siteVisit.inspectorName}
                        onChange={(e) =>
                          setScreeningCase({
                            ...screeningCase,
                            siteVisit: { ...screeningCase.siteVisit, inspectorName: e.target.value },
                          })
                        }
                      />
                      <Input
                        label="Inspection Date"
                        type="date"
                        value={screeningCase.siteVisit.visitDate}
                        onChange={(e) =>
                          setScreeningCase({
                            ...screeningCase,
                            siteVisit: { ...screeningCase.siteVisit, visitDate: e.target.value },
                          })
                        }
                      />
                      <Select
                        label="Inspection Outcome"
                        value={screeningCase.siteVisit.outcome}
                        onChange={(e) =>
                          setScreeningCase({
                            ...screeningCase,
                            siteVisit: {
                              ...screeningCase.siteVisit,
                              outcome: e.target.value as 'Pending' | 'Passed' | 'Failed',
                              completed: e.target.value !== 'Pending',
                            },
                          })
                        }
                        options={[
                          { value: 'Pending', label: 'Pending' },
                          { value: 'Passed', label: 'Passed' },
                          { value: 'Failed', label: 'Failed' },
                        ]}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                      {(
                        [
                          ['signageVerified', 'Exterior signage visible'],
                          ['hoursPosted', 'Operating hours posted'],
                          ['adaAccessible', 'ADA accessible entrance'],
                          ['equipmentPresent', 'Clinical equipment present'],
                        ] as const
                      ).map(([field, label]) => (
                        <label
                          key={field}
                          className="flex items-center gap-2 rounded border border-slate-200 p-2.5 dark:border-slate-800"
                        >
                          <input
                            type="checkbox"
                            checked={screeningCase.siteVisit[field]}
                            onChange={(e) =>
                              setScreeningCase({
                                ...screeningCase,
                                siteVisit: {
                                  ...screeningCase.siteVisit,
                                  [field]: e.target.checked,
                                },
                              })
                            }
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <TextArea
                      label="Inspector Field Notes"
                      value={screeningCase.siteVisit.notes}
                      onChange={(e) =>
                        setScreeningCase({
                          ...screeningCase,
                          siteVisit: { ...screeningCase.siteVisit, notes: e.target.value },
                        })
                      }
                    />
                  </div>
                )}

                {/* Task 3: Fingerprint Background Check (High only) */}
                {screeningCase.requiresFingerprint && (
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center gap-2">
                      <Fingerprint className="h-4 w-4 text-brand-700 dark:text-brand-400" aria-hidden="true" />
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        3. Fingerprint Criminal Background Check — Owners &gt;= 5% (High Risk)
                      </h3>
                    </div>
                    <div className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                      {screeningCase.fingerprints.map((fp, idx) => (
                        <div
                          key={`${fp.ownerName}-${idx}`}
                          className="flex flex-wrap items-center justify-between gap-3 p-3.5 text-sm"
                        >
                          <div>
                            <p className="font-medium text-slate-900 dark:text-slate-100">
                              {fp.ownerName}
                            </p>
                            <p className="font-mono text-xs text-slate-500">
                              Ownership: {fp.ownershipPercent}%
                            </p>
                          </div>
                          <select
                            aria-label={`Fingerprint status for ${fp.ownerName}`}
                            value={fp.status}
                            onChange={(e) => {
                              const next = [...screeningCase.fingerprints];
                              next[idx] = {
                                ...fp,
                                status: e.target.value as typeof fp.status,
                                clearedDate:
                                  e.target.value === 'Cleared'
                                    ? new Date().toISOString().slice(0, 10)
                                    : undefined,
                              };
                              setScreeningCase({ ...screeningCase, fingerprints: next });
                            }}
                            className="h-9 rounded border border-slate-300 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                          >
                            <option value="Pending">Pending</option>
                            <option value="Submitted">Submitted to FBI/State</option>
                            <option value="Cleared">Cleared</option>
                            <option value="Flagged">Flagged</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button onClick={() => void handleSaveProgress(screeningCase)}>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    <span>Save &amp; Evaluate Screening Completion</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'rules' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <SlidersHorizontal className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Tenant Risk Classification Rules
                </h2>
              </div>
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Condition</th>
                    <th className="px-4 py-3">Factor</th>
                    <th className="px-4 py-3">Risk Tier</th>
                    <th className="px-4 py-3">Enabled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                        {rule.conditionLabel}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {rule.factor}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`Tier for ${rule.conditionLabel}`}
                          value={rule.resultingTier}
                          onChange={(e) => {
                            const updated = screeningService.updateRule(
                              activeTenant.id,
                              rule.id,
                              { resultingTier: e.target.value as RiskLevel },
                              `${user.name} (${user.role})`,
                            );
                            setRules([...updated]);
                            setRuleVersions([
                              ...screeningService.getState(activeTenant.id).ruleVersions,
                            ]);
                          }}
                          className="h-8 rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="Limited">Limited</option>
                          <option value="Moderate">Moderate</option>
                          <option value="High">High</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          aria-label={`Toggle ${rule.conditionLabel}`}
                          onChange={(e) => {
                            const updated = screeningService.updateRule(
                              activeTenant.id,
                              rule.id,
                              { enabled: e.target.checked },
                              `${user.name} (${user.role})`,
                            );
                            setRules([...updated]);
                            setRuleVersions([
                              ...screeningService.getState(activeTenant.id).ruleVersions,
                            ]);
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Rule Version History
              </h3>
              <ul className="mt-3 divide-y divide-slate-100 text-xs dark:divide-slate-800">
                {ruleVersions.map((v) => (
                  <li key={v.version} className="py-2.5">
                    <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      v{v.version} · {new Date(v.timestamp).toLocaleDateString()}
                    </p>
                    <p className="text-slate-600 dark:text-slate-400">{v.summary}</p>
                    <p className="text-slate-500">{v.actor}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <Modal
          open={overrideOpen}
          onClose={() => setOverrideOpen(false)}
          title="Override Categorical Risk Tier"
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Requires AgencyApprover, ProgramIntegrityOfficer, or PlatformAdmin role. Writes a FHIR Provenance record.
            </p>
            <Select
              label="New Risk Tier"
              value={overrideTier}
              onChange={(e) => setOverrideTier(e.target.value as RiskLevel)}
              options={[
                { value: 'Limited', label: 'Limited' },
                { value: 'Moderate', label: 'Moderate' },
                { value: 'High', label: 'High' },
              ]}
            />
            <TextArea
              label="Mandatory Override Justification"
              required
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOverrideOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleConfirmOverride()}>Apply Override</Button>
            </div>
          </div>
        </Modal>
      </div>
    </Guard>
  );
}
