import { describe, expect, it } from 'vitest';
import {
  BUILD_PHASES,
  MODULE_REGISTRY,
  getAllRegistryEntries,
  getModuleByRoute,
} from '../moduleRegistry';
import { resolveTenantBaseUrl } from '../../tenancy';

describe('moduleRegistry & tenancy foundation', () => {
  it('registers all 24 domain modules (M1 through M24) with unique ids and routes', () => {
    expect(MODULE_REGISTRY).toHaveLength(24);
    const ids = new Set(MODULE_REGISTRY.map((m) => m.id));
    const codes = new Set(MODULE_REGISTRY.map((m) => m.code));
    const routes = new Set(MODULE_REGISTRY.map((m) => m.route));

    expect(ids.size).toBe(24);
    expect(codes.size).toBe(24);
    expect(routes.size).toBe(24);

    for (let i = 1; i <= 24; i += 1) {
      expect(codes.has(`M${i}`)).toBe(true);
    }
  });

  it('includes Phase 0 foundation entry in Build Status registry and defines phases 0-5', () => {
    const all = getAllRegistryEntries();
    expect(all).toHaveLength(25);
    expect(all[0].code).toBe('P0');
    expect(all[0].status).toBe('Completed');
    expect(BUILD_PHASES.map((p) => p.phase)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('resolves module metadata by route path', () => {
    expect(getModuleByRoute('/tenants')?.code).toBe('M24');
    expect(getModuleByRoute('/fhir-explorer')?.code).toBe('M2');
    expect(getModuleByRoute('/build-status')?.code).toBe('P0');
  });

  it('resolves tenant FHIR base URLs for path and header partition strategies', () => {
    expect(
      resolveTenantBaseUrl('http://localhost:8081/fhir/', 'state-medicaid-a', 'path'),
    ).toBe('http://localhost:8081/fhir/state-medicaid-a');
    expect(
      resolveTenantBaseUrl('http://localhost:8081/fhir/', 'state-medicaid-a', 'header'),
    ).toBe('http://localhost:8081/fhir');
  });
});
