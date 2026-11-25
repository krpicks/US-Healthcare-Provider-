import { eventBus, type PlatformEvent, type PlatformEventType } from '../../events';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { auditService } from '../../services/auditService';
import {
  AppError,
  type FhirCommunication,
  type RoleName,
} from '../../types';

export type NotificationChannel = 'Email' | 'Portal' | 'SMS' | 'Letter';

export type DeliveryStatus = 'Queued' | 'Sent' | 'Failed';

export interface CorrespondenceTemplate {
  id: string;
  key:
    | 'acknowledgement'
    | 'rfi'
    | 'approval'
    | 'denial'
    | 'revalidation'
    | 'termination'
    | 'ecr_rr';
  name: string;
  version: number;
  approvalStatus: 'Draft' | 'Approved';
  approvedBy?: string;
  subjectTemplate: string;
  bodyTemplate: string;
  updatedAt: string;
}

export interface EventTemplateMapping {
  id: string;
  eventType: PlatformEventType;
  templateId: string;
  channel: NotificationChannel;
  enabled: boolean;
  priority: 'Normal' | 'Critical';
}

export interface NotificationDeliveryRecord {
  id: string;
  timestamp: string;
  eventType?: PlatformEventType;
  templateId: string;
  templateName: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  body: string;
  status: DeliveryStatus;
  failureReason?: string;
  retryCount: number;
  communicationId?: string;
  read: boolean;
}

export interface QuietHoursPreferences {
  enabled: boolean;
  startHour: number; // 0-23, e.g. 22
  endHour: number; // 0-23, e.g. 7
  deferNonCritical: boolean;
  simulatedCurrentHour?: number; // optional test/demo override
  emailEnabled: boolean;
  portalEnabled: boolean;
  smsEnabled: boolean;
}

export interface NotificationTenantState {
  templates: CorrespondenceTemplate[];
  mappings: EventTemplateMapping[];
  deliveries: NotificationDeliveryRecord[];
  preferences: QuietHoursPreferences;
}

const DEFAULT_TEMPLATES: CorrespondenceTemplate[] = [
  {
    id: 'tpl-ack',
    key: 'acknowledgement',
    name: 'Enrollment Application Acknowledgement',
    version: 1,
    approvalStatus: 'Approved',
    approvedBy: 'AgencyApprover',
    subjectTemplate: 'Application Received — {{applicationNumber}}',
    bodyTemplate:
      'Dear {{providerName}}, your enrollment application ({{applicationNumber}}) has been received on {{effectiveDate}}. Automated validation and screening have started.',
    updatedAt: '2026-01-10',
  },
  {
    id: 'tpl-rfi',
    key: 'rfi',
    name: 'Request for Information (RFI)',
    version: 1,
    approvalStatus: 'Approved',
    approvedBy: 'AgencyApprover',
    subjectTemplate: 'Action Required: RFI for {{providerName}}',
    bodyTemplate:
      'Dear {{providerName}}, additional documentation is required to continue reviewing your enrollment ({{caseNumber}}). Please upload the requested files via the Portal within 15 days.',
    updatedAt: '2026-01-10',
  },
  {
    id: 'tpl-approval',
    key: 'approval',
    name: 'Enrollment Approval Notice',
    version: 1,
    approvalStatus: 'Approved',
    approvedBy: 'AgencyApprover',
    subjectTemplate: 'Congratulations: Provider Enrollment Approved ({{npi}})',
    bodyTemplate:
      'Dear {{providerName}}, your Medicaid provider enrollment (NPI {{npi}}) is Approved effective {{effectiveDate}}. Your record has been queued for MMIS loading.',
    updatedAt: '2026-01-10',
  },
  {
    id: 'tpl-denial',
    key: 'denial',
    name: 'Denial Notice with Appeal Rights',
    version: 1,
    approvalStatus: 'Approved',
    approvedBy: 'AgencyApprover',
    subjectTemplate: 'Determination Notice: Application Denied — Appeal Rights Enclosed',
    bodyTemplate:
      'Dear {{providerName}}, your application ({{caseNumber}}) was denied for reason: {{reason}}. You have the right to file a formal administrative appeal within 30 calendar days under 42 CFR 455.',
    updatedAt: '2026-01-10',
  },
  {
    id: 'tpl-reval',
    key: 'revalidation',
    name: 'Revalidation / License Expiry Reminder',
    version: 1,
    approvalStatus: 'Approved',
    approvedBy: 'AgencyApprover',
    subjectTemplate: 'Reminder: Credential / Revalidation Action Due for {{providerName}}',
    bodyTemplate:
      'Dear {{providerName}}, our continuous monitoring system flagged an upcoming credential expiration or 5-year revalidation deadline ({{detail}}). Complete your pre-filled M5 revalidation packet before the grace period ends.',
    updatedAt: '2026-01-10',
  },
  {
    id: 'tpl-term',
    key: 'termination',
    name: 'Suspension / Termination Notice',
    version: 1,
    approvalStatus: 'Approved',
    approvedBy: 'ProgramIntegrityOfficer',
    subjectTemplate: 'URGENT: Provider Status Change / Suspension Notice ({{npi}})',
    bodyTemplate:
      'Notice to {{providerName}} (NPI {{npi}}): Your network/enrollment status has been updated to {{status}} effective {{effectiveDate}} due to {{reason}}. Claims submission is blocked during suspension.',
    updatedAt: '2026-01-10',
  },
  {
    id: 'tpl-ecr-rr',
    key: 'ecr_rr',
    name: 'eCR Reportability Response (RR) Notice',
    version: 1,
    approvalStatus: 'Approved',
    approvedBy: 'IntegrationEngineer',
    subjectTemplate: 'Public Health eCR Reportability Response: {{determination}} ({{caseNumber}})',
    bodyTemplate:
      'Public Health Authority returned a Reportability Response ({{determination}}) for eCR Case {{caseNumber}} (Patient/{{patientId}}). DocumentReference/{{documentReferenceId}} has been attached to the chart.',
    updatedAt: '2026-01-10',
  },
];

