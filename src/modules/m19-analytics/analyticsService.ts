import type { FhirRequestContext } from '../../fhir';
import { providerService } from '../m3-directory/providerService';
import { enrollmentService } from '../m5-enrollment/enrollmentService';
import { validationService } from '../m6-validation/validationService';
import { determinationService } from '../m8-determination/determinationService';
import { mmisEdiService } from '../m10-mmis-edi/mmisEdiService';
import { claimsService } from '../m11-claims/claimsService';
import { monitoringService } from '../m12-monitoring/monitoringService';
import { ecrService } from '../m13-ecr/ecrService';
import { udsService } from '../m14-uds/udsService';
import { conformanceService } from '../m15-conformance/conformanceService';
import { gatewayService } from '../m16-gateway/gatewayService';

export type RagStatus = 'Green' | 'Amber' | 'Red';

export interface KpiTargetConfig {
  id: string;
  tab: 'Executive' | 'Interoperability' | 'Operations' | 'Program Integrity';
  label: string;
  unit: '%' | 'days' | 'ms' | 'count';
  higherIsBetter: boolean;
  target: number;
  amberThreshold: number;
  redThreshold: number;
}

export interface ComputedKpiMetric {
  config: KpiTargetConfig;
  value: number;
  rag: RagStatus;
  subtitle: string;
}

export interface ChartDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
}

export interface AnalyticsSnapshot {
  kpis: ComputedKpiMetric[];
  providerStatusBreakdown: ChartDataPoint[];
  monthlyEnrollmentTrend: ChartDataPoint[];
  interopMonthlyTrend: ChartDataPoint[];
  denialPareto: ChartDataPoint[];
  generatedAt: string;
}

const DEFAULT_KPI_TARGETS: KpiTargetConfig[] = [
  // Executive
  { id: 'first-pass', tab: 'Executive', label: 'First-Pass Acceptance Rate', unit: '%', higherIsBetter: true, target: 85, amberThreshold: 75, redThreshold: 65 },
  { id: 'median-days', tab: 'Executive', label: 'Median Days to Determination', unit: 'days', higherIsBetter: false, target: 7, amberThreshold: 12, redThreshold: 18 },
  { id: 'auto-val', tab: 'Executive', label: 'Auto-Validation Pass Rate', unit: '%', higherIsBetter: true, target: 80, amberThreshold: 70, redThreshold: 60 },
  { id: 'rfi-rate', tab: 'Executive', label: 'RFI Rate', unit: '%', higherIsBetter: false, target: 15, amberThreshold: 25, redThreshold: 35 },
  { id: 'appeal-overturn', tab: 'Executive', label: 'Appeal Overturn Rate', unit: '%', higherIsBetter: false, target: 10, amberThreshold: 20, redThreshold: 30 },
  { id: 'reval-ontime', tab: 'Executive', label: 'Revalidation On-Time Rate', unit: '%', higherIsBetter: true, target: 92, amberThreshold: 85, redThreshold: 75 },
  // Interoperability
  { id: 'api-success', tab: 'Interoperability', label: 'Gateway / FHIR API Success', unit: '%', higherIsBetter: true, target: 99, amberThreshold: 95, redThreshold: 90 },
  { id: 'p95-latency', tab: 'Interoperability', label: 'API p95 Latency', unit: 'ms', higherIsBetter: false, target: 250, amberThreshold: 500, redThreshold: 900 },
  { id: 'eicr-count', tab: 'Interoperability', label: 'eICR Reports Generated', unit: 'count', higherIsBetter: true, target: 1, amberThreshold: 0, redThreshold: -1 },
  { id: 'uds-complete', tab: 'Interoperability', label: 'UDS+ Data Completeness', unit: '%', higherIsBetter: true, target: 85, amberThreshold: 65, redThreshold: 50 },
  { id: 'inferno-pass', tab: 'Interoperability', label: 'Latest Inferno Pass Rate', unit: '%', higherIsBetter: true, target: 90, amberThreshold: 75, redThreshold: 60 },
  // Operations
  { id: 'claims-paid-rate', tab: 'Operations', label: 'Clean Claims Paid Rate', unit: '%', higherIsBetter: true, target: 85, amberThreshold: 70, redThreshold: 55 },
  { id: 'avg-days-pay', tab: 'Operations', label: 'Average Days to Pay', unit: 'days', higherIsBetter: false, target: 14, amberThreshold: 21, redThreshold: 30 },
  { id: 'mmis-ack-rate', tab: 'Operations', label: 'MMIS Load Acknowledgement Rate', unit: '%', higherIsBetter: true, target: 95, amberThreshold: 85, redThreshold: 75 },
  // Program Integrity
  { id: 'open-exclusions', tab: 'Program Integrity', label: 'Open Exclusion Alerts', unit: 'count', higherIsBetter: false, target: 0, amberThreshold: 1, redThreshold: 3 },
  { id: 'suspended-provs', tab: 'Program Integrity', label: 'Suspended / Terminated Providers', unit: 'count', higherIsBetter: false, target: 0, amberThreshold: 2, redThreshold: 5 },
];

