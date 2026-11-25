import { eventBus } from '../../events';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import {
  ACCEPTING_PATIENTS_EXT_URL,
  LAST_VERIFIED_EXT_URL,
  LICENSE_SYSTEM,
  MEDICAID_ID_SYSTEM,
  NPI_SYSTEM,
  PROVIDER_STATUS_EXT_URL,
  PROVIDER_TYPE_EXT_URL,
  SENSITIVE_BANK_EXT_URL,
  SENSITIVE_SSN_EXT_URL,
  SENSITIVE_TIN_EXT_URL,
  TAXONOMY_SYSTEM,
} from '../../mock-data';
import { calculateNameSimilarity, validateNpi } from '../../rules';
import { auditService } from '../../services/auditService';
import {
  AppError,
  type FhirAuditEvent,
  type FhirBundle,
  type FhirEndpoint,
  type FhirLocation,
  type FhirOrganization,
  type FhirPractitioner,
  type FhirPractitionerRole,
  type FhirProvenance,
  type RoleName,
} from '../../types';

export type ProviderEnrollmentStatus =
  | 'Applicant'
  | 'Pending'
  | 'Active'
  | 'Suspended'
  | 'Terminated'
  | 'Revalidation Due';

export interface ProviderDirectoryRow {
  id: string;
  resource: FhirPractitioner;
  fullName: string;
  npi: string;
  medicaidId: string;
  taxonomyCode: string;
  specialty: string;
  providerType: string;
  licenseNumber: string;
  licenseState: string;
  status: ProviderEnrollmentStatus;
  statusEffectiveStart: string;
  acceptingNewPatients: boolean;
  city: string;
  state: string;
  postalCode: string;
  street: string;
  phone: string;
  email: string;
  tin?: string;
  ssn?: string;
  dob?: string;
  bankAccount?: string;
  lastVerifiedDate?: string;
}

export interface Provider360Data {
  provider: ProviderDirectoryRow;
  roles: FhirPractitionerRole[];
  locations: FhirLocation[];
  endpoints: FhirEndpoint[];
  organizations: FhirOrganization[];
  provenance: FhirProvenance[];
  audits: FhirAuditEvent[];
}

export interface DuplicateCandidate {
  id: string;
  primary: ProviderDirectoryRow;
  candidate: ProviderDirectoryRow;
  score: number;
  reasons: string[];
}

export interface CreateOrUpdateProviderInput {
  id?: string;
  prefix?: string;
  given: string;
  family: string;
  npi: string;
  medicaidId?: string;
  providerType: string;
  taxonomyCode: string;
  specialty: string;
  licenseNumber: string;
  licenseState: string;
  status: ProviderEnrollmentStatus;
  acceptingNewPatients: boolean;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  email: string;
  tin?: string;
  dob?: string;
  organizationName?: string;
  endpointUrl?: string;
}

function getExt(resource: FhirPractitioner, url: string) {
  return resource.extension?.find((e) => e.url === url);
}

