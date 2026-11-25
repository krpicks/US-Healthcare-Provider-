import { beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../events';
import { settingsService } from '../../../services';
import { tenantService } from '../../../tenancy';
import { enrollmentService } from '../../m5-enrollment/enrollmentService';
import { validationService } from '../../m6-validation/validationService';
import { screeningService } from '../../m7-screening/screeningService';
import { determinationService } from '../../m8-determination/determinationService';
import { credentialingService } from '../../m9-credentialing/credentialingService';
import { mmisEdiService } from '../../m10-mmis-edi/mmisEdiService';
import { claimsService } from '../../m11-claims/claimsService';
import { monitoringService } from '../../m12-monitoring/monitoringService';
import { ecrService } from '../../m13-ecr/ecrService';
import { udsService } from '../../m14-uds/udsService';
import { conformanceService } from '../../m15-conformance/conformanceService';
import { gatewayService } from '../../m16-gateway/gatewayService';
import { securityService } from '../../m17-security/securityService';
import { notificationService } from '../../m18-notifications/notificationService';
import { analyticsService } from '../../m19-analytics/analyticsService';
import { diagnosticsService } from '../../m20-diagnostics/diagnosticsService';
import { planService } from '../../m23-plans/planService';
import { e2eScenariosService } from '../e2eScenariosService';

describe('Phase 5 End-to-End Integration Scenarios (A–F) in Mock Mode', () => {
  beforeEach(() => {
    settingsService.reset();
    eventBus.clearHistory();
    tenantService.resetForTests();
    enrollmentService.resetForTests();
    validationService.resetForTests();
    screeningService.resetForTests();
    determinationService.resetForTests();
    credentialingService.resetForTests();
    mmisEdiService.resetForTests();
    claimsService.resetForTests();
    monitoringService.resetForTests();
    ecrService.resetForTests();
    udsService.resetForTests();
    conformanceService.resetForTests();
    gatewayService.resetForTests();
    securityService.resetForTests();
    notificationService.resetForTests();
    analyticsService.resetForTests();
    diagnosticsService.resetForTests();
    planService.resetForTests();
  });

  it('Scenario A: Provider Lifecycle (M5 -> M6 -> M7 -> M8 -> M3 -> M9/M23 -> M10 -> M11 Paid)', async () => {
    const res = await e2eScenariosService.runScenario('A');
    expect(res.error).toBeUndefined();
    expect(res.passed).toBe(true);
    expect(res.steps).toHaveLength(8);
    expect(res.steps.every((s) => s.passed)).toBe(true);
  });

  it('Scenario B: Program Integrity Exclusion Cascade (M6 -> M12 -> M3 -> M10 -> M11 Denied -> M18 -> M19)', async () => {
    const res = await e2eScenariosService.runScenario('B');
    expect(res.error).toBeUndefined();
    expect(res.passed).toBe(true);
    expect(res.steps).toHaveLength(5);
    expect(res.steps.every((s) => s.passed)).toBe(true);
  });

  it('Scenario C: Electronic Case Reporting (M4 -> M13 Trigger -> eICR -> Stub -> RR -> M18 -> M19)', async () => {
    const res = await e2eScenariosService.runScenario('C');
    expect(res.error).toBeUndefined();
    expect(res.passed).toBe(true);
    expect(res.steps).toHaveLength(4);
    expect(res.steps.every((s) => s.passed)).toBe(true);
  });

  it('Scenario D: UDS+ Cohort, In-Memory De-Identification, $validate, Submission Bundle & Gap Report', async () => {
    const res = await e2eScenariosService.runScenario('D');
    expect(res.error).toBeUndefined();
    expect(res.passed).toBe(true);
    expect(res.steps).toHaveLength(4);
    expect(res.steps.every((s) => s.passed)).toBe(true);
  });

  it('Scenario E: Conformance Probes, Inferno Import, Gateway Outage & M20 Troubleshooting Recovery', async () => {
    const res = await e2eScenariosService.runScenario('E');
    expect(res.error).toBeUndefined();
    expect(res.passed).toBe(true);
    expect(res.steps).toHaveLength(4);
    expect(res.steps.every((s) => s.passed)).toBe(true);
  });

  it('Scenario F: Multi-Tenancy Isolation, RBAC, PII Masking, SMART Scope 403 & FHIR AuditEvent Coverage', async () => {
    const res = await e2eScenariosService.runScenario('F');
    expect(res.error).toBeUndefined();
    expect(res.passed).toBe(true);
    expect(res.steps).toHaveLength(4);
    expect(res.steps.every((s) => s.passed)).toBe(true);
  });
});
