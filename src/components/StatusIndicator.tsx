import { CheckCircle2, Clock, CircleDashed, XCircle } from 'lucide-react';
import type { ModuleBuildStatus, TestSuiteStatus } from '../types';

export function ModuleStatusIndicator({ status }: { status: ModuleBuildStatus }) {
  if (status === 'Completed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Completed</span>
      </span>
    );
  }
  if (status === 'In Progress') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>In Progress</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
      <CircleDashed className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>Planned</span>
    </span>
  );
}

export function TestStatusIndicator({
  status,
  passed,
  total,
}: {
  status: TestSuiteStatus;
  passed: number;
  total: number;
}) {
  if (status === 'Passing') {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {passed}/{total} passing
        </span>
      </span>
    );
  }
  if (status === 'Failing') {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-red-700 dark:text-red-400">
        <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {passed}/{total} failing
        </span>
      </span>
    );
  }
  return (
    <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
      Not run
    </span>
  );
}