export function mapPractitionerToRow(p: FhirPractitioner): ProviderDirectoryRow {
  const nameObj = p.name?.[0];
  const fullName =
    nameObj?.text ||
    [
      ...(nameObj?.prefix ?? []),
      ...(nameObj?.given ?? []),
      nameObj?.family ?? '',
    ]
      .filter(Boolean)
      .join(' ') ||
    'Unnamed Provider';

  const npi =
    p.identifier?.find((i) => i.system === NPI_SYSTEM)?.value ?? '';
  const medicaidId =
    p.identifier?.find((i) => i.system === MEDICAID_ID_SYSTEM)?.value ?? '';
  const licenseRaw =
    p.identifier?.find((i) => i.system === LICENSE_SYSTEM)?.value ?? '';
  const [licState = '', ...licRest] = licenseRaw.includes('-')
    ? licenseRaw.split('-')
    : ['', licenseRaw];
  const qualCoding = p.qualification?.[0]?.code?.coding?.[0];
  const statusExt = getExt(p, PROVIDER_STATUS_EXT_URL);
  const status = (statusExt?.valueCode ?? 'Active') as ProviderEnrollmentStatus;
  const statusEffectiveStart =
    statusExt?.extension?.find((e) => e.url === 'effectivePeriod')?.valuePeriod
      ?.start ??
    p.meta?.lastUpdated?.slice(0, 10) ??
    '2025-01-01';

  const addr = p.address?.[0];
  const phone = p.telecom?.find((t) => t.system === 'phone')?.value ?? '';
  const email = p.telecom?.find((t) => t.system === 'email')?.value ?? '';

  return {
    id: p.id ?? '',
    resource: p,
    fullName,
    npi,
    medicaidId,
    taxonomyCode: qualCoding?.code ?? '',
    specialty: qualCoding?.display ?? p.qualification?.[0]?.code?.text ?? 'General',
    providerType: getExt(p, PROVIDER_TYPE_EXT_URL)?.valueString ?? 'Individual Physician',
    licenseNumber: licRest.join('-') || licenseRaw,
    licenseState: licState || addr?.state || '',
    status,
    statusEffectiveStart,
    acceptingNewPatients: Boolean(
      getExt(p, ACCEPTING_PATIENTS_EXT_URL)?.valueBoolean,
    ),
    city: addr?.city ?? '',
    state: addr?.state ?? '',
    postalCode: addr?.postalCode ?? '',
    street: addr?.line?.[0] ?? '',
    phone,
    email,
    tin: getExt(p, SENSITIVE_TIN_EXT_URL)?.valueString,
    ssn: getExt(p, SENSITIVE_SSN_EXT_URL)?.valueString,
    dob: p.birthDate,
    bankAccount: getExt(p, SENSITIVE_BANK_EXT_URL)?.valueString,
    lastVerifiedDate: getExt(p, LAST_VERIFIED_EXT_URL)?.valueDateTime,
  };
}

