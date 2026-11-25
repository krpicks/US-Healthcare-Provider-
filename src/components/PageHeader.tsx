import type { ReactNode } from 'react';

interface PageHeaderProps {
  kicker?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between dark:border-slate-800">
      <div className="min-w-0 space-y-1">
        {kicker && (
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {kicker}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {title}
        </h1>
        {description && (
          <p className="max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-3">{actions}</div>
      )}
    </div>
  );
}
