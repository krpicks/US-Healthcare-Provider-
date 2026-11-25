import type { FhirMode, ThemeMode } from '../types';
import type { TenantPartitionStrategy } from '../tenancy';

export interface PlatformSettings {
  theme: ThemeMode;
  fhirMode: FhirMode;
  fhirBaseUrl: string;
  tenantPartitionStrategy: TenantPartitionStrategy;
  gatewayBaseUrl: string;
  ecrNowBaseUrl: string;
  infernoBaseUrl: string;
  sidebarCollapsed: boolean;
}

const STORAGE_KEY = 'providerlink.settings.v1';

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  theme: 'light',
  fhirMode: 'mock',
  fhirBaseUrl: 'http://localhost:8081/fhir',
  tenantPartitionStrategy: 'path',
  gatewayBaseUrl: 'http://localhost:5000',
  ecrNowBaseUrl: 'http://localhost:8080',
  infernoBaseUrl: 'http://localhost:4567',
  sidebarCollapsed: false,
};

// Session-only in-memory secret store. Never persisted to localStorage or source.
const sessionSecrets = new Map<string, string>();
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

export const settingsService = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  load(storage?: Pick<Storage, 'getItem'>): PlatformSettings {
    const target =
      storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!target) {
      return { ...DEFAULT_PLATFORM_SETTINGS };
    }

    try {
      const raw = target.getItem(STORAGE_KEY);
      if (!raw) {
        return { ...DEFAULT_PLATFORM_SETTINGS };
      }
      const parsed = JSON.parse(raw) as Partial<PlatformSettings>;
      return {
        theme: parsed.theme === 'dark' ? 'dark' : 'light',
        fhirMode: parsed.fhirMode === 'live' ? 'live' : 'mock',
        fhirBaseUrl:
          typeof parsed.fhirBaseUrl === 'string' && parsed.fhirBaseUrl.trim()
            ? parsed.fhirBaseUrl.trim()
            : DEFAULT_PLATFORM_SETTINGS.fhirBaseUrl,
        tenantPartitionStrategy:
          parsed.tenantPartitionStrategy === 'header' ? 'header' : 'path',
        gatewayBaseUrl:
          typeof parsed.gatewayBaseUrl === 'string'
            ? parsed.gatewayBaseUrl.trim()
            : DEFAULT_PLATFORM_SETTINGS.gatewayBaseUrl,
        ecrNowBaseUrl:
          typeof parsed.ecrNowBaseUrl === 'string'
            ? parsed.ecrNowBaseUrl.trim()
            : DEFAULT_PLATFORM_SETTINGS.ecrNowBaseUrl,
        infernoBaseUrl:
          typeof parsed.infernoBaseUrl === 'string'
            ? parsed.infernoBaseUrl.trim()
            : DEFAULT_PLATFORM_SETTINGS.infernoBaseUrl,
        sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      };
    } catch {
      return { ...DEFAULT_PLATFORM_SETTINGS };
    }
  },

  save(
    patch: Partial<PlatformSettings>,
    storage?: Pick<Storage, 'getItem' | 'setItem'>,
  ): PlatformSettings {
    const current = this.load(storage);
    const next: PlatformSettings = { ...current, ...patch };
    const target =
      storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (target) {
      try {
        target.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore quota/privacy storage errors
      }
    }
    notifyListeners();
    return next;
  },

  reset(storage?: Pick<Storage, 'removeItem'>): PlatformSettings {
    const target =
      storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (target) {
      try {
        target.removeItem(STORAGE_KEY);
      } catch {
        // Ignore storage errors
      }
    }
    sessionSecrets.clear();
    notifyListeners();
    return { ...DEFAULT_PLATFORM_SETTINGS };
  },

  setSessionSecret(key: string, value: string): void {
    if (!value) {
      sessionSecrets.delete(key);
      return;
    }
    sessionSecrets.set(key, value);
  },

  getSessionSecret(key: string): string | undefined {
    return sessionSecrets.get(key);
  },

  clearSessionSecrets(): void {
    sessionSecrets.clear();
  },
};
