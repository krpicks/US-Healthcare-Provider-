import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react';
import { EmptyState } from '../EmptyState';
import { TableSkeleton } from './OverlayAndFeedback';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchText?: (row: T) => string;
  toolbarExtra?: ReactNode;
  initialPageSize?: number;
  onRowClick?: (row: T) => void;
  selectedRowKey?: string | null;
}

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = 'No records found',
  emptyDescription = 'Adjust your filters or add a new record to populate this table.',
  emptyAction,
  searchable = true,
  searchPlaceholder = 'Search...',
  searchText,
  toolbarExtra,
  initialPageSize = 10,
  onRowClick,
  selectedRowKey,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !searchText) return rows;
    return rows.filter((row) => searchText(row).toLowerCase().includes(q));
  }, [rows, query, searchText]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safePage, pageSize]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  };

  if (loading) {
    return <TableSkeleton rows={5} columns={Math.min(columns.length, 6)} />;
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Unable to load records</p>
            <p className="mt-0.5 text-xs opacity-90">{error}</p>
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-200"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(searchable || toolbarExtra) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {searchable && searchText ? (
            <div className="relative flex-1 max-w-md">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          ) : (
            <div />
          )}
          {toolbarExtra && (
            <div className="flex flex-wrap items-center gap-2">{toolbarExtra}</div>
          )}
        </div>
      )}

      {pageRows.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={
                        sortKey === col.key
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                      className={`px-4 py-3 ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      } ${col.className ?? ''}`}
                    >
                      {col.sortable && col.sortValue ? (
                        <button
                          type="button"
                          onClick={() => handleSort(col.key)}
                          className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100"
                        >
                          <span>{col.header}</span>
                          {sortKey !== col.key ? (
                            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          ) : sortDir === 'asc' ? (
                            <ArrowUp className="h-3.5 w-3.5 text-brand-700 dark:text-brand-400" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-brand-700 dark:text-brand-400" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {pageRows.map((row) => {
                  const key = getRowKey(row);
                  const isSelected = selectedRowKey === key;
                  return (
                    <tr
                      key={key}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={`transition-colors ${
                        onRowClick ? 'cursor-pointer' : ''
                      } ${
                        isSelected
                          ? 'bg-brand-50/70 dark:bg-brand-900/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-4 py-2.5 ${
                            col.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                          } ${col.className ?? ''}`}
                        >
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-center justify-between gap-2 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-600 sm:flex-row dark:border-slate-800 dark:text-slate-400">
            <div className="flex items-center gap-3">
              <span className="tabular-nums">
                Showing {(safePage - 1) * pageSize + 1}–
                {Math.min(safePage * pageSize, sorted.length)} of {sorted.length}
              </span>
              <select
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="h-8 rounded border border-slate-300 bg-white px-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
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
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