const DEFAULT_MAPPINGS: EventTemplateMapping[] = [
  { id: 'map-sub', eventType: 'ProviderSubmitted', templateId: 'tpl-ack', channel: 'Email', enabled: true, priority: 'Normal' },
  { id: 'map-app', eventType: 'ProviderApproved', templateId: 'tpl-approval', channel: 'Email', enabled: true, priority: 'Normal' },
  { id: 'map-den', eventType: 'ProviderDenied', templateId: 'tpl-denial', channel: 'Letter', enabled: true, priority: 'Critical' },
  { id: 'map-lic', eventType: 'LicenseExpiring', templateId: 'tpl-reval', channel: 'Portal', enabled: true, priority: 'Normal' },
  { id: 'map-exc', eventType: 'ExclusionHit', templateId: 'tpl-term', channel: 'Email', enabled: true, priority: 'Critical' },
  { id: 'map-sts', eventType: 'ProviderStatusChanged', templateId: 'tpl-term', channel: 'Portal', enabled: true, priority: 'Critical' },
  { id: 'map-rr', eventType: 'ReportabilityResponseReceived', templateId: 'tpl-ecr-rr', channel: 'Portal', enabled: true, priority: 'Critical' },
];

const storeByTenant = new Map<string, NotificationTenantState>();
let notifSeq = 100;

