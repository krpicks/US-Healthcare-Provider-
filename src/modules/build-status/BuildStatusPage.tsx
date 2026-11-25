import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import {
  BUILD_PHASES,
  MODULE_GROUPS,
  getAllRegistryEntries,
} from '../../app/moduleRegistry';
import {
  EmptyState,
  ModuleStatusIndicator,
  PageHeader,
  TestStatusIndicator,
} from '../../components';
import type {
  BuildPhase,
  ModuleBuildStatus,
  ModuleDefinition,
  ModuleGroup,
  SortConfig,
} from '../../types';
import { settingsService } from '../../services';
import { useTenantContext } from '../../tenancy';

type SortField = 'code' | 'name' | 'group' | 'phase' | 'status' | 'tests';

const STATUS_ORDER: Record<ModuleBuildStatus, number> = {
  Completed: 0,
  'In Progress': 1,
  Planned: 2,
};

function parseCodeNumber(code: string): number {
  if (code === 'P0') return 0;
  const parsed = Number.parseInt(code.replace(/^M/i, ''), 10);
  return Number.isNaN(parsed) ? 999 : parsed;
}

export function BuildStatusPage() {
  const allEntries = useMemo(() => getAllRegistryEntries(), []);
  const { activeTenant } = useTenantContext();
  const settings = settingsService.load();

  const [searchQuery, setSearchQuery] = useState('');
  const [phaseFilter, setPhaseFilter] = useState<BuildPhase | 'all'>('all');
  const [groupFilter, setGroupFilter] = useState<ModuleGroup | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ModuleBuildStatus | 'all'>(
    'all',
  );
  const [sort, setSort] = useState<SortConfig<SortField>>({
    field: 'phase',
    direction: 'asc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(
    'p0-foundation',
  );

  const summaryStats = useMemo(() => {
    const completed = allEntries.filter((m) => m.status === 'Completed').length;
    const queued = allEntries.filter((m) => m.status !== 'Completed').length;
    const highestCompletedPhase = allEntries
      .filter((m) => m.status === 'Completed')
      .reduce((max, m) => Math.max(max, m.phase), 0);
    const totalTestsPassed = allEntries.reduce(
      (sum, m) => sum + m.tests.passed,
      0,
    );
    const totalTestsCount = allEntries.reduce(
      (sum, m) => sum + m.tests.total,
      0,
    );
    const suitesPassing = allEntries.filter(
      (m) => m.tests.status === 'Passing',
    ).length;
    return {
      completed,
      queued,
      highestCompletedPhase,
      totalEntries: allEntries.length,
      totalModules: allEntries.length - 1,
      totalTestsPassed,
      totalTestsCount,
      suitesPassing,
    };
  }, [allEntries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allEntries.filter((entry) => {
      if (phaseFilter !== 'all' && entry.phase !== phaseFilter) {
        return false;
      }
      if (groupFilter !== 'all' && entry.group !== groupFilter) {
        return false;
      }
      if (statusFilter !== 'all' && entry.status !== statusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      const searchable = [
        entry.code,
        entry.name,
        entry.group,
        entry.layer,
        entry.description,
        ...entry.fhirResources,
        ...entry.eventsPublished,
      ]
        .join(' ')
        .toLowerCase();
      return searchable.includes(q);
    });
  }, [allEntries, searchQuery, phaseFilter, groupFilter, statusFilter]);

  const sortedEntries = useMemo(() => {
    const copy = [...filteredEntries];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sort.field) {
        case 'code':
          cmp = parseCodeNumber(a.code) - parseCodeNumber(b.code);
          break;
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'group':
          cmp = a.group.localeCompare(b.group);
          break;
        case 'phase':
          cmp =
            a.phase - b.phase ||
            parseCodeNumber(a.code) - parseCodeNumber(b.code);
          break;
        case 'status':
          cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          break;
        case 'tests':
          cmp = a.tests.passed - b.tests.passed;
          break;
      }
      return sort.direction === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredEntries, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedEntries.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedEntries = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedEntries.slice(start, start + pageSize);
  }, [sortedEntries, safePage, pageSize]);

  const selectedModule: ModuleDefinition | undefined = useMemo(
    () => allEntries.find((m) => m.id === selectedModuleId),
    [allEntries, selectedModuleId],
  );

  const handleSort = (field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: 'asc' },
    );
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setPhaseFilter('all');
    setGroupFilter('all');
    setStatusFilter('all');
    setPage(1);
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    phaseFilter !== 'all' ||
    groupFilter !== 'all' ||
    statusFilter !== 'all';

  const renderSortIcon = (field: SortField) => {
    if (sort.field !== field) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />;
    }
    return sort.direction === 'asc' ? (
      <ArrowUp className="h-3.5 w-3.5 text-brand-700 dark:text-brand-400" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-brand-700 dark:text-brand-400" aria-hidden="true" />
    );
  };

  const getAriaSort = (
    field: SortField,
  ): 'ascending' | 'descending' | 'none' => {
    if (sort.field !== field) return 'none';
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  };

  return (
    <div className="space-y-8">
      <PageHeader
        kicker={`ProviderLink FHIR Platform · ${activeTenant.legalName}`}
        title="Build Status"
        description="Track phased delivery across all 24 modules, review automated test coverage, and inspect planned FHIR R4 resources and domain events."
      />

      {/* 4-column summary strip (single-elevation hairline container) */}
      <section aria-label="Platform build metrics">
        <dl className="grid grid-cols-1 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          <div className="p-5">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Current phase gate
            </dt>
            <dd className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              Phase {summaryStats.highestCompletedPhase}
            </dd>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {BUILD_PHASES[summaryStats.highestCompletedPhase]?.title.replace(/^Phase \d+:\s*/, '') ?? 'Foundation'} complete
            </p>
          </div>
          <div className="p-5">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Deliverables completed
            </dt>
            <dd className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {summaryStats.completed} / {summaryStats.totalEntries}
            </dd>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {summaryStats.completed - 1} of {summaryStats.totalModules} modules live · {summaryStats.queued} queued
            </p>
          </div>
          <div className="p-5">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Automated unit tests
            </dt>
            <dd className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {summaryStats.totalTestsPassed} / {summaryStats.totalTestsCount}
            </dd>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {summaryStats.suitesPassing} module suites passing
            </p>
          </div>
          <div className="p-5">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
              FHIR data adapter
            </dt>
            <dd className="mt-1.5 font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {settings.fhirMode === 'mock' ? 'Mock' : 'Live'}
            </dd>
            <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
              Tenant partition: {settings.tenantPartitionStrategy}
            </p>
          </div>
        </dl>
      </section>

      {/* Interactive phase selector */}
      <section aria-label="Filter by build phase" className="space-y-3">
        <div
          role="group"
          aria-label="Build phase filter"
          className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900"
        >
          <button
            type="button"
            onClick={() => {
              setPhaseFilter('all');
              setPage(1);
            }}
            aria-pressed={phaseFilter === 'all'}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              phaseFilter === 'all'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            All Phases
          </button>
          {BUILD_PHASES.map((item) => (
            <button
              key={item.phase}
              type="button"
              onClick={() => {
                setPhaseFilter(item.phase);
                setPage(1);
              }}
              aria-pressed={phaseFilter === item.phase}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                phaseFilter === item.phase
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Phase {item.phase}
            </button>
          ))}
        </div>

        {phaseFilter !== 'all' && (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-slate-200">
              {BUILD_PHASES[phaseFilter].title}:
            </span>{' '}
            {BUILD_PHASES[phaseFilter].summary}
          </p>
        )}
      </section>

      {/* Main table + detail inspector */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div
          className={`space-y-4 ${
            selectedModule ? 'xl:col-span-8' : 'xl:col-span-12'
          }`}
        >
          {/* Search & filter controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <label htmlFor="module-search" className="sr-only">
                Search modules by code, name, resource, or event
              </label>
              <input
                id="module-search"
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search modules, FHIR resources, or events..."
                className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="group-filter" className="sr-only">
                Filter by module group
              </label>
              <select
                id="group-filter"
                value={groupFilter}
                onChange={(e) => {
                  setGroupFilter(e.target.value as ModuleGroup | 'all');
                  setPage(1);
                }}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="all">All groups</option>
                {MODULE_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>

              <label htmlFor="status-filter" className="sr-only">
                Filter by build status
              </label>
              <select
                id="status-filter"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as ModuleBuildStatus | 'all');
                  setPage(1);
                }}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="all">All statuses</option>
                <option value="Completed">Completed</option>
                <option value="In Progress">In Progress</option>
                <option value="Planned">Planned</option>
              </select>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Reset</span>
                </button>
              )}
            </div>
          </div>

          {/* Data table or empty state */}
          {pagedEntries.length === 0 ? (
            <EmptyState
              title="No matching modules"
              description="No modules match the current search and filter criteria. Reset filters to view all 24 platform modules."
              action={
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-800 dark:bg-brand-600 dark:hover:bg-brand-500"
                >
                  Reset filters
                </button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                      <th scope="col" aria-sort={getAriaSort('code')} className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleSort('code')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100"
                        >
                          <span>Code</span>
                          {renderSortIcon('code')}
                        </button>
                      </th>
                      <th scope="col" aria-sort={getAriaSort('name')} className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleSort('name')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100"
                        >
                          <span>Module</span>
                          {renderSortIcon('name')}
                        </button>
                      </th>
                      <th scope="col" aria-sort={getAriaSort('group')} className="hidden px-4 py-3 sm:table-cell">
                        <button
                          type="button"
                          onClick={() => handleSort('group')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100"
                        >
                          <span>Group</span>
                          {renderSortIcon('group')}
                        </button>
                      </th>
                      <th scope="col" aria-sort={getAriaSort('phase')} className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleSort('phase')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100"
                        >
                          <span>Phase</span>
                          {renderSortIcon('phase')}
                        </button>
                      </th>
                      <th scope="col" aria-sort={getAriaSort('status')} className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleSort('status')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100"
                        >
                          <span>Status</span>
                          {renderSortIcon('status')}
                        </button>
                      </th>
                      <th scope="col" aria-sort={getAriaSort('tests')} className="hidden px-4 py-3 text-right md:table-cell">
                        <button
                          type="button"
                          onClick={() => handleSort('tests')}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100"
                        >
                          <span>Tests</span>
                          {renderSortIcon('tests')}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {pagedEntries.map((entry) => {
                      const isSelected = entry.id === selectedModuleId;
                      return (
                        <tr
                          key={entry.id}
                          onClick={() => setSelectedModuleId(entry.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-brand-50/70 dark:bg-brand-900/20'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium tabular-nums text-slate-700 dark:text-slate-300">
                            {entry.code}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedModuleId(entry.id);
                              }}
                              className="text-left font-medium text-slate-900 hover:text-brand-700 dark:text-slate-100 dark:hover:text-brand-300"
                            >
                              {entry.name}
                            </button>
                          </td>
                          <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-slate-600 sm:table-cell dark:text-slate-400">
                            {entry.group}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300">
                            Phase {entry.phase}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <ModuleStatusIndicator status={entry.status} />
                          </td>
                          <td className="hidden whitespace-nowrap px-4 py-3 text-right md:table-cell">
                            <TestStatusIndicator
                              status={entry.tests.status}
                              passed={entry.tests.passed}
                              total={entry.tests.total}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination bar */}
              <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 sm:flex-row dark:border-slate-800 dark:text-slate-400">
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">
                    Showing {(safePage - 1) * pageSize + 1}–
                    {Math.min(safePage * pageSize, sortedEntries.length)} of{' '}
                    {sortedEntries.length}
                  </span>
                  <label htmlFor="page-size-select" className="sr-only">
                    Rows per page
                  </label>
                  <select
                    id="page-size-select"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="h-8 rounded border border-slate-300 bg-white px-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <option value={10}>10 / page</option>
                    <option value={25}>25 / page</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="tabular-nums">
                    Page {safePage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                    className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Next page"
                    className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Module detail inspector */}
        {selectedModule && (
          <aside
            aria-label="Selected module details"
            className="xl:col-span-4"
          >
            <div className="sticky top-20 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    {selectedModule.code} · Phase {selectedModule.phase} ·{' '}
                    {selectedModule.group}
                  </p>
                  <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                    {selectedModule.name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedModuleId(null)}
                  aria-label="Close module details"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {selectedModule.description}
              </p>

              <dl className="mt-5 space-y-3 border-t border-slate-200 pt-4 text-xs dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">Status</dt>
                  <dd>
                    <ModuleStatusIndicator status={selectedModule.status} />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">
                    Test suite
                  </dt>
                  <dd>
                    <TestStatusIndicator
                      status={selectedModule.tests.status}
                      passed={selectedModule.tests.passed}
                      total={selectedModule.tests.total}
                    />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">Layer</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">
                    {selectedModule.layer}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">Route</dt>
                  <dd className="font-mono text-slate-800 dark:text-slate-200">
                    {selectedModule.route}
                  </dd>
                </div>
                <div className="space-y-1 pt-1">
                  <dt className="text-slate-500 dark:text-slate-400">
                    Dependencies
                  </dt>
                  <dd className="font-mono text-slate-800 dark:text-slate-200">
                    {selectedModule.dependencies.length > 0
                      ? selectedModule.dependencies.join(', ')
                      : 'None'}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-slate-500 dark:text-slate-400">
                    FHIR R4 resources
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {selectedModule.fhirResources.length > 0
                      ? selectedModule.fhirResources.join(', ')
                      : 'None'}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-slate-500 dark:text-slate-400">
                    Events published
                  </dt>
                  <dd className="font-mono text-slate-800 dark:text-slate-200">
                    {selectedModule.eventsPublished.length > 0
                      ? selectedModule.eventsPublished.join(', ')
                      : 'None'}
                  </dd>
                </div>
              </dl>

              {selectedModule.route !== '/build-status' && (
                <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <Link
                    to={selectedModule.route}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-800 dark:bg-brand-600 dark:hover:bg-brand-500"
                  >
                    <span>Open {selectedModule.code} route</span>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