export const providerService = {
  async listProviders(ctx: FhirRequestContext): Promise<ProviderDirectoryRow[]> {
    const client = getFhirClient();
    const res = await client.search<FhirPractitioner>(ctx, 'Practitioner', {
      _count: 200,
    });
    return res.resources.map(mapPractitionerToRow);
  },

  async getProvider360(
    ctx: FhirRequestContext,
    practitionerId: string,
  ): Promise<Provider360Data> {
    const client = getFhirClient();
    const prac = await client.read<FhirPractitioner>(
      ctx,
      'Practitioner',
      practitionerId,
    );
    const provider = mapPractitionerToRow(prac);

    const [rolesRes, locsRes, epsRes, orgsRes, provRes, audits] =
      await Promise.all([
        client.search<FhirPractitionerRole>(ctx, 'PractitionerRole', {
          practitioner: `Practitioner/${practitionerId}`,
        }),
        client.search<FhirLocation>(ctx, 'Location', { _count: 100 }),
        client.search<FhirEndpoint>(ctx, 'Endpoint', { _count: 100 }),
        client.search<FhirOrganization>(ctx, 'Organization', { _count: 100 }),
        client.search<FhirProvenance>(ctx, 'Provenance', { _count: 100 }),
        auditService.list(ctx, { resourceType: 'Practitioner' }),
      ]);

    const roleLocIds = new Set(
      rolesRes.resources.flatMap((r) =>
        (r.location ?? []).map((l) => l.reference?.split('/')[1] ?? ''),
      ),
    );
    const roleEpIds = new Set(
      rolesRes.resources.flatMap((r) =>
        (r.endpoint ?? []).map((e) => e.reference?.split('/')[1] ?? ''),
      ),
    );
    const roleOrgIds = new Set(
      rolesRes.resources
        .map((r) => r.organization?.reference?.split('/')[1] ?? '')
        .filter(Boolean),
    );

    return {
      provider,
      roles: rolesRes.resources,
      locations: locsRes.resources.filter((l) => roleLocIds.has(l.id ?? '')),
      endpoints: epsRes.resources.filter((e) => roleEpIds.has(e.id ?? '')),
      organizations: orgsRes.resources.filter((o) => roleOrgIds.has(o.id ?? '')),
      provenance: provRes.resources.filter((pv) =>
        pv.target?.some((t) => t.reference === `Practitioner/${practitionerId}`),
      ),
      audits: audits.filter(
        (a) =>
          a.entity?.some(
            (e) => e.what?.reference === `Practitioner/${practitionerId}`,
          ) || !a.entity?.[0]?.what,
      ),
    };
  },

  async createOrUpdateProvider(
    ctx: FhirRequestContext,
    input: CreateOrUpdateProviderInput,
    actor: { name: string; role: RoleName },
  ): Promise<{ provider: ProviderDirectoryRow; created: boolean }> {
    if (!validateNpi(input.npi)) {
      throw new AppError({
        message: `Invalid NPI '${input.npi}'. NPI must be a valid 10-digit Luhn number.`,
        statusCode: 400,
        code: 'INVALID_NPI',
      });
    }
    if (!input.given.trim() || !input.family.trim()) {
      throw new AppError({
        message: 'Provider first and last name are required.',
        statusCode: 400,
        code: 'MISSING_NAME',
      });
    }

    const client = getFhirClient();
    const fullName = [input.prefix, input.given, input.family]
      .filter(Boolean)
      .join(' ');

    const practitioner: FhirPractitioner = {
      resourceType: 'Practitioner',
      id: input.id,
      active: input.status === 'Active' || input.status === 'Revalidation Due',
      identifier: [
        { system: NPI_SYSTEM, value: input.npi.trim(), use: 'official' },
        ...(input.medicaidId
          ? [{ system: MEDICAID_ID_SYSTEM, value: input.medicaidId.trim(), use: 'usual' as const }]
          : []),
        ...(input.licenseNumber
          ? [
              {
                system: LICENSE_SYSTEM,
                value: `${input.licenseState || input.state}-${input.licenseNumber}`,
                use: 'secondary' as const,
              },
            ]
          : []),
      ],
      name: [
        {
          use: 'official',
          prefix: input.prefix ? [input.prefix] : undefined,
          given: [input.given.trim()],
          family: input.family.trim(),
          text: fullName,
        },
      ],
      telecom: [
        ...(input.phone ? [{ system: 'phone' as const, value: input.phone, use: 'work' as const }] : []),
        ...(input.email ? [{ system: 'email' as const, value: input.email, use: 'work' as const }] : []),
      ],
      address: [
        {
          use: 'work',
          line: input.street ? [input.street] : [],
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
        },
      ],
      birthDate: input.dob || undefined,
      qualification: [
        {
          identifier: input.licenseNumber
            ? [{ system: LICENSE_SYSTEM, value: input.licenseNumber }]
            : undefined,
          code: {
            coding: [
              {
                system: TAXONOMY_SYSTEM,
                code: input.taxonomyCode,
                display: input.specialty,
              },
            ],
            text: input.specialty,
          },
        },
      ],
      extension: [
        {
          url: PROVIDER_STATUS_EXT_URL,
          valueCode: input.status,
          extension: [
            {
              url: 'effectivePeriod',
              valuePeriod: { start: new Date().toISOString().slice(0, 10) },
            },
          ],
        },
        { url: ACCEPTING_PATIENTS_EXT_URL, valueBoolean: input.acceptingNewPatients },
        { url: PROVIDER_TYPE_EXT_URL, valueString: input.providerType },
        ...(input.tin ? [{ url: SENSITIVE_TIN_EXT_URL, valueString: input.tin }] : []),
        { url: LAST_VERIFIED_EXT_URL, valueDateTime: new Date().toISOString().slice(0, 10) },
      ],
    };

    if (input.id) {
      const updated = await client.update(ctx, practitioner);
      await auditService.record({
        ctx,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'update',
        resourceType: 'Practitioner',
        resourceId: updated.id,
        outcomeDesc: `Updated provider ${fullName} (NPI ${input.npi})`,
      });
      return { provider: mapPractitionerToRow(updated), created: false };
    }

    const result = await client.conditionalCreate(ctx, practitioner, {
      identifier: `${NPI_SYSTEM}|${input.npi.trim()}`,
    });

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: result.created ? 'create' : 'update',
      resourceType: 'Practitioner',
      resourceId: result.resource.id,
      outcomeDesc: result.created
        ? `Conditional created provider ${fullName} (NPI ${input.npi})`
        : `Conditional create matched existing NPI ${input.npi}`,
    });

    return {
      provider: mapPractitionerToRow(result.resource),
      created: result.created,
    };
  },

  detectDuplicates(providers: ProviderDirectoryRow[]): DuplicateCandidate[] {
    const candidates: DuplicateCandidate[] = [];
    for (let i = 0; i < providers.length; i += 1) {
      for (let j = i + 1; j < providers.length; j += 1) {
        const a = providers[i];
        const b = providers[j];
        let score = 0;
        const reasons: string[] = [];

        if (a.npi && b.npi && a.npi === b.npi) {
          score += 60;
          reasons.push(`Exact NPI match (${a.npi})`);
        }
        const nameSim = calculateNameSimilarity(a.fullName, b.fullName);
        if (nameSim >= 0.5) {
          const pts = Math.round(nameSim * 30);
          score += pts;
          reasons.push(`Name similarity ${Math.round(nameSim * 100)}%`);
        }
        if (
          a.street &&
          b.street &&
          a.street.toLowerCase() === b.street.toLowerCase() &&
          a.city.toLowerCase() === b.city.toLowerCase()
        ) {
          score += 20;
          reasons.push(`Shared practice address (${a.street}, ${a.city})`);
        }
        if (a.tin && b.tin && a.tin === b.tin) {
          score += 15;
          reasons.push('Shared Tax ID (TIN)');
        }

        if (score >= 30) {
          candidates.push({
            id: `${a.id}__${b.id}`,
            primary: a,
            candidate: b,
            score: Math.min(100, score),
            reasons,
          });
        }
      }
    }
    return candidates.sort((x, y) => y.score - x.score);
  },

  async mergeDuplicateProviders(
    ctx: FhirRequestContext,
    survivingId: string,
    duplicateId: string,
    reason: string,
    actor: { name: string; role: RoleName },
  ): Promise<FhirProvenance> {
    const client = getFhirClient();
    const surviving = await client.read<FhirPractitioner>(ctx, 'Practitioner', survivingId);
    const duplicate = await client.read<FhirPractitioner>(ctx, 'Practitioner', duplicateId);

    // Mark duplicate inactive / terminated
    const updatedDup: FhirPractitioner = {
      ...duplicate,
      active: false,
      extension: [
        ...(duplicate.extension ?? []).filter((e) => e.url !== PROVIDER_STATUS_EXT_URL),
        {
          url: PROVIDER_STATUS_EXT_URL,
          valueCode: 'Terminated',
          extension: [{ url: 'mergedInto', valueString: `Practitioner/${survivingId}` }],
        },
      ],
    };
    await client.update(ctx, updatedDup);

    const provenance: FhirProvenance = {
      resourceType: 'Provenance',
      target: [
        { reference: `Practitioner/${survivingId}`, display: surviving.name?.[0]?.text },
      ],
      recorded: new Date().toISOString(),
      reason: [{ text: reason || 'Duplicate provider merge' }],
      activity: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation',
            code: 'MERGE',
            display: 'Merge Duplicate Provider',
          },
        ],
      },
      agent: [{ who: { display: `${actor.name} (${actor.role})` } }],
      entity: [
        {
          role: 'source',
          what: { reference: `Practitioner/${duplicateId}`, display: duplicate.name?.[0]?.text },
        },
      ],
    };
    const createdProv = await client.create(ctx, provenance);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Practitioner',
      resourceId: survivingId,
      outcomeDesc: `Merged duplicate Practitioner/${duplicateId} into Practitioner/${survivingId}`,
    });

    eventBus.publish({
      type: 'ProviderStatusChanged',
      tenantId: ctx.tenantId,
      sourceModule: 'M3',
      payload: {
        practitionerId: duplicateId,
        previousStatus: 'Active',
        newStatus: 'Terminated',
        reason: `Merged into ${survivingId}`,
      },
    });

    return createdProv;
  },

  /**
   * SyncService: builds a FHIR transaction Bundle with urn:uuid references
   * (Practitioner, Location, Endpoint, PractitionerRole) and submits it atomically.
   */
  async publishProviderToFhir(
    ctx: FhirRequestContext,
    input: CreateOrUpdateProviderInput,
    actor: { name: string; role: RoleName },
  ): Promise<{ requestBundle: FhirBundle; responseBundle: FhirBundle }> {
    if (!validateNpi(input.npi)) {
      throw new AppError({
        message: `Cannot sync invalid NPI '${input.npi}'.`,
        statusCode: 400,
        code: 'INVALID_NPI',
      });
    }

    const pracUrn = `urn:uuid:prac-${Date.now()}`;
    const locUrn = `urn:uuid:loc-${Date.now()}`;
    const epUrn = `urn:uuid:ep-${Date.now()}`;
    const roleUrn = `urn:uuid:role-${Date.now()}`;
    const fullName = [input.prefix, input.given, input.family]
      .filter(Boolean)
      .join(' ');

    const practitioner: FhirPractitioner = {
      resourceType: 'Practitioner',
      active: input.status === 'Active',
      identifier: [
        { system: NPI_SYSTEM, value: input.npi.trim(), use: 'official' },
        ...(input.medicaidId
          ? [{ system: MEDICAID_ID_SYSTEM, value: input.medicaidId.trim() }]
          : []),
      ],
      name: [
        {
          use: 'official',
          prefix: input.prefix ? [input.prefix] : undefined,
          given: [input.given.trim()],
          family: input.family.trim(),
          text: fullName,
        },
      ],
      telecom: [
        ...(input.phone ? [{ system: 'phone' as const, value: input.phone }] : []),
        ...(input.email ? [{ system: 'email' as const, value: input.email }] : []),
      ],
      address: [
        {
          use: 'work',
          line: [input.street],
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
        },
      ],
      qualification: [
        {
          code: {
            coding: [
              {
                system: TAXONOMY_SYSTEM,
                code: input.taxonomyCode,
                display: input.specialty,
              },
            ],
          },
        },
      ],
      extension: [
        {
          url: PROVIDER_STATUS_EXT_URL,
          valueCode: input.status,
          extension: [
            {
              url: 'effectivePeriod',
              valuePeriod: { start: new Date().toISOString().slice(0, 10) },
            },
          ],
        },
        { url: ACCEPTING_PATIENTS_EXT_URL, valueBoolean: input.acceptingNewPatients },
        { url: PROVIDER_TYPE_EXT_URL, valueString: input.providerType },
        { url: LAST_VERIFIED_EXT_URL, valueDateTime: new Date().toISOString().slice(0, 10) },
      ],
    };

    const location: FhirLocation = {
      resourceType: 'Location',
      status: 'active',
      name: `${input.organizationName || fullName} — ${input.city} Clinic`,
      address: {
        use: 'work',
        line: [input.street],
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
      },
    };

    const endpoint: FhirEndpoint = {
      resourceType: 'Endpoint',
      status: 'active',
      connectionType: {
        system: 'http://terminology.hl7.org/CodeSystem/endpoint-connection-type',
        code: 'hl7-fhir-rest',
        display: 'HL7 FHIR',
      },
      name: `${fullName} Endpoint`,
      payloadType: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/endpoint-payload-type',
              code: 'any',
            },
          ],
        },
      ],
      address: input.endpointUrl || `https://fhir.synthetic.example/${input.npi}`,
    };

    const role: FhirPractitionerRole = {
      resourceType: 'PractitionerRole',
      active: input.status === 'Active',
      practitioner: { reference: pracUrn, display: fullName },
      location: [{ reference: locUrn, display: location.name }],
      endpoint: [{ reference: epUrn, display: endpoint.name }],
      specialty: [
        {
          coding: [
            {
              system: TAXONOMY_SYSTEM,
              code: input.taxonomyCode,
              display: input.specialty,
            },
          ],
        },
      ],
    };

    const requestBundle: FhirBundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          fullUrl: pracUrn,
          resource: practitioner,
          request: {
            method: 'POST',
            url: 'Practitioner',
            ifNoneExist: `identifier=${NPI_SYSTEM}|${input.npi.trim()}`,
          },
        },
        {
          fullUrl: locUrn,
          resource: location,
          request: { method: 'POST', url: 'Location' },
        },
        {
          fullUrl: epUrn,
          resource: endpoint,
          request: { method: 'POST', url: 'Endpoint' },
        },
        {
          fullUrl: roleUrn,
          resource: role,
          request: { method: 'POST', url: 'PractitionerRole' },
        },
      ],
    };

    const client = getFhirClient();
    const responseBundle = await client.transaction(ctx, requestBundle);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Bundle',
      outcomeDesc: `Published provider transaction bundle for ${fullName} (NPI ${input.npi})`,
    });

    return { requestBundle, responseBundle };
  },
};