function nextNotifId(prefix: string): string {
  notifSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${notifSeq}`;
}

function getOrInitState(tenantId: string): NotificationTenantState {
  const existing = storeByTenant.get(tenantId);
  if (existing) return existing;

  const initial: NotificationTenantState = {
    templates: DEFAULT_TEMPLATES.map((t) => ({ ...t })),
    mappings: DEFAULT_MAPPINGS.map((m) => ({ ...m })),
    deliveries: [],
    preferences: {
      enabled: false,
      startHour: 22,
      endHour: 7,
      deferNonCritical: true,
      emailEnabled: true,
      portalEnabled: true,
      smsEnabled: false,
    },
  };
  storeByTenant.set(tenantId, initial);
  return initial;
}

export function renderTemplateText(
  template: string,
  variables: Record<string, string | number | undefined>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const val = variables[key];
    return val !== undefined && val !== '' ? String(val) : `[${key}]`;
  });
}

function isWithinQuietHours(prefs: QuietHoursPreferences): boolean {
  if (!prefs.enabled || !prefs.deferNonCritical) return false;
  const hour =
    typeof prefs.simulatedCurrentHour === 'number'
      ? prefs.simulatedCurrentHour
      : new Date().getHours();
  if (prefs.startHour > prefs.endHour) {
    // Wraps midnight, e.g., 22 -> 7
    return hour >= prefs.startHour || hour < prefs.endHour;
  }
  return hour >= prefs.startHour && hour < prefs.endHour;
}

// Auto-subscribe to platform events across tenants
let busSubscribed = false;
function ensureEventBusSubscription() {
  if (busSubscribed) return;
  busSubscribed = true;

  eventBus.subscribe('*', (evt: PlatformEvent) => {
    const st = getOrInitState(evt.tenantId);
    const mapping = st.mappings.find(
      (m) => m.eventType === evt.type && m.enabled,
    );
    if (!mapping) return;
    const tpl = st.templates.find((t) => t.id === mapping.templateId);
    if (!tpl) return;

    const payload = (evt.payload ?? {}) as Record<string, unknown>;
    const vars: Record<string, string> = {
      providerName: String(payload.providerName ?? payload.fullName ?? 'Provider'),
      npi: String(payload.npi ?? 'N/A'),
      applicationNumber: String(payload.applicationNumber ?? payload.caseNumber ?? evt.id),
      caseNumber: String(payload.caseNumber ?? payload.applicationNumber ?? evt.id),
      effectiveDate: String(payload.effectiveDate ?? new Date().toISOString().slice(0, 10)),
      reason: String(payload.reason ?? payload.details ?? 'See portal details'),
      status: String(payload.newStatus ?? payload.status ?? 'Updated'),
      detail: String(payload.summary ?? payload.details ?? 'Action required'),
      determination: String(payload.determination ?? 'Reportable'),
      patientId: String(payload.patientId ?? 'N/A'),
      documentReferenceId: String(payload.documentReferenceId ?? 'pending'),
    };

    const quiet = mapping.priority !== 'Critical' && isWithinQuietHours(st.preferences);
    const delivery: NotificationDeliveryRecord = {
      id: nextNotifId('deliv'),
      timestamp: evt.timestamp,
      eventType: evt.type,
      templateId: tpl.id,
      templateName: tpl.name,
      channel: mapping.channel,
      recipient: String(payload.recipient ?? vars.providerName),
      subject: renderTemplateText(tpl.subjectTemplate, vars),
      body: renderTemplateText(tpl.bodyTemplate, vars),
      status: quiet ? 'Queued' : 'Sent',
      retryCount: 0,
      read: false,
    };

    st.deliveries.unshift(delivery);
  });
}

ensureEventBusSubscription();

export const notificationService = {
  getState(tenantId: string): NotificationTenantState {
    ensureEventBusSubscription();
    return getOrInitState(tenantId);
  },

  resetForTests(): void {
    storeByTenant.clear();
    ensureEventBusSubscription();
  },

  updatePreferences(
    tenantId: string,
    patch: Partial<QuietHoursPreferences>,
  ): QuietHoursPreferences {
    const st = getOrInitState(tenantId);
    Object.assign(st.preferences, patch);
    return st.preferences;
  },

  updateMapping(
    tenantId: string,
    mappingId: string,
    patch: Partial<Pick<EventTemplateMapping, 'templateId' | 'channel' | 'enabled' | 'priority'>>,
  ): EventTemplateMapping {
    const st = getOrInitState(tenantId);
    const m = st.mappings.find((x) => x.id === mappingId);
    if (!m) throw new AppError({ message: 'Mapping not found.', statusCode: 404, code: 'NOT_FOUND' });
    Object.assign(m, patch);
    return m;
  },

  updateTemplateNewVersion(
    tenantId: string,
    templateId: string,
    patch: { subjectTemplate: string; bodyTemplate: string },
  ): CorrespondenceTemplate {
    const st = getOrInitState(tenantId);
    const tpl = st.templates.find((t) => t.id === templateId);
    if (!tpl) throw new AppError({ message: 'Template not found.', statusCode: 404, code: 'NOT_FOUND' });
    tpl.subjectTemplate = patch.subjectTemplate;
    tpl.bodyTemplate = patch.bodyTemplate;
    tpl.version += 1;
    tpl.approvalStatus = 'Draft';
    tpl.approvedBy = undefined;
    tpl.updatedAt = new Date().toISOString().slice(0, 10);
    return tpl;
  },

  approveTemplate(
    tenantId: string,
    templateId: string,
    approverLabel: string,
  ): CorrespondenceTemplate {
    const st = getOrInitState(tenantId);
    const tpl = st.templates.find((t) => t.id === templateId);
    if (!tpl) throw new AppError({ message: 'Template not found.', statusCode: 404, code: 'NOT_FOUND' });
    tpl.approvalStatus = 'Approved';
    tpl.approvedBy = approverLabel;
    tpl.updatedAt = new Date().toISOString().slice(0, 10);
    return tpl;
  },

  async sendNotification(
    ctx: FhirRequestContext,
    input: {
      templateId: string;
      channel: NotificationChannel;
      recipient: string;
      variables: Record<string, string>;
      priority?: 'Normal' | 'Critical';
      simulateFailure?: boolean;
    },
    actor: { name: string; role: RoleName },
  ): Promise<NotificationDeliveryRecord> {
    const st = getOrInitState(ctx.tenantId);
    const tpl = st.templates.find((t) => t.id === input.templateId);
    if (!tpl) {
      throw new AppError({ message: 'Correspondence template not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const subject = renderTemplateText(tpl.subjectTemplate, input.variables);
    const body = renderTemplateText(tpl.bodyTemplate, input.variables);
    const quiet = input.priority !== 'Critical' && isWithinQuietHours(st.preferences);
    const status: DeliveryStatus = input.simulateFailure
      ? 'Failed'
      : quiet
        ? 'Queued'
        : 'Sent';

    const client = getFhirClient();
    const comm = await client.create<FhirCommunication>(ctx, {
      resourceType: 'Communication',
      status: status === 'Sent' ? 'completed' : status === 'Queued' ? 'preparation' : 'not-done',
      category: [{ text: `${tpl.key} (${input.channel})` }],
      sent: status === 'Sent' ? new Date().toISOString() : undefined,
      recipient: [{ display: input.recipient }],
      sender: { display: `${actor.name} (${actor.role})` },
      payload: [{ contentString: `[${subject}] ${body}` }],
    });

    const record: NotificationDeliveryRecord = {
      id: nextNotifId('deliv'),
      timestamp: new Date().toISOString(),
      templateId: tpl.id,
      templateName: `${tpl.name} v${tpl.version}`,
      channel: input.channel,
      recipient: input.recipient,
      subject,
      body,
      status,
      failureReason: input.simulateFailure ? 'Simulated SMTP / Gateway 550 bounce.' : undefined,
      retryCount: 0,
      communicationId: comm.id,
      read: false,
    };

    st.deliveries.unshift(record);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Communication',
      resourceId: comm.id,
      outcomeDesc: `Sent ${tpl.name} via ${input.channel} (${status}) to ${input.recipient}`,
    });

    return record;
  },

  async retryDelivery(
    ctx: FhirRequestContext,
    deliveryId: string,
    actor: { name: string; role: RoleName },
  ): Promise<NotificationDeliveryRecord> {
    const st = getOrInitState(ctx.tenantId);
    const item = st.deliveries.find((d) => d.id === deliveryId);
    if (!item) throw new AppError({ message: 'Delivery record not found.', statusCode: 404, code: 'NOT_FOUND' });

    item.retryCount += 1;
    item.status = 'Sent';
    item.failureReason = undefined;
    item.timestamp = new Date().toISOString();

    if (item.communicationId) {
      const client = getFhirClient();
      try {
        const existing = await client.read<FhirCommunication>(
          ctx,
          'Communication',
          item.communicationId,
        );
        await client.update<FhirCommunication>(ctx, {
          ...existing,
          status: 'completed',
          sent: item.timestamp,
        });
      } catch {
        // Ignore if mock store was reset between retries
      }
    }

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Communication',
      resourceId: item.communicationId,
      outcomeDesc: `Retried delivery ${item.id} (attempt ${item.retryCount}) — Sent`,
    });

    return item;
  },

  markAllRead(tenantId: string): void {
    getOrInitState(tenantId).deliveries.forEach((d) => {
      d.read = true;
    });
  },
};
