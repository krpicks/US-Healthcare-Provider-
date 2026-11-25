import { describe, expect, it } from 'vitest';
import { PLATFORM_EVENT_TYPES, TypedEventBus } from '../eventBus';

describe('TypedEventBus', () => {
  it('defines all 20 required platform event types', () => {
    expect(PLATFORM_EVENT_TYPES).toHaveLength(20);
    expect(PLATFORM_EVENT_TYPES).toContain('ProviderSubmitted');
    expect(PLATFORM_EVENT_TYPES).toContain('TenantProvisioned');
    expect(PLATFORM_EVENT_TYPES).toContain('ReportabilityResponseReceived');
  });

  it('publishes events with tenantId, auto-generated correlationId, and delivers to subscribers', () => {
    const bus = new TypedEventBus();
    const received: string[] = [];

    const unsubscribe = bus.subscribe('ProviderSubmitted', (evt) => {
      received.push(`${evt.tenantId}:${evt.correlationId}`);
    });

    const published = bus.publish({
      type: 'ProviderSubmitted',
      tenantId: 'tenant-state-medicaid',
      sourceModule: 'M5',
      payload: { applicationId: 'app-1' },
    });

    expect(published.tenantId).toBe('tenant-state-medicaid');
    expect(published.correlationId).toMatch(/^corr-/);
    expect(received).toHaveLength(1);

    unsubscribe();
    bus.publish({
      type: 'ProviderSubmitted',
      tenantId: 'tenant-state-medicaid',
      sourceModule: 'M5',
      payload: { applicationId: 'app-2' },
    });
    expect(received).toHaveLength(1);
  });

  it('rejects events missing a tenantId', () => {
    const bus = new TypedEventBus();
    expect(() =>
      bus.publish({
        type: 'ConfigChanged',
        tenantId: '   ',
        sourceModule: 'M24',
        payload: {},
      }),
    ).toThrow(/tenantId/i);
  });

  it('filters event history strictly by tenantId', () => {
    const bus = new TypedEventBus();
    bus.publish({
      type: 'TenantProvisioned',
      tenantId: 'tenant-a',
      sourceModule: 'M24',
      payload: {},
    });
    bus.publish({
      type: 'TenantProvisioned',
      tenantId: 'tenant-b',
      sourceModule: 'M24',
      payload: {},
    });

    expect(bus.getHistory('tenant-a')).toHaveLength(1);
    expect(bus.getHistory('tenant-b')).toHaveLength(1);
    expect(bus.getHistory('tenant-a')[0].tenantId).toBe('tenant-a');
  });
});
