import type { ReactNode } from 'react';
import type { PermissionAction } from '../types';
import { usePermission } from './AuthContext';
import { ForbiddenPage } from './ForbiddenPage';

interface GuardProps {
  moduleId: string;
  action: PermissionAction;
  moduleName?: string;
  fallback?: ReactNode;
  showForbiddenPage?: boolean;
  children: ReactNode;
}

export function Guard({
  moduleId,
  action,
  moduleName,
  fallback = null,
  showForbiddenPage = false,
  children,
}: GuardProps) {
  const allowed = usePermission(moduleId, action);
  if (allowed) {
    return <>{children}</>;
  }
  if (showForbiddenPage) {
    return <ForbiddenPage moduleName={moduleName} requiredAction={action} />;
  }
  return <>{fallback}</>;
}
