import { useEffect, useState } from 'react';
import {
  FileWarning,
  Play,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
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
  validationService,
  type ExclusionRecord,
  type ValidationOutcome,
  type ValidationRunReport,
  type ValidatorRuleConfig,
} from './validationService';

function outcomeTone(status: ValidationOutcome): SemanticTone {
  switch (status) {
    case 'Pass':
      return 'success';
    case 'Fail':
      return 'danger';
    case 'Warning':
      return 'warning';
    case 'Unable':
      return 'neutral';
  }
}

export function ValidationEnginePage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user, can } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'workbench' | 'rules' | 'reference'>('workbench');
  const [applications, setApplications] = useState<EnrollmentApplication[]>(() =>
    enrollmentService.listApplications(activeTenant.id),
  );
  const [selectedAppId, setSelectedAppId] = useState<string>(
    () => enrollmentService.listApplications(activeTenant.id)[0]?.id ?? '',
  );
  const [report, setReport] = useState<ValidationRunReport | undefined>(() =>
    selectedAppId ? validationService.getLatestRun(activeTenant.id, selectedAppId) : undefined,
  );
  const [rules, setRules] = useState<ValidatorRuleConfig[]>(() => [
    ...validationService.getState(activeTenant.id).rules,
  ]);
  const [exclusions, setExclusions] = useState<ExclusionRecord[]>(() => [
    ...validationService.getState(activeTenant.id).refData.exclusions,
  ]);
  const [running, setRunning] = useState(false);

  // Override modal state
  const [overrideTarget, setOverrideTarget] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  // New exclusion form
  const [newExclName, setNewExclName] = useState('');
  const [newExclNpi, setNewExclNpi] = useState('');
  const [newExclSource, setNewExclSource] = useState<'OIG-LEIE' | 'SAM.gov'>('OIG-LEIE');
  const [newExclReason, setNewExclReason] = useState('1128(a)(1) Program Fraud');

  useEffect(() => {
    const apps = enrollmentService.listApplications(activeTenant.id);
    setApplications(apps);
    const firstId = apps[0]?.id ?? '';
    setSelectedAppId(firstId);
    setReport(firstId ? validationService.getLatestRun(activeTenant.id, firstId) : undefined);
    setRules([...validationService.getState(activeTenant.id).rules]);
    setExclusions([...validationService.getState(activeTenant.id).refData.exclusions]);

    return enrollmentService.subscribe(() => {
      setApplications([...enrollmentService.listApplications(activeTenant.id)]);
    });
  }, [activeTenant.id]);

  const handleSelectApp = (appId: string) => {
    setSelectedAppId(appId);
    setReport(validationService.getLatestRun(activeTenant.id, appId));
  };

  const handleRunValidation = async () => {
    if (!selectedAppId) return;
    setRunning(true);
    try {
      const next = await validationService.runValidationSuite(
        fhirContext,
        selectedAppId,
        { name: user.name, role: user.role },
      );
      setReport({ ...next });
      showToast(
        `Validation complete (${next.overallStatus}): ${next.results.filter((r) => r.status === 'Pass').length}/${next.results.length} passed.`,
        next.overallStatus === 'Fail' ? 'warning' : 'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Validation run failed', 'error');
    } finally {
      setRunning(false);
    }
  };

  const handleConfirmOverride = async () => {
    if (!overrideTarget || !selectedAppId) return;
    try {
      await validationService.overrideValidationFinding(
        fhirContext,
        selectedAppId,
        overrideTarget,
        overrideReason,
        { name: user.name, role: user.role },
      );
      setReport(validationService.getLatestRun(activeTenant.id, selectedAppId));
      setOverrideTarget(null);
      setOverrideReason('');
      showToast('Finding overridden with FHIR Provenance record.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Override failed', 'error');
    }
  };

  const handleCreateRfi = async () => {
    if (!selectedAppId) return;
    const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    try {
      await validationService.createRfiFromFailures(
        fhirContext,
        selectedAppId,
        dueDate,
        { name: user.name, role: user.role },
      );
      showToast(`RFI created and transmitted (due ${dueDate}).`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create RFI', 'error');
    }
  };

  const handleAddExclusion = () => {
    if (!newExclName.trim()) {
      showToast('Exclusion entity name is required.', 'warning');
      return;
    }
    validationService.addExclusionEntry(activeTenant.id, {
      name: newExclName.trim(),
      npi: newExclNpi.trim() || undefined,
      source: newExclSource,
      exclusionType: newExclReason.trim() || 'Federal Exclusion',
      effectiveDate: new Date().toISOString().slice(0, 10),
    });
    setExclusions([...validationService.getState(activeTenant.id).refData.exclusions]);
    setNewExclName('');
    setNewExclNpi('');
    showToast('Added entry to tenant SAM/OIG-LEIE exclusion reference list.', 'success');
  };

  return (
    <Guard moduleId="m6-validation" action="view">
      <div className="space-y-6">
        <PageHeader
          kicker={`M6 · Automated Validation Engine · ${activeTenant.code}`}
          title="Automated Validation Engine"
          description="Parallel 9-validator orchestrator (NPI, State License, SAM/OIG-LEIE, Death Master, USPS, Duplicate, TIN, DEA, Taxonomy) with DetectedIssue persistence and Provenance overrides."
        />

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'workbench', label: 'Analyst Workbench' },
            { id: 'rules', label: `Validator Rules (${rules.filter((r) => r.enabled).length}/9 active)` },
            { id: 'reference', label: `Exclusion & Reference Data (${exclusions.length})` },
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
                    label: `${a.applicationNumber} — ${a.applicantGiven} ${a.applicantFamily} (${a.status})`,
                  }))}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  loading={running}
                  disabled={!selectedAppId || !can('m6-validation', 'edit')}
                  onClick={() => void handleRunValidation()}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  <span>{report ? 'Re-run All Validators' : 'Run Validation Suite'}</span>
                </Button>
                {report && report.results.some((r) => (r.status === 'Fail' || r.status === 'Warning') && !r.overridden) && (
                  <Button variant="secondary" onClick={() => void handleCreateRfi()}>
                    <FileWarning className="h-4 w-4" aria-hidden="true" />
                    <span>Create RFI from Failures</span>
                  </Button>
                )}
              </div>
            </div>

            {!report ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                Select an enrollment application above and click <strong>Run Validation Suite</strong> to execute all enabled validators in parallel.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                  <div>
                    <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                      Run {report.id} · {new Date(report.runAt).toLocaleString()} · NPI {report.npi}
                    </p>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      {report.applicationNumber} — {report.providerName}
                    </h2>
                  </div>
                  <SemanticStatus
                    tone={outcomeTone(report.overallStatus)}
                    label={`Overall: ${report.overallStatus}`}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {report.results.map((r) => (
                    <div
                      key={r.validatorId}
                      className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {r.validatorName}
                            </h3>
                            <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {r.severity} · {r.sourceMode} · {r.durationMs}ms
                            </p>
                          </div>
                          <SemanticStatus
                            tone={r.overridden ? 'info' : outcomeTone(r.status)}
                            label={r.overridden ? 'Overridden' : r.status}
                          />
                        </div>
                        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                          {r.evidence}
                        </p>
                        {r.fallbackWarning && (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            {r.fallbackWarning}
                          </p>
                        )}
                        {r.detectedIssueId && (
                          <p className="font-mono text-[11px] text-slate-500">
                            FHIR DetectedIssue/{r.detectedIssueId}
                          </p>
                        )}
                        {r.overridden && (
                          <p className="rounded bg-slate-50 p-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            Override: {r.overridden.reason} ({r.overridden.actor})
                          </p>
                        )}
                      </div>
                      {(r.status === 'Fail' || r.status === 'Warning') && !r.overridden && can('m6-validation', 'approve') && (
                        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setOverrideTarget(r.validatorId)}
                          >
                            Override with Reason
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'rules' && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Validator</th>
                    <th className="px-4 py-3">Enabled</th>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Timeout (ms)</th>
                    <th className="px-4 py-3">Adapter Mode</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{rule.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{rule.description}</p>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Enable ${rule.name}`}
                          checked={rule.enabled}
                          onChange={(e) => {
                            const updated = validationService.updateRule(activeTenant.id, rule.id, {
                              enabled: e.target.checked,
                            });
                            setRules([...updated]);
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`${rule.name} severity`}
                          value={rule.severity}
                          onChange={(e) => {
                            const updated = validationService.updateRule(activeTenant.id, rule.id, {
                              severity: e.target.value as ValidatorRuleConfig['severity'],
                            });
                            setRules([...updated]);
                          }}
                          className="h-8 rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="Critical">Critical</option>
                          <option value="Major">Major</option>
                          <option value="Advisory">Advisory</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          aria-label={`${rule.name} timeout`}
                          min={500}
                          max={30000}
                          step={500}
                          value={rule.timeoutMs}
                          onChange={(e) => {
                            const updated = validationService.updateRule(activeTenant.id, rule.id, {
                              timeoutMs: Number(e.target.value) || 4000,
                            });
                            setRules([...updated]);
                          }}
                          className="h-8 w-24 rounded border border-slate-300 bg-white px-2 font-mono text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`${rule.name} mode`}
                          value={rule.mode}
                          onChange={(e) => {
                            const updated = validationService.updateRule(activeTenant.id, rule.id, {
                              mode: e.target.value as 'Mock' | 'Gateway',
                            });
                            setRules([...updated]);
                          }}
                          className="h-8 rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="Mock">Mock</option>
                          <option value="Gateway">Gateway (fallback Mock)</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'reference' && (
          <div className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Add SAM / OIG-LEIE Exclusion Entry (Shared with M12 Ongoing Monitoring)
                </h2>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                <Input
                  label="Provider / Entity Name"
                  value={newExclName}
                  onChange={(e) => setNewExclName(e.target.value)}
                  placeholder="Dr. Elena Vargas"
                />
                <Input
                  label="NPI (Optional)"
                  value={newExclNpi}
                  onChange={(e) => setNewExclNpi(e.target.value)}
                  placeholder="10-digit NPI"
                />
                <Select
                  label="Source List"
                  value={newExclSource}
                  onChange={(e) => setNewExclSource(e.target.value as 'OIG-LEIE' | 'SAM.gov')}
                  options={[
                    { value: 'OIG-LEIE', label: 'OIG-LEIE' },
                    { value: 'SAM.gov', label: 'SAM.gov' },
                  ]}
                />
                <Input
                  label="Exclusion Type"
                  value={newExclReason}
                  onChange={(e) => setNewExclReason(e.target.value)}
                />
              </div>
              <div className="mt-3">
                <Button size="sm" onClick={handleAddExclusion}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add Exclusion Record</span>
                </Button>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Excluded Party</th>
                    <th className="px-4 py-3">NPI</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Authority / Type</th>
                    <th className="px-4 py-3">Effective</th>
                    <th className="px-4 py-3 text-right">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {exclusions.map((ex) => (
                    <tr key={ex.id}>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                        {ex.name}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                        {ex.npi ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">{ex.source}</td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                        {ex.exclusionType}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums">
                        {ex.effectiveDate}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${ex.name}`}
                          onClick={() => {
                            validationService.removeExclusionEntry(activeTenant.id, ex.id);
                            setExclusions([
                              ...validationService.getState(activeTenant.id).refData.exclusions,
                            ]);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <Modal
          open={Boolean(overrideTarget)}
          onClose={() => setOverrideTarget(null)}
          title="Override Validation Finding (Audited Provenance)"
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Overriding a validation failure writes an immutable FHIR Provenance and AuditEvent record.
            </p>
            <TextArea
              label="Mandatory Justification Reason"
              required
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Document primary-source verification evidence justifying this override..."
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOverrideTarget(null)}>
                Cancel
              </Button>
              <Button onClick={() => void handleConfirmOverride()}>
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>Confirm Override</span>
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </Guard>
  );
}
