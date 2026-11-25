import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, Table } from 'lucide-react';
import { Guard } from '../../app';
import {
  Button,
  PageHeader,
  SemanticStatus,
  Tabs,
  useToast,
  type SemanticTone,
} from '../../components';
import { useTenantContext } from '../../tenancy';
import {
  analyticsService,
  buildCsvFromSeries,
  type AnalyticsSnapshot,
  type ChartDataPoint,
  type RagStatus,
} from './analyticsService';

function ragTone(rag: RagStatus): SemanticTone {
  if (rag === 'Green') return 'success';
  if (rag === 'Amber') return 'warning';
  return 'danger';
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface AccessibleBarChartProps {
  title: string;
  description: string;
  data: ChartDataPoint[];
  valueLabel: string;
  csvFileName: string;
  unitSuffix?: string;
}

function AccessibleBarChart({
  title,
  description,
  data,
  valueLabel,
  csvFileName,
  unitSuffix = '',
}: AccessibleBarChartProps) {
  const [tableView, setTableView] = useState(false);
  const maxVal = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setTableView((v) => !v)}>
            <Table className="h-3.5 w-3.5" aria-hidden="true" />
            {tableView ? 'Chart View' : 'Table View'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const csv = buildCsvFromSeries(
                ['Label', valueLabel],
                data.map((d) => [d.label, d.value]),
              );
              downloadCsv(csvFileName, csv);
            }}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            CSV
          </Button>
        </div>
      </div>

      {!tableView ? (
        <div className="mt-4 space-y-2.5" role="img" aria-label={`${title}: ${description}`}>
          {data.map((d) => (
            <div key={d.label} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">{d.label}</span>
                <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  {d.value}
                  {unitSuffix}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full bg-blue-600 dark:bg-blue-500"
                  style={{ width: `${Math.min(100, Math.round((d.value / maxVal) * 100))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 uppercase text-slate-500 dark:border-slate-800">
              <tr>
                <th className="px-2 py-2">Category</th>
                <th className="px-2 py-2">{valueLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.map((d) => (
                <tr key={d.label}>
                  <td className="px-2 py-2 font-medium">{d.label}</td>
                  <td className="px-2 py-2 font-mono tabular-nums">
                    {d.value}
                    {unitSuffix}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AnalyticsPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { showToast } = useToast();
  const [tab, setTab] = useState<'Executive' | 'Interoperability' | 'Operations' | 'Program Integrity' | 'Targets'>('Executive');
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    const snap = await analyticsService.computeSnapshot(fhirContext);
    setSnapshot(snap);
  }, [fhirContext]);

  useEffect(() => {
    void refresh();
  }, [refresh, tick]);

  const targets = analyticsService.getTargets(activeTenant.id);
  const tabKpis = snapshot
    ? snapshot.kpis.filter((k) => k.config.tab === tab)
    : [];

  return (
    <Guard moduleId="m19-analytics" action="view">
      <div className="space-y-6" data-tick={tick}>
        <PageHeader
          kicker="M19 · Analytics & KPIs"
          title="Analytics & Executive KPI Dashboard"
          description="Live cross-module KPIs across Executive, Interoperability, Operations, and Program Integrity with editable RAG thresholds, accessible chart/table toggles, and CSV export."
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                void refresh();
                showToast('Analytics snapshot refreshed from live modules.', 'info');
              }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh KPIs
            </Button>
          }
        />

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'Executive', label: 'Executive' },
            { id: 'Interoperability', label: 'Interoperability' },
            { id: 'Operations', label: 'Operations' },
            { id: 'Program Integrity', label: 'Program Integrity' },
            { id: 'Targets', label: 'Editable KPI Targets (RAG)' },
          ]}
        />

        {tab !== 'Targets' && snapshot && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tabKpis.map((metric) => (
                <div
                  key={metric.config.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {metric.config.label}
                    </span>
                    <SemanticStatus tone={ragTone(metric.rag)} label={metric.rag} />
                  </div>
                  <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {metric.value}
                    {metric.config.unit === '%'
                      ? '%'
                      : metric.config.unit === 'days'
                        ? ' d'
                        : metric.config.unit === 'ms'
                          ? ' ms'
                          : ''}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Target {metric.config.higherIsBetter ? '≥' : '≤'} {metric.config.target}
                    {metric.config.unit === 'count' ? '' : metric.config.unit} · {metric.subtitle}
                  </div>
                </div>
              ))}
            </div>

            {tab === 'Executive' && (
              <div className="grid gap-6 lg:grid-cols-2">
                <AccessibleBarChart
                  title="Providers by Enrollment Status (M3)"
                  description="Distribution of providers across Active, Pending, Suspended, and Terminated statuses."
                  data={snapshot.providerStatusBreakdown}
                  valueLabel="Providers"
                  csvFileName={`providers-by-status-${activeTenant.code}.csv`}
                />
                <AccessibleBarChart
                  title="First-Pass Acceptance Trend (6-Month Mock History)"
                  description="Monthly percentage of enrollment applications accepted without an RFI."
                  data={snapshot.monthlyEnrollmentTrend}
                  valueLabel="First-Pass %"
                  unitSuffix="%"
                  csvFileName={`enrollment-trend-${activeTenant.code}.csv`}
                />
              </div>
            )}

            {tab === 'Interoperability' && (
              <AccessibleBarChart
                title="Inferno Conformance Pass Rate Trend (M15)"
                description="Monthly pass-rate progression across FHIR US Core and IG test suites."
                data={snapshot.interopMonthlyTrend}
                valueLabel="Pass Rate %"
                unitSuffix="%"
                csvFileName={`interop-trend-${activeTenant.code}.csv`}
              />
            )}

            {(tab === 'Operations' || tab === 'Program Integrity') && (
              <AccessibleBarChart
                title="Claims Denial Reason Pareto (M11)"
                description="Top claim adjudication denial reason codes by volume."
                data={snapshot.denialPareto}
                valueLabel="Denied Claims"
                csvFileName={`denial-pareto-${activeTenant.code}.csv`}
              />
            )}
          </div>
        )}

        {tab === 'Targets' && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-3">Tab / KPI</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3">Green Target</th>
                  <th className="px-4 py-3">Amber Threshold</th>
                  <th className="px-4 py-3">Red Threshold</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {targets.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{t.label}</div>
                      <div className="text-xs text-slate-500">{t.tab} ({t.unit})</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {t.higherIsBetter ? 'Higher is better' : 'Lower is better'}
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number"
                        aria-label={`${t.label} green target`}
                        className="w-24 rounded border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
                        value={t.target}
                        onChange={(e) => {
                          analyticsService.updateTarget(activeTenant.id, t.id, {
                            target: Number(e.target.value),
                          });
                          setTick((v) => v + 1);
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number"
                        aria-label={`${t.label} amber threshold`}
                        className="w-24 rounded border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
                        value={t.amberThreshold}
                        onChange={(e) => {
                          analyticsService.updateTarget(activeTenant.id, t.id, {
                            amberThreshold: Number(e.target.value),
                          });
                          setTick((v) => v + 1);
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number"
                        aria-label={`${t.label} red threshold`}
                        className="w-24 rounded border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
                        value={t.redThreshold}
                        onChange={(e) => {
                          analyticsService.updateTarget(activeTenant.id, t.id, {
                            redThreshold: Number(e.target.value),
                          });
                          setTick((v) => v + 1);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Guard>
  );
}
