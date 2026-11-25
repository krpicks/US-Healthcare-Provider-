import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl py-16">
      <p className="font-mono text-sm font-medium text-brand-700 dark:text-brand-400">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        Page not found
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        The requested route does not match any registered module in the
        ProviderLink FHIR Platform.
      </p>
      <div className="mt-6">
        <Link
          to="/build-status"
          className="inline-flex items-center gap-2 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-800 dark:bg-brand-600 dark:hover:bg-brand-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Return to Build Status</span>
        </Link>
      </div>
    </div>
  );
}
