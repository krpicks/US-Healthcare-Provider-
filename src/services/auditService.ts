import { getFhirClient, type FhirRequestContext } from '../fhir';
import type { FhirAuditEvent, RoleName } from '../types';

export type AuditActionKind = 'create' | 'update' | 'delete' | 'export' | 'unmask' | 'read';

const ACTION_CODE_MAP: Record<AuditActionKind, 'C' | 'R' | 'U' | 'D' | 'E'> = {
  create: 'C',
  read: 'R',
  update: 'U',
  delete: 'D',
  export: 'E',
  unmask: 'R',
};

export interface RecordAuditInput {
  ctx: FhirRequestContext;
  actorName: string;
  actorRole: RoleName;
  action: AuditActionKind;
  resourceType: string;
  resourceId?: string;
  outcome?: '0' | '4' | '8' | '12';
  outcomeDesc?: string;
  details?: Record<string, string>;
}

const auditListeners = new Set<() => void>();

export const auditService = {
  subscribe(listener: () => void): () => void {
    auditListeners.add(listener);
    return () => {
      auditListeners.delete(listener);
    };
  },

  async record(input: RecordAuditInput): Promise<FhirAuditEvent> {
    const client = getFhirClient();
    const entityDetail = input.details
      ? Object.entries(input.details).map(([type, valueString]) => ({
          type,
          valueString,
        }))
      : undefined;

    const event: FhirAuditEvent = {
      resourceType: 'AuditEvent',
      type: {
        system: 'http://terminology.hl7.org/CodeSystem/audit-event-type',
        code: input.action === 'unmask' ? '110110' : 'rest',
        display:
          input.action === 'unmask'
            ? 'Sensitive PII/PHI Unmask'
            : `FHIR ${input.action.toUpperCase()}`,
      },
      subtype: [
        {
          system: 'http://providerlink.local/CodeSystem/audit-action',
          code: input.action,
          display: input.action,
        },
      ],
      action: ACTION_CODE_MAP[input.action],
      recorded: new Date().toISOString(),
      outcome: input.outcome ?? '0',
      outcomeDesc:
        input.outcomeDesc ??
        `${input.action} on ${input.resourceType}${input.resourceId ? `/${input.resourceId}` : ''} (${input.ctx.tenantCode})`,
      agent: [
        {
          role: [
            {
              coding: [
                {
                  system: 'http://providerlink.local/CodeSystem/role',
                  code: input.actorRole,
                  display: input.actorRole,
                },
              ],
            },
          ],
          altId: input.actorRole,
          name: input.actorName,
          requestor: true,
        },
      ],
      source: {
        site: input.ctx.tenantCode,
        observer: {
          display: 'ProviderLink FHIR Platform',
        },
      },
      entity: [
        {
          what: input.resourceId
            ? { reference: `${input.resourceType}/${input.resourceId}` }
            : undefined,
          type: {
            system: 'http://hl7.org/fhir/resource-types',
            code: input.resourceType,
          },
          name: input.resourceType,
          description: input.outcomeDesc,
          detail: [
            { type: 'tenantId', valueString: input.ctx.tenantId },
            ...(entityDetail ?? []),
          ],
        },
      ],
    };

    const created = await client.create(input.ctx, event);
    auditListeners.forEach((fn) => fn());
    return created;
  },

  async list(
    ctx: FhirRequestContext,
    filters?: {
      actor?: string;
      action?: string;
      resourceType?: string;
      outcome?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ): Promise<FhirAuditEvent[]> {
    const client = getFhirClient();
    const res = await client.search<FhirAuditEvent>(ctx, 'AuditEvent', {
      _count: 500,
    });

    const items = [...res.resources].sort((a, b) =>
      (b.recorded ?? '').localeCompare(a.recorded ?? ''),
    );

    if (!filters) return items;

    return items.filter((evt) => {
      if (filters.actor) {
        const needle = filters.actor.toLowerCase();
        const actorMatch = evt.agent?.some(
          (a) =>
            (a.name ?? '').toLowerCase().includes(needle) ||
            (a.altId ?? '').toLowerCase().includes(needle),
        );
        if (!actorMatch) return false;
      }
      if (filters.action && filters.action !== 'all') {
        const sub = evt.subtype?.[0]?.code ?? '';
        if (sub !== filters.action && evt.action !== filters.action) {
          return false;
        }
      }
      if (filters.resourceType && filters.resourceType !== 'all') {
        const rType = evt.entity?.[0]?.type?.code ?? evt.entity?.[0]?.name ?? '';
        if (rType.toLowerCase() !== filters.resourceType.toLowerCase()) {
          return false;
        }
      }
      if (filters.outcome && filters.outcome !== 'all') {
        if ((evt.outcome ?? '0') !== filters.outcome) {
          return false;
        }
      }
      if (filters.dateFrom && evt.recorded && evt.recorded.slice(0, 10) < filters.dateFrom) {
        return false;
      }
      if (filters.dateTo && evt.recorded && evt.recorded.slice(0, 10) > filters.dateTo) {
        return false;
      }
      return true;
    });
  },
};
