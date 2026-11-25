import { eventBus } from '../../events';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { auditService } from '../../services';
import {
  AppError,
  type FhirDetectedIssue,
  type FhirProvenance,
  type FhirSubscription,
  type FhirTask,
  type RoleName,
} from '../../types';
import {
  providerService,
  type ProviderDirectoryRow,
} from '../m3-directory/providerService';
import { enrollmentService } from '../m5-enrollment/enrollmentService';
import { validationService } from '../m6-validation/validationService';
import { credentialingService } from '../m9-credentialing/credentialingService';
import { providerOpsService } from '../m22-provider-ops/providerOpsService';

export type MonitorId =
  | 'exclusion-rescreen'
  | 'license-expiry'
  | 'death-master'
  | 'adverse-actions'
  | 'returned-mail'
  | 'revalidation-due';

export interface MonitorConfig {
  id: MonitorId;
  name: string;
  description: string;
  frequency: 'Daily' | 'Weekly' | 'Bi-Weekly' | 'Monthly';
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt: string;
  lastHitCount: number;
}

export type MonitoringAlertType =
  | 'ExclusionHit'
  | 'LicenseExpiring'
  | 'RevalidationDue'
  | 'OwnershipChange'
  | 'DeathMasterHit'
  | 'AdverseAction'
  | 'ReturnedMail';

export type MonitoringAlertStatus =
  | 'Open'
  | 'Acknowledged'
  | 'Suspended'
  | 'RevalidationStarted'
  | 'Dismissed';

export interface MonitoringAlert {
  id: string;
  monitorId: MonitorId | 'manual-chow';
  alertType: MonitoringAlertType;
  severity: 'High' | 'Medium' | 'Low';
  practitionerId: string;
  providerName: string;
  npi: string;
  summary: string;
  details: string;
  status: MonitoringAlertStatus;
  createdAt: string;
  taskId?: string;
  detectedIssueId?: string;
  actionNote?: string;
  actionedBy?: string;
  actionedAt?: string;
  revalidationDraftId?: string;
  programIntegrityReferralId?: string;
}

export interface ExpirationCalendarEntry {
  id: string;
  practitionerId: string;
  providerName: string;
  npi: string;
  category: 'State License' | 'Recredentialing' | 'Medicaid Revalidation';
  dueDate: string;
  daysUntilDue: number;
  urgency: '30-day Critical' | '60-day Warning' | '90-day Notice' | 'Scheduled';
}

export interface SubscriptionMonitorRecord {
  id: string;
  fhirSubscriptionId?: string;
  reason: string;
  criteria: string;
  channelType: 'rest-hook' | 'websocket';
  endpoint: string;
  status: 'active' | 'off';
  createdAt: string;
  deliveryCount: number;
  lastDeliveryAt?: string;
}

interface TenantMonitoringState {
  monitors: MonitorConfig[];
  alerts: MonitoringAlert[];
  subscriptions: SubscriptionMonitorRecord[];
  /** Synthetic expiration metadata per practitionerId (editable/overridable for testing) */
  licenseExpiryByProvider: Record<string, string>;
  revalidationDueByProvider: Record<string, string>;
}

const tenantMonitoringStore = new Map<string, TenantMonitoringState>();

function daysFromTodayIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function buildInitialMonitors(): MonitorConfig[] {
  return [
    {
      id: 'exclusion-rescreen',
      name: 'OIG-LEIE / SAM Exclusion Re-Screen',
      description: 'Monthly automated screening of all M3 providers against M6 federal/state exclusion registries.',
      frequency: 'Monthly',
      enabled: true,
      nextRunAt: daysFromTodayIso(14),
      lastHitCount: 0,
    },
    {
      id: 'license-expiry',
      name: 'State License Expiration Monitor (90/60/30d)',
      description: 'Flags active providers with state medical licenses expiring within 90, 60, or 30 days.',
      frequency: 'Daily',
      enabled: true,
      nextRunAt: daysFromTodayIso(1),
      lastHitCount: 0,
    },
    {
      id: 'death-master',
      name: 'SSA Death Master File Monitor',
      description: 'Cross-checks active provider NPIs against the SSA Death Master registry in M6.',
      frequency: 'Monthly',
      enabled: true,
      nextRunAt: daysFromTodayIso(21),
      lastHitCount: 0,
    },
    {
      id: 'adverse-actions',
      name: 'State Licensing Board Adverse Actions',
      description: 'Detects newly revoked or suspended licenses from state board feeds.',
      frequency: 'Weekly',
      enabled: true,
      nextRunAt: daysFromTodayIso(5),
      lastHitCount: 0,
    },
    {
      id: 'returned-mail',
      name: 'Returned Mail & Practice Address Integrity',
      description: 'Identifies providers with missing or stale unverified practice addresses (>180 days).',
      frequency: 'Bi-Weekly',
      enabled: true,
      nextRunAt: daysFromTodayIso(10),
      lastHitCount: 0,
    },
    {
      id: 'revalidation-due',
      name: '5-Year Medicaid Revalidation & Grace Period',
      description: 'Detects providers approaching 5-year revalidation deadline or past grace period.',
      frequency: 'Daily',
      enabled: true,
      nextRunAt: daysFromTodayIso(1),
      lastHitCount: 0,
    },
  ];
}

