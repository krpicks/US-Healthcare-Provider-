import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Download,
  RefreshCw,
  Save,
  Wifi,
} from 'lucide-react';
import {
  Button,
  DataTable,
  Drawer,
  Input,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  useToast,
  type DataTableColumn,
} from '../../components';
import { Guard } from '../../app/Guard';
import { useAuth, usePermission } from '../../app/AuthContext';
import { ALL_ACTIONS, ALL_ROLES, PERMISSION_MATRIX } from '../../app/rbac';
import { useTheme } from '../../app/ThemeContext';
import { MODULE_REGISTRY } from '../../app/moduleRegistry';
import { liveFhirClient } from '../../fhir';
import {
  auditService,
  buildCsvString,
  downloadTextFile,
  settingsService,
  type PlatformSettings,
} from '../../services';
import { tenantService, useTenantContext } from '../../tenancy';
import type { FhirAuditEvent, RoleName } from '../../types';

export function SettingsAndAuditPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { notify } = useToast();

  const canEditSettings = usePermission('m1-shell', 'edit');
  const canExportAudit = usePermission('m1-shell', 'export');

  const [activeTab, setActiveTab] = useState('connections');
  const [form, setForm] = useState<PlatformSettings>(() => settingsService.load());
  const [bearerToken, setBearerToken] = useState(
    () => settingsService.getSessionSecret('fhirBearerToken') ?? '',
  );
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; latencyMs: number; message: string }>
  >({});

  // Audit Log state
  const [audits, setAudits] = useState<FhirAuditEvent[]>([]);
  const [loadingAudits, setLoadingAudits] = useState(false);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [selectedAudit, setSelectedAudit] = useState<FhirAuditEvent | null>(null);
  const [selectedRbacRole, setSelectedRbacRole] = useState<RoleName>(user.role);

  const loadAudits = useCallback(async () => {
    setLoadingAudits(true);
    try {
      const items = await auditService.list(fhirContext, {
        actor: actorFilter || undefined,
        action: actionFilter,
        resourceType: resourceFilter,
        outcome: outcomeFilter,
        dateFrom: dateFrom || undefined,
      });
      setAudits(items);
    } finally {
      setLoadingAudits(false);
    }
  }, [fhirContext, actorFilter, actionFilter, resourceFilter, outcomeFilter, dateFrom]);

  useEffect(() => {
    void loadAudits();
    return auditService.subscribe(() => {
      void loadAudits();
    });
  }, [loadAudits]);

  const handleSaveSettings = async () => {
    settingsService.save(form);
    settingsService.setSessionSecret('fhirBearerToken', bearerToken);
    setTheme(form.theme);
    await auditService.record({
      ctx: fhirContext,
      actorName: user.name,
      actorRole: user.role,
      action: 'update',
      resourceType: 'Organization',
      resourceId: activeTenant.id,
      outcomeDesc: `Updated connection settings (FHIR mode: ${form.fhirMode}, partition: ${form.tenantPartitionStrategy})`,
    });
    notify({
      title: 'Settings saved',
      description: 'Non-secret settings persisted to localStorage; token held in session memory only.',
      variant: 'success',
    });
  };

  const handleTestConnection = async (key: string, label: string, url: string) => {
    if (key === 'fhir' && form.fhirMode === 'live') {
      const check = await liveFhirClient.verifyFhirVersion(fhirContext);
      setTestResults((prev) => ({
        ...prev,
        [key]: {
          ok: check.ok,
          latencyMs: check.latencyMs,
          message: check.ok
            ? `Live FHIR R4 verified (fhirVersion ${check.fhirVersion})`
            : check.error ?? 'Failed to reach /metadata',
        },
      }));
      return;
    }
    const res = await tenantService.testEndpointConnection(label, url, form.fhirMode);
    setTestResults((prev) => ({ ...prev, [key]: res }));
  };

  const handleExportAuditCsv = async () => {
    const csv = buildCsvString(
      ['Recorded', 'Actor', 'Role', 'Action', 'Resource', 'Outcome', 'Description'],
      audits.map((a) => [
        a.recorded,
        a.agent?.[0]?.name ?? '',
        a.agent?.[0]?.altId ?? '',
        a.subtype?.[0]?.code ?? a.action ?? '',
        a.entity?.[0]?.what?.reference ?? a.entity?.[0]?.name ?? '',
        a.outcome === '0' ? 'Success' : `Code ${a.outcome}`,
        a.outcomeDesc ?? '',
      ]),
    );
    downloadTextFile(`${activeTenant.code}-audit-log.csv`, csv, 'text/csv');
    await auditService.record({
      ctx: fhirContext,
      actorName: user.name,
      actorRole: user.role,
      action: 'export',
      resourceType: 'AuditEvent',
      outcomeDesc: `Exported ${audits.length} AuditEvent rows to CSV`,
    });
    notify({ title: 'Audit log CSV exported', variant: 'success' });
  };

  const auditColumns: DataTableColumn<FhirAuditEvent>[] = [
    {
      key: 'recorded',
      header: 'Timestamp (UTC)',
      sortable: true,
      sortValue: (a) => a.recorded,
      render: (a) => (
        <span className="font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">
          {a.recorded.replace('T', ' ').slice(0, 19)}
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'User / Role',
      sortable: true,
      sortValue: (a) => a.agent?.[0]?.name ?? '',
      render: (a) => (
        <span className="text-xs text-slate-900 dark:text-slate-100">
          {a.agent?.[0]?.name ?? 'System'} ·{' '}
          <span className="text-slate-500">{a.agent?.[0]?.altId ?? ''}</span>
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      sortable: true,
      sortValue: (a) => a.subtype?.[0]?.code ?? a.action ?? '',
      render: (a) => (
        <span className="font-mono text-xs uppercase text-slate-800 dark:text-slate-200">
          {a.subtype?.[0]?.code ?? a.action}
        </span>
      ),
    },
    {
      key: 'resource',
      header: 'Resource',
      render: (a) => (
        <span className="font-mono text-xs text-slate-700 dark:text-slate-300">
          {a.entity?.[0]?.what?.reference ?? a.entity?.[0]?.name ?? '—'}
        </span>
      ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      render: (a) => (
        <SemanticStatus
          label={a.outcome === '0' ? 'Success' : `Error (${a.outcome})`}
          tone={a.outcome === '0' ? 'success' : 'danger'}
        />
      ),
    },
    {
      key: 'desc',
      header: 'Summary',
      render: (a) => (
        <span className="block max-w-xs truncate text-xs text-slate-600 dark:text-slate-400">
          {a.outcomeDesc}
        </span>
      ),
    },
  ];

  return (
    <Guard
      moduleId="m1-shell"
      action="view"
      moduleName="Settings, RBAC & Audit Log (M1)"
      showForbiddenPage
    >
      <div className="space-y-6">
        <PageHeader
          kicker={`M1 · Tenant ${activeTenant.code}`}
          title="Platform Settings, RBAC & Audit Log"
          description="Configure FHIR R4 connectivity (Mock or Live), external integration URLs, theme preferences, inspect the 11-role permission matrix, and review FHIR AuditEvent records."
          actions={
            <Link
              to="/design-system"
              className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
            >
              Open Design System catalog
            </Link>
          }
        />

        <Tabs
          activeTab={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: 'connections', label: 'Connections & Theme' },
            { id: 'audit', label: 'FHIR Audit Log', count: audits.length },
            { id: 'rbac', label: 'RBAC Permission Matrix' },
          ]}
        />

        {activeTab === 'connections' && (
          <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Select
                label="FHIR Client Mode"
                disabled={!canEditSettings}
                value={form.fhirMode}
                options={[
                  { value: 'mock', label: 'Mock (In-memory per-tenant store)' },
                  { value: 'live', label: 'Live (External FHIR R4 4.0.1 server)' },
                ]}
                onChange={(e) =>
                  setForm({ ...form, fhirMode: e.target.value as 'mock' | 'live' })
                }
              />
              <Select
                label="Live Tenant Partition Strategy"
                disabled={!canEditSettings}
                value={form.tenantPartitionStrategy}
                options={[
                  { value: 'path', label: 'Base URL path ({fhirBase}/{tenantCode})' },
                  { value: 'header', label: 'HTTP Header (X-Tenant-Id)' },
                ]}
                onChange={(e) =>
                  setForm({
                    ...form,
                    tenantPartitionStrategy: e.target.value as 'path' | 'header',
                  })
                }
              />
              <Select
                label="Interface Theme"
                value={theme}
                options={[
                  { value: 'light', label: 'Light mode' },
                  { value: 'dark', label: 'Dark mode' },
                ]}
                onChange={(e) => {
                  const next = e.target.value as 'light' | 'dark';
                  setForm({ ...form, theme: next });
                  setTheme(next);
                }}
              />
            </div>

            <div className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Service Endpoints & Connectivity Tests
              </h2>
              {(
                [
                  ['fhir', 'FHIR Base', 'fhirBaseUrl', form.fhirBaseUrl],
                  ['gateway', '.NET Gateway', 'gatewayBaseUrl', form.gatewayBaseUrl],
                  ['ecrnow', 'eCRNow', 'ecrNowBaseUrl', form.ecrNowBaseUrl],
                  ['inferno', 'Inferno Conformance', 'infernoBaseUrl', form.infernoBaseUrl],
                ] as const
              ).map(([key, label, prop, value]) => {
                const res = testResults[key];
                return (
                  <div
                    key={key}
                    className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-end dark:border-slate-800"
                  >
                    <div className="flex-1">
                      <Input
                        label={`${label} URL`}
                        disabled={!canEditSettings}
                        value={value}
                        onChange={(e) => setForm({ ...form, [prop]: e.target.value })}
                      />
                      {res && (
                        <div className="mt-1.5 flex items-center gap-2 text-xs">
                          <SemanticStatus
                            label={res.ok ? `Connected · ${res.latencyMs}ms` : `Failed · ${res.latencyMs}ms`}
                            tone={res.ok ? 'success' : 'danger'}
                          />
                          <span className="text-slate-600 dark:text-slate-400">
                            {res.message}
                          </span>
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void handleTestConnection(key, label, value)}
                    >
                      <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Test connection</span>
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-800">
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Session memory warning: Bearer tokens entered below are held strictly in browser RAM for the current session only. They are never saved to localStorage, exported, or placed in source code.
                </span>
              </div>
              <Input
                label="Optional Live FHIR Bearer Token (Session Memory Only)"
                type="password"
                disabled={!canEditSettings}
                value={bearerToken}
                placeholder="Paste ephemeral token for Live mode testing..."
                onChange={(e) => setBearerToken(e.target.value)}
              />
            </div>

            {canEditSettings && (
              <div className="flex justify-end border-t border-slate-200 pt-4 dark:border-slate-800">
                <Button variant="primary" onClick={() => void handleSaveSettings()}>
                  <Save className="h-4 w-4" aria-hidden="true" />
                  <span>Save Settings</span>
                </Button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Input
                aria-label="Filter by user or role"
                placeholder="Filter user or role..."
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
              />
              <Select
                aria-label="Filter by action"
                value={actionFilter}
                options={[
                  { value: 'all', label: 'All actions' },
                  { value: 'create', label: 'Create' },
                  { value: 'update', label: 'Update' },
                  { value: 'delete', label: 'Delete' },
                  { value: 'export', label: 'Export' },
                  { value: 'unmask', label: 'Unmask PII' },
                ]}
                onChange={(e) => setActionFilter(e.target.value)}
              />
              <Select
                aria-label="Filter by resource type"
                value={resourceFilter}
                options={[
                  { value: 'all', label: 'All resource types' },
                  { value: 'Practitioner', label: 'Practitioner' },
                  { value: 'Patient', label: 'Patient' },
                  { value: 'Organization', label: 'Organization' },
                  { value: 'InsurancePlan', label: 'InsurancePlan' },
                  { value: 'Bundle', label: 'Bundle' },
                  { value: 'Task', label: 'Task' },
                  { value: 'AuditEvent', label: 'AuditEvent' },
                ]}
                onChange={(e) => setResourceFilter(e.target.value)}
              />
              <Select
                aria-label="Filter by outcome"
                value={outcomeFilter}
                options={[
                  { value: 'all', label: 'All outcomes' },
                  { value: '0', label: 'Success (0)' },
                  { value: '4', label: 'Minor failure (4)' },
                  { value: '8', label: 'Serious failure (8)' },
                ]}
                onChange={(e) => setOutcomeFilter(e.target.value)}
              />
              <Input
                aria-label="From date"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <DataTable
              rows={audits}
              columns={auditColumns}
              getRowKey={(a) => a.id ?? a.recorded}
              loading={loadingAudits}
              searchable={false}
              onRowClick={(a) => setSelectedAudit(a)}
              emptyTitle="No FHIR AuditEvents recorded yet"
              emptyDescription="Create, update, delete, export, or unmask actions in this tenant will automatically appear here."
              toolbarExtra={
                <>
                  <Button size="sm" onClick={() => void loadAudits()}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Refresh</span>
                  </Button>
                  {canExportAudit && (
                    <Button
                      size="sm"
                      disabled={audits.length === 0}
                      onClick={() => void handleExportAuditCsv()}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Export CSV</span>
                    </Button>
                  )}
                </>
              }
            />

            <Drawer
              open={Boolean(selectedAudit)}
              title="FHIR AuditEvent Detail"
              subtitle={selectedAudit ? `AuditEvent/${selectedAudit.id}` : undefined}
              onClose={() => setSelectedAudit(null)}
            >
              {selectedAudit && (
                <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                  {JSON.stringify(selectedAudit, null, 2)}
                </pre>
              )}
            </Drawer>
          </div>
        )}

        {activeTab === 'rbac' && (
          <div className="space-y-4">
            <div className="max-w-xs">
              <Select
                label="Inspect Role Permissions"
                value={selectedRbacRole}
                options={ALL_ROLES.map((r) => ({ value: r, label: r }))}
                onChange={(e) => setSelectedRbacRole(e.target.value as RoleName)}
              />
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                      <th className="px-4 py-2.5">Module</th>
                      {ALL_ACTIONS.map((act) => (
                        <th key={act} className="px-3 py-2.5 text-center capitalize">
                          {act}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {MODULE_REGISTRY.map((mod) => {
                      const perms = PERMISSION_MATRIX[selectedRbacRole]?.[mod.id];
                      return (
                        <tr key={mod.id}>
                          <td className="px-4 py-2 font-medium text-slate-900 dark:text-slate-100">
                            <span className="mr-2 font-mono text-slate-500">{mod.code}</span>
                            {mod.shortName}
                          </td>
                          {ALL_ACTIONS.map((act) => (
                            <td key={act} className="px-3 py-2 text-center font-mono">
                              {perms?.[act] ? (
                                <span className="text-emerald-700 dark:text-emerald-400">
                                  Yes
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </Guard>
  );
}
