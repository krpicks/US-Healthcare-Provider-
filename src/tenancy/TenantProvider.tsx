import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getFhirClient, type FhirRequestContext } from '../fhir';
import { seedTenantFhirData } from '../mock-data';
import type { TenantSummary } from './tenantContext';
import { tenantService, type TenantRecord } from './tenantService';

const ACTIVE_TENANT_STORAGE_KEY = 'providerlink.activeTenantId';

export interface FullTenantContextValue {
  activeTenant: TenantRecord;
  availableTenants: TenantRecord[];
  fhirContext: FhirRequestContext;
  setActiveTenantById: (tenantId: string) => void;
  refreshTenants: () => void;
  seedReady: boolean;
}

const TenantReactContext = createContext<FullTenantContextValue | undefined>(
  undefined,
);

function readInitialTenant(tenants: TenantRecord[]): TenantRecord {
  if (typeof window !== 'undefined') {
    try {
      const storedId = window.localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY);
      if (storedId) {
        const match = tenants.find((t) => t.id === storedId);
        if (match) {
          return match;
        }
      }
    } catch {
      // Ignore storage errors
    }
  }
  return tenants[0];
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const [availableTenants, setAvailableTenants] = useState<TenantRecord[]>(() =>
    tenantService.listTenants(),
  );
  const [activeTenantId, setActiveTenantId] = useState<string>(
    () => readInitialTenant(tenantService.listTenants()).id,
  );
  const [seedReady, setSeedReady] = useState(false);

  const refreshTenants = useCallback(() => {
    const next = tenantService.listTenants();
    setAvailableTenants(next);
  }, []);

  useEffect(() => {
    return tenantService.subscribe(() => {
      setAvailableTenants(tenantService.listTenants());
    });
  }, []);

  const activeTenant = useMemo<TenantRecord>(() => {
    return (
      availableTenants.find((t) => t.id === activeTenantId) ??
      availableTenants[0]
    );
  }, [availableTenants, activeTenantId]);

  // Seed default synthetic tenants in Mock mode on startup and whenever active tenant changes
  useEffect(() => {
    let cancelled = false;
    async function ensureSeeded() {
      const client = getFhirClient();
      if (client.mode === 'mock') {
        for (const t of tenantService.listTenants()) {
          await seedTenantFhirData(client, {
            tenantId: t.id,
            tenantCode: t.code,
          });
        }
      }
      if (!cancelled) {
        setSeedReady(true);
      }
    }
    void ensureSeeded();
    return () => {
      cancelled = true;
    };
  }, [activeTenant.id]);

  const setActiveTenantById = useCallback(
    (tenantId: string) => {
      const next = tenantService.getTenantById(tenantId);
      if (!next) return;
      setActiveTenantId(next.id);
      try {
        window.localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, next.id);
      } catch {
        // Ignore storage write errors
      }
    },
    [],
  );

  const fhirContext = useMemo<FhirRequestContext>(
    () => ({
      tenantId: activeTenant.id,
      tenantCode: activeTenant.code,
    }),
    [activeTenant.id, activeTenant.code],
  );

  const value = useMemo<FullTenantContextValue>(
    () => ({
      activeTenant,
      availableTenants,
      fhirContext,
      setActiveTenantById,
      refreshTenants,
      seedReady,
    }),
    [
      activeTenant,
      availableTenants,
      fhirContext,
      setActiveTenantById,
      refreshTenants,
      seedReady,
    ],
  );

  return (
    <TenantReactContext.Provider value={value}>
      {children}
    </TenantReactContext.Provider>
  );
}

export function useTenantContext(): FullTenantContextValue {
  const ctx = useContext(TenantReactContext);
  if (!ctx) {
    throw new Error('useTenantContext must be used inside a TenantProvider.');
  }
  return ctx;
}

export type { TenantSummary };
