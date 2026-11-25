import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';

export interface VirtualColumn<T> {
  key: string;
  header: string;
  widthClass?: string;
  render: (row: T, index: number) => ReactNode;
}

export interface VirtualTableProps<T> {
  rows: T[];
  columns: VirtualColumn<T>[];
  getRowKey: (row: T, index: number) => string;
  caption?: string;
  rowHeight?: number;
  maxHeight?: number;
  overscan?: number;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
}

export interface VirtualWindowRange {
  startIndex: number;
  endIndex: number;
  topSpacerPx: number;
  bottomSpacerPx: number;
}

/**
 * Pure window calculation helper for virtualized tables.
 */
export function computeVirtualWindow(
  totalRows: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 6,
): VirtualWindowRange {
  if (totalRows <= 0) {
    return { startIndex: 0, endIndex: 0, topSpacerPx: 0, bottomSpacerPx: 0 };
  }
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const firstVisible = Math.floor(scrollTop / rowHeight);
  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(totalRows, firstVisible + visibleCount + overscan);
  return {
    startIndex,
    endIndex,
    topSpacerPx: startIndex * rowHeight,
    bottomSpacerPx: Math.max(0, (totalRows - endIndex) * rowHeight),
  };
}

function VirtualTableInner<T>({
  rows,
  columns,
  getRowKey,
  caption,
  rowHeight = 44,
  maxHeight = 440,
  overscan = 6,
  emptyMessage = 'No records to display.',
  onRowClick,
}: VirtualTableProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const windowRange = useMemo(
    () => computeVirtualWindow(rows.length, scrollTop, maxHeight, rowHeight, overscan),
    [rows.length, scrollTop, maxHeight, rowHeight, overscan],
  );

  const visibleRows = useMemo(
    () => rows.slice(windowRange.startIndex, windowRange.endIndex),
    [rows, windowRange.startIndex, windowRange.endIndex],
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      onScroll={handleScroll}
      style={{ maxHeight }}
      className="overflow-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      tabIndex={0}
      aria-label={caption ?? 'Virtualized data table'}
    >
      <table className="w-full border-collapse text-left text-xs">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-3 py-2.5 ${col.widthClass ?? ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {windowRange.topSpacerPx > 0 && (
            <tr aria-hidden="true">
              <td
                colSpan={columns.length}
                style={{ height: windowRange.topSpacerPx, padding: 0 }}
              />
            </tr>
          )}
          {visibleRows.map((row, offset) => {
            const actualIndex = windowRange.startIndex + offset;
            return (
              <tr
                key={getRowKey(row, actualIndex)}
                style={{ height: rowHeight }}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={
                  onRowClick
                    ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                }
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className="px-3 py-2 text-slate-800 dark:text-slate-200"
                  >
                    {col.render(row, actualIndex)}
                  </td>
                ))}
              </tr>
            );
          })}
          {windowRange.bottomSpacerPx > 0 && (
            <tr aria-hidden="true">
              <td
                colSpan={columns.length}
                style={{ height: windowRange.bottomSpacerPx, padding: 0 }}
              />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export const VirtualTable = memo(VirtualTableInner) as typeof VirtualTableInner;
