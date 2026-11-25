import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export interface OfflineBannerProps {
  /** Optional override for automated tests or Diagnostics simulation */
  forcedOffline?: boolean;
}

export function OfflineBanner({ forcedOffline }: OfflineBannerProps) {
  const [browserOffline, setBrowserOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => setBrowserOffline(false);
    const handleOffline = () => setBrowserOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isOffline = forcedOffline ?? browserOffline;
  if (!isOffline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-xs font-medium text-amber-950 dark:border-amber-800 dark:bg-amber-950/90 dark:text-amber-100"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Offline detected — Live FHIR &amp; Gateway calls are paused, while Mock
        mode remains fully operational locally.
      </span>
    </div>
  );
}
