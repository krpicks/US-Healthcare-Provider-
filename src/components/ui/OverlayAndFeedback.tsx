import { useEffect, type ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Info,
  X,
  XCircle,
} from 'lucide-react';

export type SemanticTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONE_CLASSES: Record<SemanticTone, string> = {
  neutral: 'text-slate-600 dark:text-slate-400',
  success: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  danger: 'text-red-700 dark:text-red-400',
  info: 'text-brand-700 dark:text-brand-400',
};

export function SemanticStatus({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: SemanticTone;
}) {
  const Icon =
    tone === 'success'
      ? CheckCircle2
      : tone === 'warning'
        ? Clock
        : tone === 'danger'
          ? XCircle
          : tone === 'info'
            ? Info
            : AlertCircle;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${TONE_CLASSES[tone]}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  activeTab,
  onChange,
  ariaLabel = 'Section tabs',
}: {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-800"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`relative -mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              isActive
                ? 'border-brand-700 text-brand-800 dark:border-brand-400 dark:text-brand-300'
                : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className="ml-1.5 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                ({tab.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface StepItem {
  id: string;
  label: string;
  completed?: boolean;
}

export function Stepper({
  steps,
  currentStepIndex,
  onStepClick,
}: {
  steps: StepItem[];
  currentStepIndex: number;
  onStepClick?: (index: number) => void;
}) {
  return (
    <ol
      aria-label="Progress steps"
      className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-4 dark:border-slate-800"
    >
      {steps.map((step, idx) => {
        const isCurrent = idx === currentStepIndex;
        const isDone = step.completed || idx < currentStepIndex;
        return (
          <li key={step.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onStepClick?.(idx)}
              disabled={!onStepClick}
              aria-current={isCurrent ? 'step' : undefined}
              className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                isCurrent
                  ? 'bg-brand-700 text-white dark:bg-brand-600'
                  : isDone
                    ? 'bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <span className="font-mono tabular-nums">{idx + 1}.</span>
              <span>{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export interface TimelineEntry {
  id: string;
  timestamp: string;
  title: string;
  subtitle?: string;
  detail?: string;
  tone?: SemanticTone;
}

export function Timeline({ items }: { items: TimelineEntry[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No timeline events recorded yet.
      </p>
    );
  }
  return (
    <ol className="space-y-4">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-col gap-1 border-b border-slate-200 pb-4 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between dark:border-slate-800"
        >
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {item.title}
            </p>
            {item.subtitle && (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {item.subtitle}
              </p>
            )}
            {item.detail && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {item.detail}
              </p>
            )}
          </div>
          <time className="shrink-0 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {item.timestamp.replace('T', ' ').slice(0, 19)}
          </time>
        </li>
      ))}
    </ol>
  );
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  maxWidthClass = 'max-w-xl',
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClass?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="fixed inset-0 bg-slate-950/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative z-10 flex max-h-[90vh] w-full flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${maxWidthClass}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2
              id="modal-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-3.5 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <div
        className="fixed inset-0 bg-slate-950/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2
              id="drawer-title"
              className="truncate text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-slate-200 dark:bg-slate-800 ${className}`}
    />
  );
}

export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading table data"
      className="overflow-hidden rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, rIdx) => (
          <div
            key={rIdx}
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((__, cIdx) => (
              <Skeleton key={cIdx} className="h-5 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
