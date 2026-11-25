import { beforeEach, describe, expect, it } from 'vitest';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { settingsService } from '../../../services';
import { conformanceService } from '../../m15-conformance/conformanceService';
import {
  analyticsService,
  buildCsvFromSeries,
  evaluateRagStatus,
  type KpiTargetConfig,
} from '../analyticsService';

const CTX = {
  tenantId: 'state-medicaid-a',
  tenantCode: 'STATE_A',
  correlationId: 'corr-m19-test',
};

describe('M19 Analytics & KPI Dashboard', () => {
  beforeEach(async () => {
    settingsService.reset();
    mockFhirClient.clearTenantStore(CTX.tenantId);
    await seedTenantFhirData(mockFhirClient, CTX, true);
    analyticsService.resetForTests();
    conformanceService.resetForTests();
  });

  it('aggregates live metrics across modules including M3 providers and M15 Inferno runs', async () => {
    conformanceService.importInfernoResults(
      CTX.tenantId,
      JSON.stringify({
        suiteName: 'US Core v6.1.0 Run',
        igVersion: '6.1.0',
        results: [
          { test_id: 't1', title: 'Patient Read', result: 'pass' },
          { test_id: 't2', title: 'Condition Search', result: 'pass' },
          { test_id: 't3', title: 'Observation Profile', result: 'pass' },
          { test_id: 't4', title: 'Provenance Check', result: 'fail' },
        ],
      }),
      'JSON',
    );

    const snapshot = await analyticsService.computeSnapshot(CTX);
    expect(snapshot.kpis.length).toBe(16);
    expect(snapshot.providerStatusBreakdown.length).toBeGreaterThan(0);

    const infernoKpi = snapshot.kpis.find((k) => k.config.id === 'inferno-pass');
    expect(infernoKpi).toBeDefined();
    expect(infernoKpi?.value).toBe(75);
    expect(infernoKpi?.rag).toBe('Amber');
  });

  it('evaluates editable RAG thresholds accurately for both higher-is-better and lower-is-better KPIs', () => {
    const higherCfg: KpiTargetConfig = {
      id: 'k1',
      tab: 'Executive',
      label: 'Pass Rate',
      unit: '%',
      higherIsBetter: true,
      target: 90,
      amberThreshold: 75,
      redThreshold: 60,
    };
    expect(evaluateRagStatus(higherCfg, 92)).toBe('Green');
    expect(evaluateRagStatus(higherCfg, 80)).toBe('Amber');
    expect(evaluateRagStatus(higherCfg, 62)).toBe('Red');

    const lowerCfg: KpiTargetConfig = {
      id: 'k2',
      tab: 'Operations',
      label: 'Days to Pay',
      unit: 'days',
      higherIsBetter: false,
      target: 14,
      amberThreshold: 21,
      redThreshold: 30,
    };
    expect(evaluateRagStatus(lowerCfg, 10)).toBe('Green');
    expect(evaluateRagStatus(lowerCfg, 18)).toBe('Amber');
    expect(evaluateRagStatus(lowerCfg, 28)).toBe('Red');

    const updated = analyticsService.updateTarget(CTX.tenantId, 'first-pass', {
      target: 95,
      amberThreshold: 88,
    });
    expect(updated?.target).toBe(95);
    expect(updated?.amberThreshold).toBe(88);
  });

  it('generates 6-month Mock demo history series for executive and interoperability charts', async () => {
    const snapshot = await analyticsService.computeSnapshot(CTX);
    expect(snapshot.monthlyEnrollmentTrend).toHaveLength(6);
    expect(snapshot.interopMonthlyTrend).toHaveLength(6);
    expect(snapshot.denialPareto.length).toBeGreaterThan(0);
  });

  it('exports chart series as properly escaped CSV with headers', () => {
    const csv = buildCsvFromSeries(
      ['Month', 'Pass Rate (%)', 'Notes'],
      [
        ['Oct 2026', 85, 'Baseline, steady'],
        ['Nov 2026', 92, 'Target "met"'],
      ],
    );
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Month,Pass Rate (%),Notes');
    expect(lines[1]).toBe('Oct 2026,85,"Baseline, steady"');
    expect(lines[2]).toBe('Nov 2026,92,"Target ""met"""');
  });
});