function getState(tenantId: string): TenantMonitoringState {
  let st = tenantMonitoringStore.get(tenantId);
  if (!st) {
    const isTenantB = tenantId.includes('health-center');
    st = {
      monitors: buildInitialMonitors(),
      alerts: [],
      subscriptions: [
        {
          id: `sub-seed-1-${tenantId}`,
          reason: 'Notify M12 Monitoring when any Practitioner status or qualification changes',
          criteria: 'Practitioner?active=true',
          channelType: 'rest-hook',
          endpoint: 'https://monitoring.synthetic.example/fhir-hooks/practitioner',
          status: 'active',
          createdAt: '2026-01-15T09:00:00Z',
          deliveryCount: 3,
          lastDeliveryAt: '2026-02-28T16:12:00Z',
        },
      ],
      licenseExpiryByProvider: isTenantB
        ? {
            'prac-b-1': daysFromTodayIso(24),
            'prac-b-2': daysFromTodayIso(58),
            'prac-b-3': daysFromTodayIso(210),
          }
        : {
            'prac-a-1': daysFromTodayIso(25),
            'prac-a-2': daysFromTodayIso(55),
            'prac-a-3': daysFromTodayIso(85),
            'prac-a-4': daysFromTodayIso(240),
          },
      revalidationDueByProvider: isTenantB
        ? {
            'prac-b-2': daysFromTodayIso(40),
            'prac-b-3': daysFromTodayIso(-10),
          }
        : {
            'prac-a-2': daysFromTodayIso(35),
            'prac-a-4': daysFromTodayIso(-5),
          },
    };
    tenantMonitoringStore.set(tenantId, st);
  }
  return st;
}

