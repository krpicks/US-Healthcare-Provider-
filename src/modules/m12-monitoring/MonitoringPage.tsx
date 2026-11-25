import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BellRing,
  CalendarClock,
  Play,
  RefreshCw,
  ShieldAlert,
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
import {
  monitoringService,
  type ExpirationCalendarEntry,
  type MonitorId,
  type MonitoringAlertStatus,
} from './monitoringService';

function alertTone(status: MonitoringAlertStatus): SemanticTone {
  switch (status) {
    case 'Open':
      return 'danger';
    case 'Acknowledged':
      return 'warning';
    case 'Suspended':
      return 'danger';
    case 'RevalidationStarted':
      return 'info';
    case 'Dismissed':
      return 'neutral';
  }
}

function urgencyTone(u: ExpirationCalendarEntry['urgency']): SemanticTone {
  if (u === '30-day Critical') return 'danger';
  if (u === '60-day Warning') return 'warning';
  if (u === '90-day Notice') return 'info';
  return 'success';
}

export function MonitoringPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'monitors' | 'alerts' | 'chow' | 'subscriptions' | 'calendar'>('monitors');
  const [providers, setProviders] = useState<ProviderDirectoryRow[]>([]);
  const [calendar, setCalendar] = useState<ExpirationCalendarEntry[]>([]);
  const [tick, setTick] = useState(0);

  // Dismiss modal
  const [dismissAlertId, setDismissAlertId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState('');

  // CHOW form
  const [chowProviderId, setChowProviderId] = useState('');
  const [chowNewOwner, setChowNewOwner] = useState('');

  // Subscription form
  const [subReason, setSubReason] = useState('Alert on Practitioner exclusion or status change');
  const [subCriteria, setSubCriteria] = useState('Practitioner?active=false');
  const [subEndpoint, setSubEndpoint] = useState('https://monitoring.synthetic.example/hooks/status');

  const state = monitoringService.getState(activeTenant.id);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      providerService.listProviders(fhirContext),
      monitoringService.getExpirationCalendar(fhirContext),
    ]).then(([provs, cal]) => {
      if (!mounted) return;
      setProviders(provs);
      setCalendar(cal);
      if (!chowProviderId && provs[0]) setChowProviderId(provs[0].id);
    });
    return () => {
      mounted = false;
    };
  }, [activeTenant.id, fhirContext, tick, chowProviderId]);

  const handleRunMonitor = async (monitorId: MonitorId) => {
    try {
      const { monitor, newAlerts } = await monitoringService.runMonitor(
        fhirContext,
        monitorId,
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      showToast(
        `${monitor.name}: ${newAlerts.length} alert(s) detected.`,
        newAlerts.length > 0 ? 'warning' : 'success',
      );
      if (newAlerts.length > 0) setTab('alerts');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Monitor execution failed.', 'error');
    }
  };

  const handleSuspend = async (alertId: string) => {
    try {
      await monitoringService.suspendProviderFromAlert(
        fhirContext,
        alertId,
        'Suspended from M12 Ongoing Monitoring alert (Exclusion / Integrity hit).',
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      showToast(
        'Provider Suspended in M3, MMIS StatusUpdate queued in M10, and M11 claims blocked.',
        'warning',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Suspension failed.', 'error');
    }
  };

  const handleStartRevalidation = async (alertId: string) => {
    try {
      const { draftId } = await monitoringService.startRevalidationFromAlert(
        fhirContext,
        alertId,
        `${user.name} (${user.role})`,
      );
      setTick((t) => t + 1);
      showToast(`Pre-filled M5 Revalidation draft (${draftId}) ready.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to start revalidation.', 'error');
    }
  };

  const handleDismiss = async () => {
    if (!dismissAlertId) return;
    try {
      await monitoringService.dismissAlertWithReason(
        fhirContext,
        dismissAlertId,
        dismissReason,
        { name: user.name, role: user.role },
      );
      setDismissAlertId(null);
      setDismissReason('');
      setTick((t) => t + 1);
      showToast('Alert dismissed with FHIR Provenance record.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Dismissal failed.', 'error');
    }
  };

  const handleTriggerChow = async () => {
    if (!chowProviderId || !chowNewOwner.trim()) {
      showToast('Select a provider and enter the new controlling owner name.', 'warning');
      return;
    }
    try {
      await monitoringService.triggerChangeOfOwnership(
        fhirContext,
        chowProviderId,
        chowNewOwner.trim(),
        { name: user.name, role: user.role },
      );
      setChowNewOwner('');
      setTick((t) => t + 1);
      showToast('CHOW alert raised and M5 Change of Ownership draft pre-filled.', 'success');
      setTab('alerts');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'CHOW trigger failed.', 'error');
    }
  };

  const handleCreateSubscription = async () => {
    try {
      const sub = await monitoringService.createFhirSubscription(
        fhirContext,
        {
          reason: subReason,
          criteria: subCriteria,
          channelType: 'rest-hook',
          endpoint: subEndpoint,
        },
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      showToast(`FHIR Subscription/${sub.fhirSubscriptionId} activated.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Subscription creation failed.', 'error');
    }
  };

  const openAlerts = state.alerts.filter((a) => a.status === 'Open').length;

  return (
    <Guard moduleId="m12-monitoring" action="view">
      <div className="space-y-6" data-tick={tick}>
        <PageHeader
          kicker="M12 · Ongoing Monitoring"
          title="Ongoing Monitoring & Revalidation"
          description="6 automated continuous monitors (OIG/SAM exclusions, 90/60/30-day license expiry, death master, adverse actions, returned mail, 5-year revalidation), alert remediation, CHOW, FHIR Subscriptions, and expiration calendar."
        />

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'monitors', label: `Monitors (${state.monitors.length})` },
            { id: 'alerts', label: `Monitoring Alerts (${openAlerts} open)` },
            { id: 'chow', label: 'Revalidation & CHOW' },
            { id: 'subscriptions', label: `FHIR Subscriptions (${state.subscriptions.length})` },
            { id: 'calendar', label: `Expiration Calendar (${calendar.length})` },
          ]}
        />

        {tab === 'monitors' && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {state.monitors.map((m) => (
              <div
                key={m.id}
                className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {m.name}
                    </h2>
                    <SemanticStatus tone={m.enabled ? 'success' : 'neutral'} label={m.enabled ? m.frequency : 'Paused'} />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">{m.description}</p>
                  <div className="mt-3 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <div>Last run: {m.lastRunAt ? m.lastRunAt.slice(0, 16).replace('T', ' ') : 'Never'}</div>
                    <div>Next scheduled: {m.nextRunAt} · Last hits: {m.lastHitCount}</div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={(e) => {
                        monitoringService.toggleMonitor(activeTenant.id, m.id, e.target.checked);
                        setTick((t) => t + 1);
                      }}
                    />
                    Enabled
                  </label>
                  <Button size="sm" onClick={() => void handleRunMonitor(m.id)}>
                    <Play className="h-3.5 w-3.5" />
                    Run Now
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'alerts' && (
          <div className="space-y-3">
            {state.alerts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                No monitoring alerts yet. Run any monitor (e.g., Exclusion Re-Screen or License Expiration) to evaluate active M3 providers.
              </div>
            ) : (
              state.alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {alert.summary} — {alert.providerName}
                        </span>
                        <span className="font-mono text-xs text-slate-500">NPI {alert.npi}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{alert.details}</p>
                      <div className="mt-1 text-xs text-slate-500">
                        Task/{alert.taskId} · DetectedIssue/{alert.detectedIssueId}
                      </div>
                      {alert.actionNote && (
                        <div className="mt-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                          {alert.actionNote}
                        </div>
                      )}
                    </div>
                    <SemanticStatus tone={alertTone(alert.status)} label={alert.status} />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                    {alert.status === 'Open' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          monitoringService.acknowledgeAlert(activeTenant.id, alert.id, `${user.name} (${user.role})`);
                          setTick((t) => t + 1);
                        }}
                      >
                        Acknowledge
                      </Button>
                    )}
                    {(alert.status === 'Open' || alert.status === 'Acknowledged') && (
                      <>
                        <Button size="sm" variant="danger" onClick={() => void handleSuspend(alert.id)}>
                          <ShieldAlert className="h-3.5 w-3.5" />
                          Suspend Provider
                        </Button>
                        <Button size="sm" onClick={() => void handleStartRevalidation(alert.id)}>
                          <RefreshCw className="h-3.5 w-3.5" />
                          Start Revalidation (M5)
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDismissAlertId(alert.id)}>
                          Dismiss with Reason
                        </Button>
                      </>
                    )}
                    {alert.revalidationDraftId && (
                      <Button size="sm" variant="secondary" onClick={() => navigate('/enrollment')}>
                        Open Draft in M5 Enrollment
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'chow' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Report Change of Ownership (CHOW)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Logs an OwnershipChange monitoring alert and launches a pre-filled M5 Change of Ownership application.
              </p>
              <Select
                label="Affected Provider"
                value={chowProviderId}
                onChange={(e) => setChowProviderId(e.target.value)}
                options={providers.map((p) => ({ value: p.id, label: `${p.fullName} (${p.status})` }))}
              />
              <Input
                label="New Controlling Owner / Acquiring Entity"
                value={chowNewOwner}
                onChange={(e) => setChowNewOwner(e.target.value)}
                placeholder="e.g., Hudson Valley Health Holdings LLC"
              />
              <Button onClick={() => void handleTriggerChow()}>Initiate CHOW Workflow</Button>
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Grace-Period Enforcement (Revalidation Due → Terminated)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Providers whose revalidation grace period has elapsed can be terminated immediately with MMIS and claims notification.
              </p>
              <div className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
                {providers
                  .filter((p) => p.status !== 'Terminated')
                  .slice(0, 4)
                  .map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">{p.fullName}</div>
                        <div className="text-xs text-slate-500">
                          Status: {p.status} · Due: {state.revalidationDueByProvider[p.id] ?? 'Current'}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={async () => {
                          await monitoringService.enforceRevalidationGraceTermination(fhirContext, p.id, {
                            name: user.name,
                            role: user.role,
                          });
                          setTick((t) => t + 1);
                          showToast(`${p.fullName} terminated after revalidation grace period.`, 'warning');
                        }}
                      >
                        Terminate
                      </Button>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'subscriptions' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <BellRing className="h-4 w-4" />
                Register FHIR R4 Subscription
              </h2>
              <Input label="Reason" value={subReason} onChange={(e) => setSubReason(e.target.value)} />
              <Input label="FHIR Criteria" value={subCriteria} onChange={(e) => setSubCriteria(e.target.value)} />
              <Input label="REST-Hook Endpoint" value={subEndpoint} onChange={(e) => setSubEndpoint(e.target.value)} />
              <Button className="w-full" onClick={() => void handleCreateSubscription()}>
                Create FHIR Subscription
              </Button>
            </div>
            <div className="space-y-3 lg:col-span-7">
              {state.subscriptions.map((sub) => (
                <div
                  key={sub.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{sub.reason}</div>
                    <div className="font-mono text-xs text-slate-500">
                      {sub.criteria} → {sub.endpoint}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Deliveries: {sub.deliveryCount}
                      {sub.fhirSubscriptionId ? ` · Subscription/${sub.fhirSubscriptionId}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <SemanticStatus tone="success" label={sub.status} />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        monitoringService.simulateSubscriptionPing(activeTenant.id, sub.id);
                        setTick((t) => t + 1);
                        showToast('Simulated FHIR Subscription webhook delivery.', 'info');
                      }}
                    >
                      <Activity className="h-3.5 w-3.5" />
                      Simulate Event
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'calendar' && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-sm font-semibold dark:border-slate-800">
              <CalendarClock className="h-4 w-4" />
              Upcoming License, Recredentialing & Revalidation Expirations
            </div>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-right">Days Remaining</th>
                  <th className="px-4 py-3">Urgency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {calendar.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">{row.dueDate}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{row.providerName}</div>
                      <div className="font-mono text-xs text-slate-500">NPI {row.npi}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">{row.category}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {row.daysUntilDue < 0 ? `${Math.abs(row.daysUntilDue)}d overdue` : `${row.daysUntilDue}d`}
                    </td>
                    <td className="px-4 py-3">
                      <SemanticStatus tone={urgencyTone(row.urgency)} label={row.urgency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Modal
          open={Boolean(dismissAlertId)}
          onClose={() => setDismissAlertId(null)}
          title="Dismiss Monitoring Alert (Provenance Required)"
        >
          <div className="space-y-3">
            <TextArea
              label="Documented Reason for Dismissal"
              rows={3}
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="Explain false positive or verified resolution..."
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDismissAlertId(null)}>
                Cancel
              </Button>
              <Button onClick={() => void handleDismiss()}>Record Provenance & Dismiss</Button>
            </div>
          </div>
        </Modal>
      </div>
    </Guard>
  );
}