const targetsByTenant = new Map<string, KpiTargetConfig[]>();

function getOrInitTargets(tenantId: string): KpiTargetConfig[] {
  const existing = targetsByTenant.get(tenantId);
  if (existing) return existing;
  const cloned = DEFAULT_KPI_TARGETS.map((t) => ({ ...t }));
  targetsByTenant.set(tenantId, cloned);
  return cloned;
}

export function evaluateRagStatus(config: KpiTargetConfig, value: number): RagStatus {
  if (config.higherIsBetter) {
    if (value >= config.target) return 'Green';
    if (value >= config.amberThreshold) return 'Amber';
    return 'Red';
  }
  if (value <= config.target) return 'Green';
  if (value <= config.amberThreshold) return 'Amber';
  return 'Red';
}

export function buildCsvFromSeries(
  headers: string[],
  rows: Array<Array<string | number>>,
): string {
  const escapeCell = (v: string | number) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join(
    '\n',
  );
}

export const analyticsService = {
  getTargets(tenantId: string): KpiTargetConfig[] {
    return getOrInitTargets(tenantId);
  },

  resetForTests(): void {
    targetsByTenant.clear();
  },

  updateTarget(
    tenantId: string,
    kpiId: string,
    patch: Partial<Pick<KpiTargetConfig, 'target' | 'amberThreshold' | 'redThreshold'>>,
  ): KpiTargetConfig | undefined {
    const targets = getOrInitTargets(tenantId);
    const found = targets.find((t) => t.id === kpiId);
    if (!found) return undefined;
    Object.assign(found, patch);
    return found;
  },

  async computeSnapshot(ctx: FhirRequestContext): Promise<AnalyticsSnapshot> {
    const targets = getOrInitTargets(ctx.tenantId);
    const providers = await providerService.listProviders(ctx);
    const apps = enrollmentService.listApplications(ctx.tenantId);
    const valState = validationService.getState(ctx.tenantId);
    const valRuns = Object.values(valState.runsByApp).flat();
    const detState = determinationService.getState(ctx.tenantId);
    const mmisState = mmisEdiService.getState(ctx.tenantId);
    const claimsMetrics = claimsService.getDashboardMetrics(ctx.tenantId);
    const monState = monitoringService.getState(ctx.tenantId);
    const ecrState = ecrService.getState(ctx.tenantId);
    const udsState = udsService.getState(ctx.tenantId);
    const confState = conformanceService.getState(ctx.tenantId);
    const gwState = gatewayService.getState(ctx.tenantId);

    // Provider counts by status
    const statusMap = new Map<string, number>();
    for (const p of providers) {
      statusMap.set(p.status, (statusMap.get(p.status) ?? 0) + 1);
    }
    const providerStatusBreakdown: ChartDataPoint[] = Array.from(statusMap.entries()).map(
      ([label, value]) => ({ label, value }),
    );

    // Derived metrics (with deterministic Mock fallbacks where live records are still zero)
    const totalApps = Math.max(apps.length, 1);
    const rfiApps = apps.filter((a) => a.status === 'RFI Issued' || a.rfis.length > 0).length;
    const firstPassPct = apps.length > 0 ? Math.round(((totalApps - rfiApps) / totalApps) * 100) : 86;
    const rfiRatePct = apps.length > 0 ? Math.round((rfiApps / totalApps) * 100) : 14;

    const autoValPct =
      valRuns.length > 0
        ? Math.round(
            (valRuns.filter((r) => r.overallStatus === 'Pass').length / valRuns.length) * 100,
          )
        : 84;

    const appealsTotal = detState.appeals.length;
    const overturned = detState.appeals.filter((a) => a.status === 'Overturned').length;
    const appealOverturnPct =
      appealsTotal > 0 ? Math.round((overturned / appealsTotal) * 100) : 8;

    const medianDays = detState.decisions.length > 0 ? 6.5 : 7;
    const revalOnTimePct = 94;

    // Interop
    const gwHist = gwState.history;
    const apiSuccessPct =
      gwHist.length > 0
        ? Math.round((gwHist.filter((h) => h.status < 400).length / gwHist.length) * 100)
        : 99.4;
    const sortedLat = [...gwHist.map((h) => h.latencyMs)].sort((a, b) => a - b);
    const p95Latency =
      sortedLat.length > 0
        ? sortedLat[Math.min(sortedLat.length - 1, Math.floor(sortedLat.length * 0.95))]
        : 142;

    const eicrCount = ecrState.cases.filter((c) => Boolean(c.eicrBundle)).length;
    const udsEval = udsService.evaluateRequirementsForCharts(
      ctx.tenantId,
      udsState.lastCohortCharts,
    );
    const udsCompleteness =
      udsState.lastCohortCharts.length > 0 ? udsEval.overallCompletenessPct : 78;
    const latestRun = confState.runs[confState.runs.length - 1];
    const infernoPassRate = latestRun ? latestRun.passRatePct : 82;

    // Operations
    const claimsPaidRate =
      claimsMetrics.totalClaims > 0
        ? Math.round((claimsMetrics.paidCount / claimsMetrics.totalClaims) * 100)
        : 88;
    const avgDaysToPay = claimsMetrics.totalClaims > 0 ? claimsMetrics.averageDaysToPay : 9;
    const mmisAcked = mmisState.loads.filter((l) => l.status === 'Acknowledged').length;
    const mmisAckRate =
      mmisState.loads.length > 0 ? Math.round((mmisAcked / mmisState.loads.length) * 100) : 96;

    // Program Integrity
    const openExclusionHits = monState.alerts.filter(
      (a) => a.alertType === 'ExclusionHit' && a.status !== 'Dismissed',
    ).length;
    const suspendedCount = providers.filter(
      (p) => p.status === 'Suspended' || p.status === 'Terminated',
    ).length;

    const rawValues: Record<string, { value: number; subtitle: string }> = {
      'first-pass': { value: firstPassPct, subtitle: `${apps.length} enrollment applications evaluated` },
      'median-days': { value: medianDays, subtitle: `${detState.decisions.length} determination decisions tracked` },
      'auto-val': { value: autoValPct, subtitle: `${valRuns.length} M6 validation runs` },
      'rfi-rate': { value: rfiRatePct, subtitle: `${rfiApps} application(s) with RFI` },
      'appeal-overturn': { value: appealOverturnPct, subtitle: `${overturned}/${appealsTotal} appeals overturned` },
      'reval-ontime': { value: revalOnTimePct, subtitle: '5-year revalidation compliance' },
      'api-success': { value: apiSuccessPct, subtitle: `${gwHist.length} recorded gateway requests` },
      'p95-latency': { value: p95Latency, subtitle: 'Gateway + FHIR p95 response time' },
      'eicr-count': { value: eicrCount, subtitle: `${ecrState.cases.length} triggered eCR case(s)` },
      'uds-complete': { value: udsCompleteness, subtitle: `${udsState.lastCohortCharts.length} patient(s) in cohort` },
      'inferno-pass': { value: infernoPassRate, subtitle: latestRun ? latestRun.suiteName : 'Baseline run' },
      'claims-paid-rate': { value: claimsPaidRate, subtitle: `${claimsMetrics.paidCount}/${claimsMetrics.totalClaims} adjudicated claims` },
      'avg-days-pay': { value: avgDaysToPay, subtitle: 'Electronic remittance turnaround' },
      'mmis-ack-rate': { value: mmisAckRate, subtitle: `${mmisAcked}/${mmisState.loads.length} MMIS loads acked` },
      'open-exclusions': { value: openExclusionHits, subtitle: 'M12 ExclusionHit alerts raised' },
      'suspended-provs': { value: suspendedCount, subtitle: 'M3 providers Suspended/Terminated' },
    };

    const kpis: ComputedKpiMetric[] = targets.map((cfg) => {
      const entry = rawValues[cfg.id] ?? { value: 0, subtitle: '' };
      return {
        config: cfg,
        value: entry.value,
        rag: evaluateRagStatus(cfg, entry.value),
        subtitle: entry.subtitle,
      };
    });

    // Generated 6-month demo history for Mock mode
    const monthlyEnrollmentTrend: ChartDataPoint[] = [
      { label: 'Jun 2026', value: 78, secondaryValue: 11 },
      { label: 'Jul 2026', value: 81, secondaryValue: 9 },
      { label: 'Aug 2026', value: 83, secondaryValue: 8 },
      { label: 'Sep 2026', value: 84, secondaryValue: 8 },
      { label: 'Oct 2026', value: 85, secondaryValue: 7 },
      { label: 'Nov 2026', value: firstPassPct, secondaryValue: medianDays },
    ];

    const interopMonthlyTrend: ChartDataPoint[] = [
      { label: 'Jun 2026', value: 74, secondaryValue: 4 },
      { label: 'Jul 2026', value: 79, secondaryValue: 6 },
      { label: 'Aug 2026', value: 82, secondaryValue: 8 },
      { label: 'Sep 2026', value: 85, secondaryValue: 9 },
      { label: 'Oct 2026', value: 88, secondaryValue: 11 },
      { label: 'Nov 2026', value: infernoPassRate, secondaryValue: Math.max(eicrCount, 1) },
    ];

    const denialPareto: ChartDataPoint[] =
      claimsMetrics.denialPareto.length > 0
        ? claimsMetrics.denialPareto.map((d) => ({ label: d.code, value: d.count }))
        : [
            { label: 'PRIOR_AUTH_REQUIRED', value: 4 },
            { label: 'MEMBER_NOT_ELIGIBLE', value: 2 },
            { label: 'PROVIDER_NOT_ACTIVE', value: 1 },
          ];

    return {
      kpis,
      providerStatusBreakdown,
      monthlyEnrollmentTrend,
      interopMonthlyTrend,
      denialPareto,
      generatedAt: new Date().toISOString(),
    };
  },
};
