import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { gatewayService } from '../gatewayService';

describe('M16 Integration Gateway Console (.NET)', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };

  beforeEach(async () => {
    settingsService.reset();
    gatewayService.resetForTests();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('executes Try-It endpoints in Mock mode and passes all automated contract tests', async () => {
    const resp = await gatewayService.invokeEndpoint(ctx.tenantId, 'ep-fhir-version');
    expect(resp.status).toBe(200);
    expect(resp.body.fhirVersion).toBe('4.0.1');
    expect(resp.correlationId).toBeTruthy();

    const contracts = await gatewayService.runContractTests(ctx.tenantId);
    expect(contracts.length).toBeGreaterThanOrEqual(6);
    expect(contracts.every((c) => c.passed)).toBe(true);
  });

  it('polls Gateway, FHIR, and eCRNow health and surfaces CORS diagnostics when Live gateway fails', async () => {
    const healthy = await gatewayService.pollServiceHealth(ctx);
    expect(healthy).toHaveLength(3);
    expect(healthy.every((h) => h.status === 'Up')).toBe(true);

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    gatewayService.setLiveMode(ctx.tenantId, true);

    const livePoll = await gatewayService.pollServiceHealth(ctx);
    const gw = livePoll.find((h) => h.serviceId === 'gateway');
    expect(gw?.status).toBe('Down');
    expect(gw?.reason).toMatch(/CORS/i);

    fetchSpy.mockRestore();
  });

  it('exercises resilience failure simulator (Transient503 retry recovery, SustainedOutage opening Circuit Breaker with RFC 7807 ProblemDetails)', async () => {
    gatewayService.setFailureSimulation(ctx.tenantId, 'Transient503');
    const recovered = await gatewayService.invokeEndpoint(ctx.tenantId, 'ep-health');
    expect(recovered.status).toBe(200);
    expect(recovered.attempts).toBe(2);

    gatewayService.setFailureSimulation(ctx.tenantId, 'SustainedOutage');
    await gatewayService.invokeEndpoint(ctx.tenantId, 'ep-health');
    await gatewayService.invokeEndpoint(ctx.tenantId, 'ep-health');
    const third = await gatewayService.invokeEndpoint(ctx.tenantId, 'ep-health');
    expect(third.status).toBe(503);
    expect(third.isProblemDetails).toBe(true);
    expect(third.circuitState).toBe('Open');

    const fastFail = await gatewayService.invokeEndpoint(ctx.tenantId, 'ep-health');
    expect(fastFail.attempts).toBe(0);
    expect(String(fastFail.body.title)).toContain('Circuit Breaker Open');

    gatewayService.resetCircuitBreaker(ctx.tenantId);
    expect(gatewayService.getState(ctx.tenantId).circuitState).toBe('Closed');
  });

  it('simulates Client-Credentials token issuance keeping secret strictly in memory and never in localStorage', () => {
    const secretVal = 'super-synthetic-test-secret-999';
    const session = gatewayService.simulateClientCredentialsAuth(ctx.tenantId, {
      clientId: 'gw-client-01',
      clientSecret: secretVal,
      scope: 'system/Practitioner.write',
      ttlSeconds: 300,
    });

    expect(session.accessToken.split('.')).toHaveLength(3);
    expect(session.expiresAt).toBeGreaterThan(session.issuedAt);
    expect(settingsService.getSessionSecret('m16.gateway.clientSecret')).toBe(secretVal);

    if (typeof window !== 'undefined' && window.localStorage) {
      const dumped = JSON.stringify(window.localStorage);
      expect(dumped).not.toContain(secretVal);
    }

    gatewayService.clearAuthSession(ctx.tenantId);
    expect(settingsService.getSessionSecret('m16.gateway.clientSecret')).toBeUndefined();
  });
});
