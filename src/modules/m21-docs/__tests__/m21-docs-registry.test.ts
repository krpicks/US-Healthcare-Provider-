import { describe, expect, it } from 'vitest';
import { IMPLEMENTED_MODULE_PAGES } from '../../../app/AppRouter';
import {
  MODULE_REGISTRY,
  getAllRegistryEntries,
} from '../../../app/moduleRegistry';
import { ALL_ACTIONS, ALL_ROLES, PERMISSION_MATRIX } from '../../../app/rbac';
import {
  ARCHITECTURE_ADRS,
  CICD_STAGES,
  DEPLOYMENT_ENVIRONMENTS,
  SETUP_GUIDES,
  docsService,
} from '../docsService';

describe('M21 Documentation, Architecture Registry & Deployment', () => {
  it('verifies every module in MODULE_REGISTRY has a unique route, an implemented page, a PERMISSION_MATRIX entry for every role, and a Build Status registry entry', () => {
    expect(MODULE_REGISTRY.length).toBe(24);

    const allEntries = getAllRegistryEntries();
    const seenRoutes = new Set<string>();

    for (const mod of MODULE_REGISTRY) {
      // Unique non-empty route
      expect(mod.route).toBeTruthy();
      expect(mod.route.startsWith('/')).toBe(true);
      expect(seenRoutes.has(mod.route)).toBe(false);
      seenRoutes.add(mod.route);

      // Implemented in AppRouter
      expect(IMPLEMENTED_MODULE_PAGES[mod.id]).toBeDefined();

      // Build Status registry entry exists
      expect(allEntries.some((e) => e.id === mod.id && e.code === mod.code)).toBe(true);

      // Permission entry exists for every role with all 6 boolean actions
      for (const role of ALL_ROLES) {
        const rolePermissions = PERMISSION_MATRIX[role];
        expect(rolePermissions).toBeDefined();
        const modPerms = rolePermissions[mod.id];
        expect(modPerms).toBeDefined();
        for (const action of ALL_ACTIONS) {
          expect(typeof modPerms[action]).toBe('boolean');
        }
      }
    }
  });

  it('groups all 25 registry entries (P0 + M1–M24) across the 5 layered architecture tiers', () => {
    const layers = docsService.getModulesByLayer();
    const total = layers.reduce((acc, l) => acc + l.modules.length, 0);
    expect(total).toBe(25);
    expect(layers.every((l) => l.modules.length > 0)).toBe(true);
  });

  it('provides copyable local setup guides for HAPI (8081), eCRNow (8080), .NET Gateway (5000), and Inferno (4567) plus ADRs and 12 CI/CD stages', () => {
    const ports = SETUP_GUIDES.map((g) => g.port);
    expect(ports).toEqual(expect.arrayContaining([8081, 8080, 5000, 4567]));
    expect(ARCHITECTURE_ADRS.length).toBeGreaterThanOrEqual(5);
    expect(DEPLOYMENT_ENVIRONMENTS.map((e) => e.name)).toEqual([
      'Local',
      'Dev',
      'Test',
      'Staging',
      'Production',
    ]);
    expect(CICD_STAGES).toHaveLength(12);
  });

  it('exports unified Architecture & Deployment documentation as Markdown covering all 7 sections', () => {
    const md = docsService.exportFullDocumentationMarkdown();
    expect(md).toContain('# ProviderLink FHIR Platform — Architecture & Deployment Documentation');
    expect(md).toContain('## 1. Layered Module Architecture');
    expect(md).toContain('## 2. Solution Integration Topology');
    expect(md).toContain('## 3. Platform Event Catalogue');
    expect(md).toContain('## 4. Local Setup Guides');
    expect(md).toContain('## 5. Architecture Decision Log (ADRs)');
    expect(md).toContain('## 6. Deployment Environments');
    expect(md).toContain('## 7. CI/CD Pipeline Summary (12 Stages)');
  });
});
