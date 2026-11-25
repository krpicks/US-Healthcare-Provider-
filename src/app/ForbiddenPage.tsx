import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { useAuth } from './AuthContext';

interface ForbiddenPageProps {
  moduleName?: string;
  requiredAction?: string;
}

export function ForbiddenPage({
  moduleName,
  requiredAction,
}: ForbiddenPageProps) {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-xl py-16">
      <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
        <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        <span className="font-mono text-sm font-semibold">403 Forbidden</span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        Access restricted for current role
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        Your current demo role (<span className="font-medium text-slate-900 dark:text-slate-200">{user.role}</span>)
        does not have permission to{' '}
        {requiredAction ? `${requiredAction} in ` : 'access '}
        {moduleName ?? 'this resource'}. Switch roles using the header role
        switcher or return to Build Status.
      </p>
      <div className="mt-6 flex items-center gap-3">
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
