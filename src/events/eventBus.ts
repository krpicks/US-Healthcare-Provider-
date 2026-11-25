export type PlatformEventType =
  | 'ProviderSubmitted'
  | 'ValidationCompleted'
  | 'ScreeningAssigned'
  | 'ScreeningCompleted'
  | 'ProviderApproved'
  | 'ProviderDenied'
  | 'CredentialingCompleted'
  | 'MmisLoadAcknowledged'
  | 'ProviderStatusChanged'
  | 'LicenseExpiring'
  | 'ExclusionHit'
  | 'PlanActivated'
  | 'NetworkChanged'
  | 'ContractSigned'
  | 'RateScheduleChanged'
  | 'CaseTriggered'
  | 'EicrGenerated'
  | 'ReportabilityResponseReceived'
  | 'TenantProvisioned'
  | 'ConfigChanged';

export const PLATFORM_EVENT_TYPES: readonly PlatformEventType[] = [
  'ProviderSubmitted',
  'ValidationCompleted',
  'ScreeningAssigned',
  'ScreeningCompleted',
  'ProviderApproved',
  'ProviderDenied',
  'CredentialingCompleted',
  'MmisLoadAcknowledged',
  'ProviderStatusChanged',
  'LicenseExpiring',
  'ExclusionHit',
  'PlanActivated',
  'NetworkChanged',
  'ContractSigned',
  'RateScheduleChanged',
  'CaseTriggered',
  'EicrGenerated',
  'ReportabilityResponseReceived',
  'TenantProvisioned',
  'ConfigChanged',
] as const;

export interface PlatformEvent<TPayload = Record<string, unknown>> {
  id: string;
  type: PlatformEventType;
  tenantId: string;
  correlationId: string;
  timestamp: string;
  sourceModule: string;
  payload: TPayload;
}

export type PlatformEventHandler<TPayload = Record<string, unknown>> = (
  event: PlatformEvent<TPayload>,
) => void | Promise<void>;

export interface PublishEventInput<TPayload = Record<string, unknown>> {
  type: PlatformEventType;
  tenantId: string;
  correlationId?: string;
  sourceModule: string;
  payload: TPayload;
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class TypedEventBus {
  private listeners = new Map<PlatformEventType | '*', Set<PlatformEventHandler>>();
  private eventHistory: PlatformEvent[] = [];
  private readonly maxHistory = 250;

  public subscribe<TPayload = Record<string, unknown>>(
    type: PlatformEventType | '*',
    handler: PlatformEventHandler<TPayload>,
  ): () => void {
    const existing = this.listeners.get(type) ?? new Set<PlatformEventHandler>();
    existing.add(handler as PlatformEventHandler);
    this.listeners.set(type, existing);

    return () => {
      const bucket = this.listeners.get(type);
      if (bucket) {
        bucket.delete(handler as PlatformEventHandler);
        if (bucket.size === 0) {
          this.listeners.delete(type);
        }
      }
    };
  }

  public publish<TPayload = Record<string, unknown>>(
    input: PublishEventInput<TPayload>,
  ): PlatformEvent<TPayload> {
    if (!input.tenantId || !input.tenantId.trim()) {
      throw new Error('Every platform event requires a non-empty tenantId.');
    }

    const event: PlatformEvent<TPayload> = {
      id: generateId('evt'),
      type: input.type,
      tenantId: input.tenantId.trim(),
      correlationId: input.correlationId?.trim() || generateId('corr'),
      timestamp: new Date().toISOString(),
      sourceModule: input.sourceModule,
      payload: input.payload,
    };

    this.eventHistory.unshift(event as PlatformEvent);
    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.length = this.maxHistory;
    }

    const specificHandlers = this.listeners.get(input.type);
    const wildcardHandlers = this.listeners.get('*');

    specificHandlers?.forEach((handler) => {
      void handler(event as PlatformEvent);
    });
    wildcardHandlers?.forEach((handler) => {
      void handler(event as PlatformEvent);
    });

    return event;
  }

  public getHistory(tenantId?: string): PlatformEvent[] {
    if (!tenantId) {
      return [...this.eventHistory];
    }
    return this.eventHistory.filter((evt) => evt.tenantId === tenantId);
  }

  public clearHistory(): void {
    this.eventHistory = [];
  }
}

export const eventBus = new TypedEventBus();