async function createAlertWithFhir(
  ctx: FhirRequestContext,
  st: TenantMonitoringState,
  input: {
    monitorId: MonitoringAlert['monitorId'];
    alertType: MonitoringAlertType;
    severity: MonitoringAlert['severity'];
    provider: ProviderDirectoryRow;
    summary: string;
    details: string;
  },
): Promise<MonitoringAlert> {
  // Avoid duplicating an already-open identical alert for the same provider & type
  const duplicate = st.alerts.find(
    (a) =>
      a.practitionerId === input.provider.id &&
      a.alertType === input.alertType &&
      a.status === 'Open',
  );
  if (duplicate) return duplicate;

  const client = getFhirClient();
  const now = new Date().toISOString();

  const issue = await client.create<FhirDetectedIssue>(ctx, {
    resourceType: 'DetectedIssue',
    status: 'final',
    severity: input.severity === 'High' ? 'high' : input.severity === 'Medium' ? 'moderate' : 'low',
    code: {
      coding: [
        {
          system: 'http://providerlink.local/CodeSystem/monitoring-alert',
          code: input.alertType,
          display: input.summary,
        },
      ],
    },
    identifiedDateTime: now,
    detail: `${input.provider.fullName} (NPI ${input.provider.npi}): ${input.details}`,
  });

  const task = await client.create<FhirTask>(ctx, {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    priority: input.severity === 'High' ? 'stat' : 'routine',
    code: {
      coding: [
        {
          system: 'http://providerlink.local/CodeSystem/task-type',
          code: `monitoring-${input.alertType.toLowerCase()}`,
          display: input.summary,
        },
      ],
    },
    for: { reference: `Practitioner/${input.provider.id}`, display: input.provider.fullName },
    description: input.details,
    authoredOn: now,
  });

  const alert: MonitoringAlert = {
    id: `mon-alt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    monitorId: input.monitorId,
    alertType: input.alertType,
    severity: input.severity,
    practitionerId: input.provider.id,
    providerName: input.provider.fullName,
    npi: input.provider.npi,
    summary: input.summary,
    details: input.details,
    status: 'Open',
    createdAt: now,
    taskId: task.id,
    detectedIssueId: issue.id,
  };
  st.alerts.unshift(alert);

  if (input.alertType === 'ExclusionHit') {
    eventBus.publish({
      type: 'ExclusionHit',
      tenantId: ctx.tenantId,
      sourceModule: 'M12',
      payload: {
        alertId: alert.id,
        practitionerId: input.provider.id,
        providerName: input.provider.fullName,
        npi: input.provider.npi,
        details: input.details,
      },
    });
  } else if (input.alertType === 'LicenseExpiring') {
    eventBus.publish({
      type: 'LicenseExpiring',
      tenantId: ctx.tenantId,
      sourceModule: 'M12',
      payload: {
        alertId: alert.id,
        practitionerId: input.provider.id,
        providerName: input.provider.fullName,
        npi: input.provider.npi,
        details: input.details,
      },
    });
  }

  return alert;
}

export const monitoringService = {
  getState(tenantId: string): TenantMonitoringState {
    return getState(tenantId);
  },

  resetForTests(tenantId?: string): void {
    if (tenantId) {
      tenantMonitoringStore.delete(tenantId);
    } else {
      tenantMonitoringStore.clear();
    }
  },

  toggleMonitor(tenantId: string, monitorId: MonitorId, enabled: boolean): MonitorConfig[] {
    const st = getState(tenantId);
    st.monitors = st.monitors.map((m) => (m.id === monitorId ? { ...m, enabled } : m));
    return st.monitors;
  },

  async runMonitor(
    ctx: FhirRequestContext,
    monitorId: MonitorId,
    actor: { name: string; role: RoleName },
  ): Promise<{ monitor: MonitorConfig; newAlerts: MonitoringAlert[] }> {
    const st = getState(ctx.tenantId);
    const monitor = st.monitors.find((m) => m.id === monitorId);
    if (!monitor) {
      throw new AppError({ message: 'Monitor not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const providers = await providerService.listProviders(ctx);
    const valState = validationService.getState(ctx.tenantId);
    const newAlerts: MonitoringAlert[] = [];
    const nowMs = Date.now();

    if (monitorId === 'exclusion-rescreen') {
      for (const prov of providers) {
        if (prov.status === 'Terminated') continue;
        const hit = valState.refData.exclusions.find(
          (e) =>
            (e.npi && e.npi === prov.npi) ||
            prov.fullName.toLowerCase().includes(e.name.toLowerCase()) ||
            e.name.toLowerCase().includes(prov.fullName.toLowerCase()),
        );
        if (hit) {
          const alert = await createAlertWithFhir(ctx, st, {
            monitorId,
            alertType: 'ExclusionHit',
            severity: 'High',
            provider: prov,
            summary: `Exclusion Hit (${hit.source})`,
            details: `${prov.fullName} (NPI ${prov.npi}) matched ${hit.source}: ${hit.exclusionType} (effective ${hit.effectiveDate}).`,
          });
          newAlerts.push(alert);
        }
      }
    } else if (monitorId === 'license-expiry') {
      for (const prov of providers) {
        if (prov.status === 'Terminated') continue;
        const expiry = st.licenseExpiryByProvider[prov.id];
        if (!expiry) continue;
        const daysLeft = Math.ceil((Date.parse(expiry) - nowMs) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 90) {
          const band = daysLeft <= 30 ? '30-day Critical' : daysLeft <= 60 ? '60-day Warning' : '90-day Notice';
          const alert = await createAlertWithFhir(ctx, st, {
            monitorId,
            alertType: 'LicenseExpiring',
            severity: daysLeft <= 30 ? 'High' : daysLeft <= 60 ? 'Medium' : 'Low',
            provider: prov,
            summary: `State License Expiring (${band})`,
            details: `License ${prov.licenseState}-${prov.licenseNumber} expires on ${expiry} (${daysLeft} day(s) remaining).`,
          });
          newAlerts.push(alert);
        }
      }
    } else if (monitorId === 'death-master') {
      for (const prov of providers) {
        if (valState.refData.deathMasterNpis.includes(prov.npi)) {
          const alert = await createAlertWithFhir(ctx, st, {
            monitorId,
            alertType: 'DeathMasterHit',
            severity: 'High',
            provider: prov,
            summary: 'SSA Death Master File Match',
            details: `Active provider NPI ${prov.npi} matched SSA Death Master deceased record.`,
          });
          newAlerts.push(alert);
        }
      }
    } else if (monitorId === 'adverse-actions') {
      for (const prov of providers) {
        const rev = valState.refData.revokedLicenses.find(
          (l) => l.licenseNumber.toLowerCase() === prov.licenseNumber.toLowerCase(),
        );
        if (rev) {
          const alert = await createAlertWithFhir(ctx, st, {
            monitorId,
            alertType: 'AdverseAction',
            severity: 'High',
            provider: prov,
            summary: `Licensing Board ${rev.status}`,
            details: `State board reported license ${prov.licenseNumber} as ${rev.status}.`,
          });
          newAlerts.push(alert);
        }
      }
    } else if (monitorId === 'returned-mail') {
      for (const prov of providers) {
        if (!prov.street || !prov.postalCode) {
          const alert = await createAlertWithFhir(ctx, st, {
            monitorId,
            alertType: 'ReturnedMail',
            severity: 'Low',
            provider: prov,
            summary: 'Undeliverable / Incomplete Address',
            details: `Practice address incomplete for ${prov.fullName}; returned mail verification required.`,
          });
          newAlerts.push(alert);
        }
      }
    } else if (monitorId === 'revalidation-due') {
      for (const prov of providers) {
        if (prov.status === 'Terminated') continue;
        const due = st.revalidationDueByProvider[prov.id];
        const daysLeft = due ? Math.ceil((Date.parse(due) - nowMs) / (1000 * 60 * 60 * 24)) : 999;
        if (prov.status === 'Revalidation Due' || daysLeft <= 90) {
          const alert = await createAlertWithFhir(ctx, st, {
            monitorId,
            alertType: 'RevalidationDue',
            severity: daysLeft <= 0 ? 'High' : 'Medium',
            provider: prov,
            summary: daysLeft <= 0 ? 'Revalidation Grace Period Expired' : '5-Year Revalidation Due',
            details: due
              ? `Medicaid revalidation due ${due} (${daysLeft <= 0 ? `${Math.abs(daysLeft)} days overdue` : `${daysLeft} days left`}).`
              : `Provider status is Revalidation Due.`,
          });
          newAlerts.push(alert);
        }
      }
    }

    monitor.lastRunAt = new Date().toISOString();
    monitor.lastHitCount = newAlerts.length;

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Task',
      outcomeDesc: `Executed M12 monitor '${monitor.name}': ${newAlerts.length} alert(s) raised`,
    });

    return { monitor, newAlerts };
  },

  acknowledgeAlert(
    tenantId: string,
    alertId: string,
    actorLabel: string,
  ): MonitoringAlert {
    const st = getState(tenantId);
    const alert = st.alerts.find((a) => a.id === alertId);
    if (!alert) {
      throw new AppError({ message: 'Alert not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    alert.status = 'Acknowledged';
    alert.actionedBy = actorLabel;
    alert.actionedAt = new Date().toISOString();
    alert.actionNote = 'Acknowledged by monitoring analyst.';
    return alert;
  },

  /**
   * Suspends provider via M22 providerOpsService (updating M3 Practitioner to Suspended and emitting
   * ProviderStatusChanged so M10 MMIS queues a status update and M11 blocks new claims with PROVIDER_NOT_ACTIVE),
   * and opens a Program Integrity referral Task.
   */
  async suspendProviderFromAlert(
    ctx: FhirRequestContext,
    alertId: string,
    reason: string,
    actor: { name: string; role: RoleName },
  ): Promise<MonitoringAlert> {
    const st = getState(ctx.tenantId);
    const alert = st.alerts.find((a) => a.id === alertId);
    if (!alert) {
      throw new AppError({ message: 'Alert not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const effectiveDate = new Date().toISOString().slice(0, 10);
    await providerOpsService.changeProviderStatus(
      ctx,
      alert.practitionerId,
      'Suspended',
      reason || `${alert.alertType}: ${alert.details}`,
      effectiveDate,
      actor,
    );

    const client = getFhirClient();
    const referralTask = await client.create<FhirTask>(ctx, {
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      priority: 'stat',
      code: { text: 'Program Integrity Referral' },
      for: { reference: `Practitioner/${alert.practitionerId}`, display: alert.providerName },
      description: `Suspended due to ${alert.alertType}: ${reason || alert.details}`,
      authoredOn: new Date().toISOString(),
    });

    alert.status = 'Suspended';
    alert.actionedBy = `${actor.name} (${actor.role})`;
    alert.actionedAt = new Date().toISOString();
    alert.actionNote = `Provider Suspended effective ${effectiveDate}; MMIS notified; Program Integrity referral Task/${referralTask.id}.`;
    alert.programIntegrityReferralId = referralTask.id;
    return alert;
  },

  /**
   * Starts a pre-filled M5 Revalidation (or CHOW) draft from a monitoring alert.
   */
  async startRevalidationFromAlert(
    ctx: FhirRequestContext,
    alertId: string,
    actorLabel: string,
  ): Promise<{ alert: MonitoringAlert; draftId: string }> {
    const st = getState(ctx.tenantId);
    const alert = st.alerts.find((a) => a.id === alertId);
    if (!alert) {
      throw new AppError({ message: 'Alert not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    const providers = await providerService.listProviders(ctx);
    const provider = providers.find((p) => p.id === alert.practitionerId);
    if (!provider) {
      throw new AppError({ message: 'Provider not found in M3 directory.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const appType = alert.alertType === 'OwnershipChange' ? 'Change of Ownership' : 'Revalidation';
    const draft = enrollmentService.createRevalidationDraftFromProvider(
      ctx.tenantId,
      provider,
      appType,
    );

    alert.status = 'RevalidationStarted';
    alert.revalidationDraftId = draft.id;
    alert.actionedBy = actorLabel;
    alert.actionedAt = new Date().toISOString();
    alert.actionNote = `Pre-filled M5 ${appType} application ${draft.applicationNumber}.`;

    return { alert, draftId: draft.id };
  },

  async dismissAlertWithReason(
    ctx: FhirRequestContext,
    alertId: string,
    reason: string,
    actor: { name: string; role: RoleName },
  ): Promise<MonitoringAlert> {
    if (!reason.trim()) {
      throw new AppError({
        message: 'A documented dismissal reason is required.',
        statusCode: 400,
        code: 'REASON_REQUIRED',
      });
    }
    const st = getState(ctx.tenantId);
    const alert = st.alerts.find((a) => a.id === alertId);
    if (!alert) {
      throw new AppError({ message: 'Alert not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const client = getFhirClient();
    const prov = await client.create<FhirProvenance>(ctx, {
      resourceType: 'Provenance',
      target: [
        {
          reference: alert.detectedIssueId
            ? `DetectedIssue/${alert.detectedIssueId}`
            : `Practitioner/${alert.practitionerId}`,
        },
      ],
      recorded: new Date().toISOString(),
      reason: [{ text: `Monitoring alert dismissed: ${reason}` }],
      agent: [{ who: { display: `${actor.name} (${actor.role})` } }],
    });

    alert.status = 'Dismissed';
    alert.actionedBy = `${actor.name} (${actor.role})`;
    alert.actionedAt = new Date().toISOString();
    alert.actionNote = `Dismissed (Provenance/${prov.id}): ${reason}`;
    return alert;
  },

  /**
   * Enforces revalidation grace period expiration -> transitions overdue Revalidation Due provider to Terminated.
   */
  async enforceRevalidationGraceTermination(
    ctx: FhirRequestContext,
    practitionerId: string,
    actor: { name: string; role: RoleName },
  ): Promise<void> {
    await providerOpsService.changeProviderStatus(
      ctx,
      practitionerId,
      'Terminated',
      'Revalidation grace period expired without completed M5 revalidation submission.',
      new Date().toISOString().slice(0, 10),
      actor,
    );
  },

  /**
   * Initiates a Change of Ownership (CHOW) monitoring alert & pre-filled M5 CHOW draft.
   */
  async triggerChangeOfOwnership(
    ctx: FhirRequestContext,
    practitionerId: string,
    newOwnerName: string,
    actor: { name: string; role: RoleName },
  ): Promise<{ alert: MonitoringAlert; draftId: string }> {
    const st = getState(ctx.tenantId);
    const providers = await providerService.listProviders(ctx);
    const provider = providers.find((p) => p.id === practitionerId);
    if (!provider) {
      throw new AppError({ message: 'Provider not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const alert = await createAlertWithFhir(ctx, st, {
      monitorId: 'manual-chow',
      alertType: 'OwnershipChange',
      severity: 'High',
      provider,
      summary: 'Change of Ownership (CHOW) Reported',
      details: `Reported controlling ownership transfer to ${newOwnerName}. Requires full M5 Change of Ownership screening.`,
    });

    const draft = enrollmentService.createRevalidationDraftFromProvider(
      ctx.tenantId,
      provider,
      'Change of Ownership',
    );
    alert.revalidationDraftId = draft.id;
    alert.status = 'RevalidationStarted';
    alert.actionedBy = `${actor.name} (${actor.role})`;
    alert.actionedAt = new Date().toISOString();
    alert.actionNote = `Created M5 CHOW draft ${draft.applicationNumber}.`;

    return { alert, draftId: draft.id };
  },

  /**
   * Creates a FHIR Subscription resource in the active FHIR client (Mock or Live).
   */
  async createFhirSubscription(
    ctx: FhirRequestContext,
    input: {
      reason: string;
      criteria: string;
      channelType: 'rest-hook' | 'websocket';
      endpoint: string;
    },
    actor: { name: string; role: RoleName },
  ): Promise<SubscriptionMonitorRecord> {
    const client = getFhirClient();
    const sub: FhirSubscription = {
      resourceType: 'Subscription',
      status: 'active',
      reason: input.reason,
      criteria: input.criteria,
      channel: {
        type: input.channelType,
        endpoint: input.endpoint,
        payload: 'application/fhir+json',
      },
    };
    const created = await client.create(ctx, sub);

    const record: SubscriptionMonitorRecord = {
      id: `sub-${Date.now().toString(36)}`,
      fhirSubscriptionId: created.id,
      reason: input.reason,
      criteria: input.criteria,
      channelType: input.channelType,
      endpoint: input.endpoint,
      status: 'active',
      createdAt: new Date().toISOString(),
      deliveryCount: 0,
    };
    const st = getState(ctx.tenantId);
    st.subscriptions.unshift(record);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Subscription',
      resourceId: created.id,
      outcomeDesc: `Created FHIR Subscription (${input.criteria})`,
    });

    return record;
  },

  simulateSubscriptionPing(tenantId: string, subscriptionId: string): SubscriptionMonitorRecord {
    const st = getState(tenantId);
    const sub = st.subscriptions.find((s) => s.id === subscriptionId);
    if (!sub) {
      throw new AppError({ message: 'Subscription not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    sub.deliveryCount += 1;
    sub.lastDeliveryAt = new Date().toISOString();
    return sub;
  },

  async getExpirationCalendar(ctx: FhirRequestContext): Promise<ExpirationCalendarEntry[]> {
    const st = getState(ctx.tenantId);
    const providers = await providerService.listProviders(ctx);
    const credState = credentialingService.getState(ctx.tenantId);
    const nowMs = Date.now();
    const entries: ExpirationCalendarEntry[] = [];

    const classify = (days: number): ExpirationCalendarEntry['urgency'] => {
      if (days <= 30) return '30-day Critical';
      if (days <= 60) return '60-day Warning';
      if (days <= 90) return '90-day Notice';
      return 'Scheduled';
    };

    for (const prov of providers) {
      const licDate = st.licenseExpiryByProvider[prov.id];
      if (licDate) {
        const days = Math.ceil((Date.parse(licDate) - nowMs) / (1000 * 60 * 60 * 24));
        entries.push({
          id: `cal-lic-${prov.id}`,
          practitionerId: prov.id,
          providerName: prov.fullName,
          npi: prov.npi,
          category: 'State License',
          dueDate: licDate,
          daysUntilDue: days,
          urgency: classify(days),
        });
      }
      const revalDate = st.revalidationDueByProvider[prov.id];
      if (revalDate) {
        const days = Math.ceil((Date.parse(revalDate) - nowMs) / (1000 * 60 * 60 * 24));
        entries.push({
          id: `cal-reval-${prov.id}`,
          practitionerId: prov.id,
          providerName: prov.fullName,
          npi: prov.npi,
          category: 'Medicaid Revalidation',
          dueDate: revalDate,
          daysUntilDue: days,
          urgency: classify(days),
        });
      }
    }

    for (const file of credState.files) {
      if (file.nextRecredentialingDue) {
        const days = Math.ceil((Date.parse(file.nextRecredentialingDue) - nowMs) / (1000 * 60 * 60 * 24));
        entries.push({
          id: `cal-cred-${file.id}`,
          practitionerId: file.practitionerId,
          providerName: file.providerName,
          npi: file.npi,
          category: 'Recredentialing',
          dueDate: file.nextRecredentialingDue,
          daysUntilDue: days,
          urgency: classify(days),
        });
      }
    }

    return entries.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  },
};
