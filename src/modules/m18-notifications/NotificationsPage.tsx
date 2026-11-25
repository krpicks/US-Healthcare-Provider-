import { useState } from 'react';
import { Bell, CheckCheck, CheckCircle2, RefreshCw, Send } from 'lucide-react';
import { Guard, useAuth } from '../../app';
import {
  Button,
  Input,
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
  notificationService,
  renderTemplateText,
  type DeliveryStatus,
  type NotificationChannel,
} from './notificationService';

function deliveryTone(status: DeliveryStatus): SemanticTone {
  if (status === 'Sent') return 'success';
  if (status === 'Queued') return 'warning';
  return 'danger';
}

export function NotificationsPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'centre' | 'log' | 'templates' | 'mappings' | 'prefs'>('centre');
  const [tick, setTick] = useState(0);

  const state = notificationService.getState(activeTenant.id);
  const [selectedTplId, setSelectedTplId] = useState(state.templates[0]?.id ?? 'tpl-ack');
  const activeTpl =
    state.templates.find((t) => t.id === selectedTplId) ?? state.templates[0];

  const [editSubject, setEditSubject] = useState(activeTpl.subjectTemplate);
  const [editBody, setEditBody] = useState(activeTpl.bodyTemplate);
  const [testRecipient, setTestRecipient] = useState('Dr. Elena Vargas (elena.vargas@synthetic.example)');
  const [testChannel, setTestChannel] = useState<NotificationChannel>('Email');

  const selectTemplate = (id: string) => {
    setSelectedTplId(id);
    const found = state.templates.find((t) => t.id === id);
    if (found) {
      setEditSubject(found.subjectTemplate);
      setEditBody(found.bodyTemplate);
    }
  };

  const sampleVars = {
    providerName: 'Dr. Elena Vargas',
    npi: '1234567893',
    applicationNumber: 'APP-2026-0042',
    caseNumber: 'CASE-2026-0042',
    effectiveDate: '2026-11-25',
    reason: 'OIG-LEIE Exclusion Verification',
    status: 'Suspended',
    detail: 'Medical License NY-901122 expires in 30 days',
    determination: 'Reportable',
    patientId: 'pat-jane-doe-state-medicaid-a',
    documentReferenceId: 'doc-rr-001',
  };

  const handleSendTest = async (simulateFailure: boolean) => {
    try {
      const rec = await notificationService.sendNotification(
        fhirContext,
        {
          templateId: activeTpl.id,
          channel: testChannel,
          recipient: testRecipient,
          variables: sampleVars,
          simulateFailure,
        },
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      showToast(
        `Communication/${rec.communicationId}: ${rec.status}`,
        rec.status === 'Sent' ? 'success' : rec.status === 'Queued' ? 'warning' : 'error',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Send failed.', 'error');
    }
  };

  const unreadCount = state.deliveries.filter((d) => !d.read).length;

  return (
    <Guard moduleId="m18-notifications" action="view">
      <div className="space-y-6" data-tick={tick}>
        <PageHeader
          kicker="M18 · Notifications & Correspondence"
          title="Notifications & Correspondence Centre"
          description="Real-time event-driven notification centre, versioned correspondence templates with preview and approval, FHIR Communication delivery log with retry, event mappings, and quiet hours."
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                notificationService.markAllRead(activeTenant.id);
                setTick((t) => t + 1);
              }}
            >
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Mark All Read ({unreadCount})
            </Button>
          }
        />

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'centre', label: `Notification Centre (${unreadCount} unread)` },
            { id: 'log', label: `Delivery Log (${state.deliveries.length})` },
            { id: 'templates', label: `Templates (${state.templates.length})` },
            { id: 'mappings', label: `Event Mappings (${state.mappings.length})` },
            { id: 'prefs', label: 'Preferences & Quiet Hours' },
          ]}
        />

        {tab === 'centre' && (
          <div className="space-y-3">
            {state.deliveries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                No notifications received yet. Trigger an event from M5–M13 or send a test correspondence from the Templates tab.
              </div>
            ) : (
              state.deliveries.map((d) => (
                <div
                  key={d.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-blue-600" aria-hidden="true" />
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {d.subject}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{d.body}</div>
                      <div className="mt-1.5 text-[11px] text-slate-500">
                        To: {d.recipient} · Channel: {d.channel} · {d.eventType ?? 'Manual'} ·{' '}
                        {d.communicationId ? `Communication/${d.communicationId}` : 'Event Bus'}
                      </div>
                    </div>
                    <SemanticStatus tone={deliveryTone(d.status)} label={d.status} />
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'log' && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Template / Channel</th>
                  <th className="px-4 py-3">Recipient / Subject</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {state.deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {d.timestamp.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{d.templateName}</div>
                      <div className="text-slate-500">{d.channel}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-medium">{d.subject}</div>
                      <div className="text-slate-500">{d.recipient}</div>
                      {d.failureReason && (
                        <div className="text-rose-600 dark:text-rose-400">{d.failureReason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <SemanticStatus tone={deliveryTone(d.status)} label={d.status} />
                    </td>
                    <td className="px-4 py-3">
                      {(d.status === 'Failed' || d.status === 'Queued') && (
                        <Button
                          size="sm"
                          onClick={async () => {
                            await notificationService.retryDelivery(fhirContext, d.id, {
                              name: user.name,
                              role: user.role,
                            });
                            setTick((t) => t + 1);
                            showToast('Delivery retried and marked Sent.', 'success');
                          }}
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          Retry
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'templates' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-2 lg:col-span-4">
              {state.templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTemplate(t.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    activeTpl.id === t.id
                      ? 'border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/30'
                      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {t.name}
                    </span>
                    <SemanticStatus
                      tone={t.approvalStatus === 'Approved' ? 'success' : 'warning'}
                      label={`v${t.version} · ${t.approvalStatus}`}
                    />
                  </div>
                </button>
              ))}
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {activeTpl.name} (v{activeTpl.version})
                </h2>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      notificationService.updateTemplateNewVersion(activeTenant.id, activeTpl.id, {
                        subjectTemplate: editSubject,
                        bodyTemplate: editBody,
                      });
                      setTick((t) => t + 1);
                      showToast(`Saved draft version v${activeTpl.version}.`, 'info');
                    }}
                  >
                    Save New Version
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      notificationService.approveTemplate(
                        activeTenant.id,
                        activeTpl.id,
                        `${user.name} (${user.role})`,
                      );
                      setTick((t) => t + 1);
                      showToast('Template approved for automated dispatch.', 'success');
                    }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Approve
                  </Button>
                </div>
              </div>

              <Input
                label="Subject Template"
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
              />
              <TextArea
                label="Body Template"
                rows={4}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
              />

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
                <div className="font-semibold text-slate-700 dark:text-slate-200">
                  Live Merge Preview
                </div>
                <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                  {renderTemplateText(editSubject, sampleVars)}
                </div>
                <p className="mt-1 text-slate-600 dark:text-slate-300">
                  {renderTemplateText(editBody, sampleVars)}
                </p>
              </div>

              <div className="grid gap-3 border-t border-slate-200 pt-3 sm:grid-cols-3 dark:border-slate-800">
                <Input
                  label="Test Recipient"
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                />
                <Select
                  label="Channel"
                  value={testChannel}
                  onChange={(e) => setTestChannel(e.target.value as NotificationChannel)}
                  options={[
                    { value: 'Email', label: 'Email' },
                    { value: 'Portal', label: 'Portal' },
                    { value: 'SMS', label: 'SMS' },
                    { value: 'Letter', label: 'Letter' },
                  ]}
                />
                <div className="flex items-end gap-2">
                  <Button onClick={() => void handleSendTest(false)}>
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    Send Test
                  </Button>
                  <Button variant="secondary" onClick={() => void handleSendTest(true)}>
                    Sim Fail
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'mappings' && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-3">Platform Event</th>
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Enabled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {state.mappings.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{m.eventType}</td>
                    <td className="px-4 py-3 text-xs">
                      {state.templates.find((t) => t.id === m.templateId)?.name ?? m.templateId}
                    </td>
                    <td className="px-4 py-3 text-xs">{m.channel}</td>
                    <td className="px-4 py-3">
                      <SemanticStatus
                        tone={m.priority === 'Critical' ? 'danger' : 'info'}
                        label={m.priority}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Enable ${m.eventType} notification`}
                        checked={m.enabled}
                        onChange={(e) => {
                          notificationService.updateMapping(activeTenant.id, m.id, {
                            enabled: e.target.checked,
                          });
                          setTick((t) => t + 1);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'prefs' && (
          <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
              <input
                type="checkbox"
                checked={state.preferences.enabled}
                onChange={(e) => {
                  notificationService.updatePreferences(activeTenant.id, {
                    enabled: e.target.checked,
                  });
                  setTick((t) => t + 1);
                }}
              />
              Enable Quiet Hours (Defer non-critical notifications to Queued)
            </label>
            <div />
            <Input
              label="Quiet Hours Start (0-23)"
              type="number"
              min={0}
              max={23}
              value={state.preferences.startHour}
              onChange={(e) => {
                notificationService.updatePreferences(activeTenant.id, {
                  startHour: Number(e.target.value),
                });
                setTick((t) => t + 1);
              }}
            />
            <Input
              label="Quiet Hours End (0-23)"
              type="number"
              min={0}
              max={23}
              value={state.preferences.endHour}
              onChange={(e) => {
                notificationService.updatePreferences(activeTenant.id, {
                  endHour: Number(e.target.value),
                });
                setTick((t) => t + 1);
              }}
            />
          </div>
        )}
      </div>
    </Guard>
  );
}
