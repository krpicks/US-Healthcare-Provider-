import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLATFORM_SETTINGS,
  settingsService,
} from '../settingsService';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe('settingsService', () => {
  it('returns default settings with Mock mode enabled when storage is empty', () => {
    const storage = createMemoryStorage();
    const loaded = settingsService.load(storage);
    expect(loaded).toEqual(DEFAULT_PLATFORM_SETTINGS);
    expect(loaded.fhirMode).toBe('mock');
  });

  it('persists non-secret settings to storage and restores them accurately', () => {
    const storage = createMemoryStorage();
    settingsService.save(
      {
        theme: 'dark',
        fhirMode: 'live',
        tenantPartitionStrategy: 'header',
        sidebarCollapsed: true,
      },
      storage,
    );

    const reloaded = settingsService.load(storage);
    expect(reloaded.theme).toBe('dark');
    expect(reloaded.fhirMode).toBe('live');
    expect(reloaded.tenantPartitionStrategy).toBe('header');
    expect(reloaded.sidebarCollapsed).toBe(true);
  });

  it('stores session secrets in memory only and never writes them to storage', () => {
    const storage = createMemoryStorage();
    settingsService.setSessionSecret('fhirBearerToken', 'ephemeral-session-token');
    settingsService.save({ theme: 'dark' }, storage);

    expect(settingsService.getSessionSecret('fhirBearerToken')).toBe(
      'ephemeral-session-token',
    );
    const dumped = storage.getItem('providerlink.settings.v1') ?? '';
    expect(dumped).not.toContain('ephemeral-session-token');

    settingsService.clearSessionSecrets();
    expect(settingsService.getSessionSecret('fhirBearerToken')).toBeUndefined();
  });
});
