import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PermissionAction, RoleName } from '../types';
import { useTenantContext } from '../tenancy';
import { ALL_ROLES, canRoleUnmask, hasPermission } from './rbac';

const ROLE_STORAGE_KEY = 'providerlink.demoRole';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: RoleName;
}

interface AuthContextValue {
  user: AuthUser;
  setRole: (role: RoleName) => void;
  can: (moduleId: string, action: PermissionAction) => boolean;
  canUnmask: boolean;
}

const DEMO_USERS: Record<RoleName, Omit<AuthUser, 'role'>> = {
  PlatformAdmin: { id: 'usr-platform', name: 'Alex Morgan', email: 'alex.morgan@platform.synthetic' },
  TenantAdmin: { id: 'usr-tenant', name: 'Jordan Patel', email: 'jordan.patel@agency.synthetic' },
  ProviderUser: { id: 'usr-provider', name: 'Dr. Elena Vargas', email: 'elena.vargas@synthetic.example' },
  EnrollmentAnalyst: { id: 'usr-enroll', name: 'Taylor Brooks', email: 'taylor.brooks@agency.synthetic' },
  ScreeningAnalyst: { id: 'usr-screen', name: 'Casey Nguyen', email: 'casey.nguyen@agency.synthetic' },
  CredentialingSpecialist: { id: 'usr-cred', name: 'Devon Reed', email: 'devon.reed@agency.synthetic' },
  ProgramIntegrityOfficer: { id: 'usr-pi', name: 'Morgan Rivera', email: 'morgan.rivera@agency.synthetic' },
  AgencyApprover: { id: 'usr-approver', name: 'Robin Hayes', email: 'robin.hayes@agency.synthetic' },
  PlanManager: { id: 'usr-plan', name: 'Jamie Foster', email: 'jamie.foster@plan.synthetic' },
  IntegrationEngineer: { id: 'usr-eng', name: 'Samira Ali', email: 'samira.ali@interop.synthetic' },
  Auditor: { id: 'usr-audit', name: 'Quinn Bennett', email: 'quinn.bennett@audit.synthetic' },
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readInitialRole(): RoleName {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(ROLE_STORAGE_KEY) as RoleName | null;
      if (saved && ALL_ROLES.includes(saved)) {
        return saved;
      }
    } catch {
      // Ignore storage read errors
    }
  }
  return 'PlatformAdmin';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<RoleName>(readInitialRole);
  const { activeTenant } = useTenantContext();

  const setRole = useCallback((nextRole: RoleName) => {
    setRoleState(nextRole);
    try {
      window.localStorage.setItem(ROLE_STORAGE_KEY, nextRole);
    } catch {
      // Ignore storage write errors
    }
  }, []);

  const user = useMemo<AuthUser>(
    () => ({
      ...DEMO_USERS[role],
      role,
    }),
    [role],
  );

  const can = useCallback(
    (moduleId: string, action: PermissionAction) =>
      hasPermission(role, moduleId, action, activeTenant.roleOverrides),
    [role, activeTenant.roleOverrides],
  );

  const canUnmask = useMemo(() => canRoleUnmask(role), [role]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, setRole, can, canUnmask }),
    [user, setRole, can, canUnmask],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return ctx;
}

export function usePermission(
  moduleId: string,
  action: PermissionAction,
): boolean {
  const { can } = useAuth();
  return can(moduleId, action);
}
