import { ShieldAlert } from 'lucide-react';
import { PROTOTYPE_BANNER_TEXT } from '../mock-data';

export function PrototypeBanner() {
  return (
    <div
      role="region"
      aria-label="Prototype environment notice"
      className="flex min-h-8 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1 text-xs font-medium text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-100"
    >
      <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
      <span>{PROTOTYPE_BANNER_TEXT}</span>
    </div>
  );
}
