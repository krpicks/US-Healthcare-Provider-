import { useMemo, useState } from 'react';
import {
  Check,
  Download,
  Plus,
  RotateCcw,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import {
  Button,
  DataTable,
  Input,
  Modal,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  TextArea,
  useToast,
  type DataTableColumn,
} from '../../components';
import { Guard } from '../../app/Guard';
import { useAuth, usePermission } from '../../app/AuthContext';
import { downloadTextFile } from '../../services';
import {
  tenantService,
  useTenantContext,
  type ConfigImportValidationReport,
  type ConfigScope,
  type EffectiveConfigEntry,
  type EnvironmentName,
  type TenantRecord,
} from '../../tenancy';
import { TenantOnboardingWizard } from './TenantOnboardingWizard';

export function TenantsPage() {
  const { activeTenant, availableTenants, setActiveTenantById } =
    useTenantContext();
  const { user } = useAuth();
  const { notify } = useToast();

  const canCreate = usePermission('m24-tenants', 'create');
  const canEdit = usePermission('m24-tenants', 'edit');
  const canApprove = usePermission('m24-tenants', 'approve');

  const [activeTab, setActiveTab] = useState('dashboard');
  const [showWizard, setShowWizard] = useState(false);
  const [envFilter, setEnvFilter] = useState<EnvironmentName>('dev');
  const [editingEntry, setEditingEntry] = useState<EffectiveConfigEntry | null>(
    null,
  );
  const [editValue, setEditValue] = useState('');
  const [editScope, setEditScope] = useState<ConfigScope>('TENANT');

  const [showImportModal, setShowImportModal] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importReport, setImportReport] =
    useState<ConfigImportValidationReport | null>(null);
  const [deletionDate, setDeletionDate] = useState('2027-03-01');
  const [refreshTick, setRefreshTick] = useState(0);

  const effectiveConfig = useMemo(
    () => tenantService.resolveEffectiveConfig(activeTenant.id, envFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTenant.id, envFilter, activeTenant.updatedAt, refreshTick],
  );

  const driftCount = useMemo(
    () =>
      effectiveConfig.filter(
        (c) => c.sourceLayer === 'TENANT' || c.sourceLayer === 'ENVIRONMENT',
      ).length,
    [effectiveConfig],
  );

  const handleSaveConfig = async () => {
    if (!editingEntry) return;
    try {
      const def = editingEntry.definition;
      const parsedVal =
        def.type === 'number'
          ? Number(editValue)
          : def.type === 'boolean'
            ? editValue === 'true'
            : editValue;
      const change = await tenantService.updateConfigSetting(
        activeTenant.id,
        def.key,
        parsedVal,
        editScope,
        { name: user.name, role: user.role },
        envFilter,
      );
      notify({
        title:
          change.status === 'PendingApproval'
            ? 'Sensitive change queued for approval'
            : `Updated ${def.key}`,
        description:
          change.status === 'PendingApproval'
            ? 'Requires AgencyApprover or PlatformAdmin sign-off.'
            : `Effective value updated at ${editScope} layer.`,
        variant: change.status === 'PendingApproval' ? 'info' : 'success',
      });
      setEditingEntry(null);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      notify({
        title: 'Configuration update rejected',
        description: err instanceof Error ? err.message : 'Validation failed.',
        variant: 'error',
      });
    }
  };

  const handleApproveChange = async (version: number) => {
    try {
      await tenantService.approvePendingConfig(activeTenant.id, version, {
        name: user.name,
        role: user.role,
      });
      notify({ title: `Approved config change v${version}`, variant: 'success' });
      setRefreshTick((t) => t + 1);
    } catch (err) {
      notify({
        title: 'Approval failed',
        description: err instanceof Error ? err.message : 'Forbidden',
        variant: 'error',
      });
    }
  };

  const handleRollback = async (version: number) => {
    try {
      await tenantService.rollbackConfigVersion(activeTenant.id, version, {
        name: user.name,
        role: user.role,
      });
      notify({ title: `Rolled back config change v${version}`, variant: 'success' });
      setRefreshTick((t) => t + 1);
    } catch (err) {
      notify({
        title: 'Rollback failed',
        description: err instanceof Error ? err.message : 'Error',
        variant: 'error',
      });
    }
  };

  const handleExportConfig = () => {
    const json = tenantService.exportConfigJson(activeTenant.id);
    downloadTextFile(
      `${activeTenant.code}-config.json`,
      json,
      'application/json',
    );
    notify({
      title: 'Configuration JSON exported',
      description: 'Secrets excluded; vault references preserved.',
      variant: 'success',
    });
  };

  const handleValidateImport = () => {
    setImportReport(tenantService.validateConfigImportJson(importJson));
  };

  const handleApplyImport = async () => {
    try {
      await tenantService.applyConfigImportJson(activeTenant.id, importJson, {
        name: user.name,
        role: user.role,
      });
      notify({ title: 'Configuration JSON imported', variant: 'success' });
      setShowImportModal(false);
      setImportJson('');
      setImportReport(null);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      notify({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Invalid JSON',
        variant: 'error',
      });
    }
  };

  const handleExportDataBundle = async () => {
    const bundle = await tenantService.exportTenantDataBundle(activeTenant.id, {
      name: user.name,
      role: user.role,
    });
    downloadTextFile(
      `${activeTenant.code}-fhir-export.json`,
      JSON.stringify(bundle, null, 2),
      'application/json',
    );
    notify({
      title: 'Tenant FHIR data bundle exported',
      description: `${bundle.total ?? 0} resources exported and audited.`,
      variant: 'success',
    });
  };

  const handleScheduleDeletion = async () => {
    try {
      await tenantService.scheduleOffboardingDeletion(
        activeTenant.id,
        deletionDate,
        { name: user.name, role: user.role },
      );
      notify({
        title: 'Offboarding deletion scheduled',
        description: `Tenant ${activeTenant.code} marked Offboarded for ${deletionDate}.`,
        variant: 'info',
      });
      setRefreshTick((t) => t + 1);
    } catch (err) {
      notify({
        title: 'Deletion blocked',
        description: err instanceof Error ? err.message : 'Error',
        variant: 'error',
      });
    }
  };

  const tenantColumns: DataTableColumn<TenantRecord>[] = [
    {
      key: 'code',
      header: 'Code',
      sortable: true,
      sortValue: (t) => t.code,
      render: (t) => <span className="font-mono text-xs">{t.code}</span>,
    },
    {
      key: 'legalName',
      header: 'Tenant Legal Name',
      sortable: true,
      sortValue: (t) => t.legalName,
      render: (t) => (
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {t.legalName}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type / Program',
      sortable: true,
      sortValue: (t) => t.type,
      render: (t) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {t.type} · {t.programTemplate}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (t) => t.status,
      render: (t) => (
        <SemanticStatus
          label={t.status}
          tone={
            t.status === 'Active'
              ? 'success'
              : t.status === 'Suspended' || t.status === 'Offboarded'
                ? 'danger'
                : 'warning'
          }
        />
      ),
    },
    {
      key: 'region',
      header: 'Region',
      render: (t) => (
        <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
          {t.dataRegion}
        </span>
      ),
    },
  ];

  return (
    <Guard
      moduleId="m24-tenants"
      action="view"
      moduleName="Tenant Configuration & Onboarding (M24)"
      showForbiddenPage
    >
      <div className="space-y-6">
        <PageHeader
          kicker={`M24 · Active Tenant: ${activeTenant.code} (${activeTenant.programTemplate})`}
          title="Tenant Configuration & Onboarding"
          description="Provision isolated multi-tenant workspaces, resolve layered configuration overrides, manage feature flags, and govern offboarding with legal hold checks."
          actions={
            canCreate && !showWizard ? (
              <Button variant="primary" onClick={() => setShowWizard(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Onboard Tenant</span>
              </Button>
            ) : undefined
          }
        />

        {showWizard ? (
          <TenantOnboardingWizard
            onProvisioned={(created) => {
              setShowWizard(false);
              if (user.role === 'PlatformAdmin') {
                setActiveTenantById(created.id);
              }
            }}
            onCancel={() => setShowWizard(false)}
          />
        ) : (
          <>
            <Tabs
              activeTab={activeTab}
              onChange={setActiveTab}
              tabs={[
                { id: 'dashboard', label: 'Tenant Dashboard', count: availableTenants.length },
                { id: 'config', label: 'Layered Configuration', count: effectiveConfig.length },
                { id: 'flags', label: 'Feature Flags', count: activeTenant.featureFlags.length },
                { id: 'offboarding', label: 'Offboarding & Legal Hold' },
              ]}
            />

            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                <dl className="grid grid-cols-1 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                  <div className="p-4">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Active Tenant Status</dt>
                    <dd className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {activeTenant.status}
                    </dd>
                    <p className="mt-0.5 text-xs text-slate-500">
                      SLA {activeTenant.businessRules.slaDays}d · Reval {activeTenant.businessRules.revalidationMonths}m
                    </p>
                  </div>
                  <div className="p-4">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Configuration Drift</dt>
                    <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {driftCount} override(s)
                    </dd>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Diverged from platform/program defaults
                    </p>
                  </div>
                  <div className="p-4">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Integration Health</dt>
                    <dd className="mt-1">
                      <SemanticStatus label="FHIR & Gateway Nominal" tone="success" />
                    </dd>
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      Vault ref: {activeTenant.endpoints.vaultSecretRef.slice(0, 28)}…
                    </p>
                  </div>
                  <div className="p-4">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Legal Hold</dt>
                    <dd className="mt-1">
                      <SemanticStatus
                        label={activeTenant.legalHold ? 'Active Hold' : 'No Hold'}
                        tone={activeTenant.legalHold ? 'warning' : 'neutral'}
                      />
                    </dd>
                    <p className="mt-1 text-xs text-slate-500">
                      Region: {activeTenant.dataRegion}
                    </p>
                  </div>
                </dl>

                <DataTable
                  rows={
                    user.role === 'PlatformAdmin'
                      ? availableTenants
                      : [activeTenant]
                  }
                  columns={tenantColumns}
                  getRowKey={(t) => t.id}
                  selectedRowKey={activeTenant.id}
                  onRowClick={(t) => {
                    if (user.role === 'PlatformAdmin') {
                      setActiveTenantById(t.id);
                    }
                  }}
                  searchPlaceholder="Search tenants..."
                  searchText={(t) => `${t.code} ${t.legalName} ${t.type} ${t.programTemplate}`}
                />
              </div>
            )}

            {activeTab === 'config' && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Select
                      aria-label="Configuration environment"
                      value={envFilter}
                      options={[
                        { value: 'local', label: 'Environment: local' },
                        { value: 'dev', label: 'Environment: dev' },
                        { value: 'test', label: 'Environment: test' },
                        { value: 'staging', label: 'Environment: staging' },
                        { value: 'production', label: 'Environment: production' },
                      ]}
                      onChange={(e) => setEnvFilter(e.target.value as EnvironmentName)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={handleExportConfig}>
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Export JSON</span>
                    </Button>
                    {canEdit && (
                      <Button size="sm" onClick={() => setShowImportModal(true)}>
                        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Import JSON</span>
                      </Button>
                    )}
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                          <th className="px-4 py-3">Setting Key</th>
                          <th className="px-4 py-3">Effective Value</th>
                          <th className="px-4 py-3">Source Layer</th>
                          <th className="px-4 py-3">Sensitivity</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {effectiveConfig.map((entry) => (
                          <tr key={entry.definition.key}>
                            <td className="px-4 py-3">
                              <p className="font-mono text-xs font-medium text-slate-900 dark:text-slate-100">
                                {entry.definition.key}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {entry.definition.description}
                              </p>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs tabular-nums text-slate-900 dark:text-slate-100">
                              {String(entry.effectiveValue)}
                              {entry.pendingApproval && (
                                <p className="mt-0.5 text-amber-700 dark:text-amber-400">
                                  Pending: {String(entry.pendingApproval.newValue)}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                              {entry.sourceLayer}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                              {entry.definition.sensitive ? 'Sensitive (Approval)' : 'Standard'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {canEdit && (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setEditingEntry(entry);
                                    setEditValue(String(entry.effectiveValue));
                                    setEditScope('TENANT');
                                  }}
                                >
                                  Override
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Versioned History with Diff, Approve & Rollback */}
                <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Configuration Version History ({activeTenant.configHistory.length})
                  </h3>
                  {activeTenant.configHistory.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      No configuration edits recorded yet for this tenant.
                    </p>
                  ) : (
                    <div className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
                      {activeTenant.configHistory.map((h) => (
                        <div
                          key={h.version}
                          className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
                        >
                          <div className="space-y-0.5">
                            <p className="font-mono font-medium text-slate-900 dark:text-slate-100">
                              v{h.version} · {h.key} ({h.scope})
                            </p>
                            <p className="font-mono text-slate-600 dark:text-slate-400">
                              {String(h.previousValue)} → {String(h.newValue)}
                            </p>
                            <p className="text-slate-500">
                              {h.actor} · {h.timestamp.slice(0, 19).replace('T', ' ')}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <SemanticStatus
                              label={h.status}
                              tone={
                                h.status === 'Applied'
                                  ? 'success'
                                  : h.status === 'PendingApproval'
                                    ? 'warning'
                                    : 'neutral'
                              }
                            />
                            {h.status === 'PendingApproval' && canApprove && (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => void handleApproveChange(h.version)}
                              >
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Approve</span>
                              </Button>
                            )}
                            {h.status === 'Applied' && canEdit && (
                              <Button
                                size="sm"
                                onClick={() => void handleRollback(h.version)}
                              >
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Rollback</span>
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'flags' && (
              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                {activeTenant.featureFlags.map((flag) => (
                  <div
                    key={flag.key}
                    className="flex flex-wrap items-center justify-between gap-4 p-4"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {flag.label}
                      </p>
                      <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                        {flag.key} · env: {flag.environment}
                        {flag.scheduledEnableAt
                          ? ` · scheduled: ${flag.scheduledEnableAt.slice(0, 10)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <span>Rollout %</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          disabled={!canEdit}
                          value={flag.rolloutPercentage}
                          onChange={(e) => {
                            tenantService.updateFeatureFlag(activeTenant.id, flag.key, {
                              rolloutPercentage: Math.max(0, Math.min(100, Number(e.target.value))),
                            });
                            setRefreshTick((t) => t + 1);
                          }}
                          className="h-8 w-20 rounded border border-slate-300 bg-white px-2 font-mono text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                        />
                      </label>
                      <Button
                        size="sm"
                        variant={flag.enabled ? 'primary' : 'secondary'}
                        disabled={!canEdit}
                        onClick={() => {
                          tenantService.updateFeatureFlag(activeTenant.id, flag.key, {
                            enabled: !flag.enabled,
                          });
                          setRefreshTick((t) => t + 1);
                        }}
                      >
                        {flag.enabled ? 'Enabled' : 'Disabled'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'offboarding' && (
              <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Tenant Offboarding & Data Governance
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Offboarding follows a three-step governance sequence: suspend active
                  access, export the tenant FHIR collection bundle, and schedule
                  partition deletion after confirming no legal hold is active.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Button
                    disabled={!canEdit}
                    onClick={async () => {
                      await tenantService.suspendTenant(activeTenant.id, {
                        name: user.name,
                        role: user.role,
                      });
                      notify({ title: `Tenant ${activeTenant.code} suspended`, variant: 'info' });
                      setRefreshTick((t) => t + 1);
                    }}
                  >
                    1. Suspend Tenant
                  </Button>
                  <Button onClick={() => void handleExportDataBundle()}>
                    <Download className="h-4 w-4" aria-hidden="true" />
                    <span>2. Export FHIR Data Bundle</span>
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!canEdit}
                    onClick={() => {
                      tenantService.toggleLegalHold(
                        activeTenant.id,
                        !activeTenant.legalHold,
                      );
                      setRefreshTick((t) => t + 1);
                    }}
                  >
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {activeTenant.legalHold
                        ? 'Release Legal Hold'
                        : 'Place Legal Hold'}
                    </span>
                  </Button>
                </div>

                <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <div className="w-56">
                    <Input
                      label="Scheduled Deletion Date"
                      type="date"
                      value={deletionDate}
                      onChange={(e) => setDeletionDate(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="danger"
                    disabled={!canEdit}
                    onClick={() => void handleScheduleDeletion()}
                  >
                    3. Schedule Partition Deletion
                  </Button>
                </div>
                {activeTenant.legalHold && (
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                    Legal hold is currently active on {activeTenant.code}. Deletion
                    requests are blocked until hold is released.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* Config Edit Modal */}
        <Modal
          open={Boolean(editingEntry)}
          title={`Override ${editingEntry?.definition.key ?? ''}`}
          description={editingEntry?.definition.description}
          onClose={() => setEditingEntry(null)}
          footer={
            <>
              <Button onClick={() => setEditingEntry(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => void handleSaveConfig()}>
                Save override
              </Button>
            </>
          }
        >
          {editingEntry && (
            <div className="space-y-4">
              <Select
                label="Target Override Layer"
                value={editScope}
                options={[
                  { value: 'TENANT', label: 'TENANT layer' },
                  { value: 'ENVIRONMENT', label: `ENVIRONMENT (${envFilter}) layer` },
                ]}
                onChange={(e) => setEditScope(e.target.value as ConfigScope)}
              />
              {editingEntry.definition.type === 'boolean' ? (
                <Select
                  label="Value"
                  value={editValue}
                  options={[
                    { value: 'true', label: 'true' },
                    { value: 'false', label: 'false' },
                  ]}
                  onChange={(e) => setEditValue(e.target.value)}
                />
              ) : editingEntry.definition.allowedValues ? (
                <Select
                  label="Value"
                  value={editValue}
                  options={editingEntry.definition.allowedValues.map((v) => ({
                    value: v,
                    label: v,
                  }))}
                  onChange={(e) => setEditValue(e.target.value)}
                />
              ) : (
                <Input
                  label="Value"
                  type={editingEntry.definition.type === 'number' ? 'number' : 'text'}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                />
              )}
            </div>
          )}
        </Modal>

        {/* Config JSON Import Modal */}
        <Modal
          open={showImportModal}
          title="Import Tenant Configuration JSON"
          description="Validate schema and strip any raw secret keys before applying changes."
          onClose={() => {
            setShowImportModal(false);
            setImportReport(null);
          }}
          footer={
            <>
              <Button onClick={() => setShowImportModal(false)}>Cancel</Button>
              <Button onClick={handleValidateImport}>Validate JSON</Button>
              <Button
                variant="primary"
                disabled={!importReport?.valid}
                onClick={() => void handleApplyImport()}
              >
                Apply Import
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <TextArea
              label="Configuration JSON"
              rows={8}
              placeholder='{"configOverrides": {"enrollment.slaDays": 25}}'
              value={importJson}
              onChange={(e) => {
                setImportJson(e.target.value);
                setImportReport(null);
              }}
              className="font-mono text-xs"
            />
            {importReport && (
              <div className="rounded-md border border-slate-200 p-3 text-xs dark:border-slate-800">
                <SemanticStatus
                  label={importReport.valid ? 'Validation Passed' : 'Validation Failed'}
                  tone={importReport.valid ? 'success' : 'danger'}
                />
                {importReport.errors.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-red-700 dark:text-red-400">
                    {importReport.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
                {importReport.warnings.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-amber-700 dark:text-amber-400">
                    {importReport.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                {importReport.keysToUpdate.length > 0 && (
                  <p className="mt-2 text-slate-600 dark:text-slate-400">
                    Will update: {importReport.keysToUpdate.join(', ')}
                  </p>
                )}
              </div>
            )}
          </div>
        </Modal>
      </div>
    </Guard>
  );
}
