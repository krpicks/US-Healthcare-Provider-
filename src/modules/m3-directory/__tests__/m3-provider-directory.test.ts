import { beforeEach, describe, expect, it } from 'vitest';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { buildValidNpi, validateNpi } from '../../../rules';
import { settingsService } from '../../../services';
import { providerService } from '../providerService';

describe('M3 Provider Master Data & Directory', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const actor = { name: 'Alex Morgan', role: 'PlatformAdmin' as const };

  beforeEach(async () => {
    settingsService.reset();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('validates US 10-digit NPI check digits using Luhn with 80840 prefix', () => {
    const valid = buildValidNpi('123456789');
    expect(valid).toBe('1234567893');
    expect(validateNpi(valid)).toBe(true);
    expect(validateNpi('1234567890')).toBe(false);
    expect(validateNpi('12345')).toBe(false);
    expect(validateNpi('ABCDEFGHIJ')).toBe(false);
  });

  it('performs idempotent conditional create on NPI and rejects invalid NPIs', async () => {
    const npi = buildValidNpi('155889912');
    const baseInput = {
      prefix: 'Dr.',
      given: 'Hannah',
      family: 'Kowalski',
      npi,
      medicaidId: 'MCD-NY-9001',
      providerType: 'Individual Physician',
      taxonomyCode: '207Q00000X',
      specialty: 'Family Medicine',
      licenseNumber: '998120',
      licenseState: 'NY',
      status: 'Active' as const,
      acceptingNewPatients: true,
      street: '100 Main St',
      city: 'Albany',
      state: 'NY',
      postalCode: '12207',
      phone: '518-555-0199',
      email: 'hannah.kowalski@synthetic.example',
    };

    const first = await providerService.createOrUpdateProvider(ctx, baseInput, actor);
    expect(first.created).toBe(true);

    const second = await providerService.createOrUpdateProvider(ctx, baseInput, actor);
    expect(second.created).toBe(false);
    expect(second.provider.id).toBe(first.provider.id);

    await expect(
      providerService.createOrUpdateProvider(ctx, { ...baseInput, npi: '1111111111' }, actor),
    ).rejects.toThrow(/Invalid NPI/i);
  });

  it('detects duplicate providers and merges them with FHIR Provenance', async () => {
    const npi1 = buildValidNpi('166778899');
    const npi2 = buildValidNpi('166778898');

    const a = await providerService.createOrUpdateProvider(
      ctx,
      {
        given: 'Samuel',
        family: 'Whitaker',
        npi: npi1,
        providerType: 'Individual Physician',
        taxonomyCode: '207Q00000X',
        specialty: 'Family Medicine',
        licenseNumber: '111222',
        licenseState: 'NY',
        status: 'Active',
        acceptingNewPatients: true,
        street: '500 Capitol Way',
        city: 'Albany',
        state: 'NY',
        postalCode: '12207',
        phone: '518-555-0177',
        email: 'sam.w@synthetic.example',
        tin: '99-8877665',
      },
      actor,
    );
    const b = await providerService.createOrUpdateProvider(
      ctx,
      {
        given: 'Samuel',
        family: 'Whitaker',
        npi: npi2,
        providerType: 'Individual Physician',
        taxonomyCode: '207Q00000X',
        specialty: 'Family Medicine',
        licenseNumber: '111223',
        licenseState: 'NY',
        status: 'Active',
        acceptingNewPatients: true,
        street: '500 Capitol Way',
        city: 'Albany',
        state: 'NY',
        postalCode: '12207',
        phone: '518-555-0177',
        email: 'sam.whitaker@synthetic.example',
        tin: '99-8877665',
      },
      actor,
    );

    const all = await providerService.listProviders(ctx);
    const dups = providerService.detectDuplicates(all);
    expect(dups.some((d) => d.primary.id === a.provider.id || d.candidate.id === b.provider.id)).toBe(true);

    const provenance = await providerService.mergeDuplicateProviders(
      ctx,
      a.provider.id,
      b.provider.id,
      'Confirmed duplicate profile',
      actor,
    );
    expect(provenance.resourceType).toBe('Provenance');
    expect(provenance.activity?.coding?.[0]?.code).toBe('MERGE');

    const refreshed = await providerService.listProviders(ctx);
    const mergedRow = refreshed.find((p) => p.id === b.provider.id);
    expect(mergedRow?.status).toBe('Terminated');
  });

  it('publishes Practitioner, Location, Endpoint, and PractitionerRole atomically via transaction bundle', async () => {
    const npi = buildValidNpi('177889900');
    const { requestBundle, responseBundle } = await providerService.publishProviderToFhir(
      ctx,
      {
        prefix: 'Dr.',
        given: 'Nadia',
        family: 'Al-Mansoor',
        npi,
        providerType: 'Individual Physician',
        taxonomyCode: '207R00000X',
        specialty: 'Internal Medicine',
        licenseNumber: '554433',
        licenseState: 'NY',
        status: 'Active',
        acceptingNewPatients: true,
        street: '200 River Rd',
        city: 'Troy',
        state: 'NY',
        postalCode: '12180',
        phone: '518-555-0144',
        email: 'nadia.almansoor@synthetic.example',
        organizationName: 'Hudson Valley Primary Care',
      },
      actor,
    );

    expect(requestBundle.type).toBe('transaction');
    expect(requestBundle.entry).toHaveLength(4);
    expect(responseBundle.type).toBe('transaction-response');
    expect(responseBundle.entry).toHaveLength(4);

    const roleResource = responseBundle.entry?.[3]?.resource as {
      practitioner?: { reference?: string };
      location?: Array<{ reference?: string }>;
    };
    expect(roleResource.practitioner?.reference).toMatch(/^Practitioner\//);
    expect(roleResource.location?.[0]?.reference).toMatch(/^Location\//);
  });
});
