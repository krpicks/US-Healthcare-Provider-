import { eventBus } from '../../events';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import {
  ACCEPTING_PATIENTS_EXT_URL,
  LAST_VERIFIED_EXT_URL,
  NPI_SYSTEM,
  PROVIDER_STATUS_EXT_URL,
  TAXONOMY_SYSTEM,
} from '../../mock-data';
import { buildValidNpi, validateNpi } from '../../rules';
import { auditService } from '../../services/auditService';
import { parseSimpleCsv } from '../../services/csvUtils';
import { tenantService } from '../../tenancy';
import {
  AppError,
  type FhirBundle,
  type FhirCommunication,
  type FhirOrganizationAffiliation,
  type FhirPractitioner,
  type FhirPractitionerRole,
  type FhirProvenance,
  type FhirTask,
  type RoleName,
} from '../../types';
import {
  providerService,
  type ProviderDirectoryRow,
  type ProviderEnrollmentStatus,
} from '../m3-directory/providerService';

export interface SavedFilterPreset {
  id: string;
  name: string;
  status: string;
  acceptingOnly: boolean;
  staleOnly: boolean;
}

export interface RosterRowInput {
  rowNumber: number;
  npi: string;
  given: string;
  family: string;
  taxonomyCode: string;
  specialty: string;
  organizationName: string;
  city: string;
  state: string;
  phone: string;
}

export interface RosterRowValidation {
  row: RosterRowInput;
  valid: boolean;
  errors: string[];
}

export interface RosterCommitSummary {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface AffiliationRecord {
  id: string;
  practitionerId: string;
  practitionerName: string;
  organizationId: string;
  organizationName: string;
  locationName: string;
  role: string;
  specialty: string;
  billingAuthority: boolean;
  startDate: string;
  endDate?: string;
}

export type NetworkParticipationStatus =
  | 'Participating'
  | 'Pending'
  | 'Closed'
  | 'Terminated';

export interface NetworkParticipationRecord {
  id: string;
  practitionerId: string;
  practitionerName: string;
  planId: string;
  planName: string;
  status: NetworkParticipationStatus;
  effectiveStart: string;
  effectiveEnd?: string;
  acceptingNewPatients: boolean;
  panelSizeLimit: number;
  ageLimit: string;
  genderLimit: 'All' | 'Female' | 'Male';
  languages: string[];
  accessibility: string[];
}

export type SelfServiceField =
  | 'address'
  | 'phone'
  | 'hours'
  | 'locations'
  | 'taxonomy'
  | 'acceptingNewPatients'
  | 'bankingDetails'
  | 'ownershipChange';

export interface ChangeRequestRecord {
  id: string;
  taskId: string;
  practitionerId: string;
  practitionerName: string;
  field: SelfServiceField;
  beforeValue: string;
  afterValue: string;
  status: 'PendingApproval' | 'AutoApplied' | 'Approved' | 'Rejected' | 'RoutedToEnrollment';
  requiresApproval: boolean;
  requestedBy: string;
  requestedAt: string;
  reviewedBy?: string;
}

export interface DelegatedUserRecord {
  id: string;
  practitionerId: string;
  practitionerName: string;
  delegateName: string;
  delegateEmail: string;
  permissions: string[];
  expiresAt: string;
  active: boolean;
}

export interface AttestationCampaign {
  id: string;
  name: string;
  createdAt: string;
  dueDate: string;
  targetedCount: number;
  attestedCount: number;
  status: 'Active' | 'Completed';
}

export interface DataQualityScore {
  practitionerId: string;
  fullName: string;
  npi: string;
  score: number;
  missingFields: string[];
  daysSinceVerified: number;
  isStale: boolean;
}

interface TenantOpsState {
  savedFilters: SavedFilterPreset[];
  affiliations: AffiliationRecord[];
  networkParticipations: NetworkParticipationRecord[];
  changeRequests: ChangeRequestRecord[];
  delegatedUsers: DelegatedUserRecord[];
  attestationCampaigns: AttestationCampaign[];
}

const tenantOpsStore = new Map<string, TenantOpsState>();

function getOrInitOpsState(tenantId: string): TenantOpsState {
  let state = tenantOpsStore.get(tenantId);
  if (state) return state;

  const isTenantB = tenantId.includes('health-center');
  state = {
    savedFilters: [
      { id: 'flt-active', name: 'Active & Accepting', status: 'Active', acceptingOnly: true, staleOnly: false },
      { id: 'flt-stale', name: 'Stale (>90 days)', status: 'all', acceptingOnly: false, staleOnly: true },
      { id: 'flt-reval', name: 'Revalidation Due', status: 'Revalidation Due', acceptingOnly: false, staleOnly: false },
    ],
    affiliations: isTenantB
      ? [
          {
            id: 'aff-rec-b1',
            practitionerId: 'prac-b-1',
            practitionerName: 'Dr. Rachel Goldstein',
            organizationId: 'org-b-midwest-fqhc',
            organizationName: 'Midwest Community Health Network',
            locationName: 'Chicago Main FQHC',
            role: 'Lead Clinician',
            specialty: 'Family Medicine',
            billingAuthority: true,
            startDate: '2025-01-01',
            endDate: '2027-12-31',
          },
        ]
      : [
          {
            id: 'aff-rec-a1',
            practitionerId: 'prac-a-1',
            practitionerName: 'Dr. Elena Vargas',
            organizationId: 'org-a-capital-health',
            organizationName: 'Capital Valley Medical Group',
            locationName: 'Albany State St Clinic',
            role: 'Attending Physician',
            specialty: 'Family Medicine',
            billingAuthority: true,
            startDate: '2025-01-01',
            endDate: '2027-12-31',
          },
          {
            id: 'aff-rec-a2',
            practitionerId: 'prac-a-2',
            practitionerName: 'Dr. Marcus Chen',
            organizationId: 'org-a-capital-health',
            organizationName: 'Capital Valley Medical Group',
            locationName: 'Syracuse Salina Clinic',
            role: 'Pediatric Lead',
            specialty: 'Pediatrics',
            billingAuthority: true,
            startDate: '2025-01-01',
            endDate: '2027-12-31',
          },
          {
            id: 'aff-rec-a3',
            practitionerId: 'prac-a-3',
            practitionerName: 'Dr. Amara Okafor',
            organizationId: 'org-a-lakeview-bh',
            organizationName: 'Lakeview Behavioral Health Partners',
            locationName: 'Rochester East Ave Center',
            role: 'Medical Director',
            specialty: 'Psychiatry',
            billingAuthority: true,
            startDate: '2025-01-01',
            endDate: '2027-12-31',
          },
        ],
    networkParticipations: isTenantB
      ? [
          {
            id: 'np-b1',
            practitionerId: 'prac-b-1',
            practitionerName: 'Dr. Rachel Goldstein',
            planId: 'plan-ffs-fqhc-network-b',
            planName: 'State Medicaid Fee-For-Service Core',
            status: 'Participating',
            effectiveStart: '2026-01-01',
            acceptingNewPatients: true,
            panelSizeLimit: 1800,
            ageLimit: 'All ages',
            genderLimit: 'All',
            languages: ['English', 'Spanish'],
            accessibility: ['Wheelchair ramp', 'ASL interpreter'],
          },
        ]
      : [
          {
            id: 'np-a1',
            practitionerId: 'prac-a-1',
            practitionerName: 'Dr. Elena Vargas',
            planId: 'plan-ffs-state-medicaid-a',
            planName: 'State Medicaid Fee-For-Service Core',
            status: 'Participating',
            effectiveStart: '2026-01-01',
            acceptingNewPatients: true,
            panelSizeLimit: 2000,
            ageLimit: 'All ages',
            genderLimit: 'All',
            languages: ['English', 'Spanish'],
            accessibility: ['Wheelchair accessible', 'Elevator'],
          },
          {
            id: 'np-a2',
            practitionerId: 'prac-a-2',
            practitionerName: 'Dr. Marcus Chen',
            planId: 'plan-chip-state-medicaid-a',
            planName: 'ChildHealth Plus CHIP Network',
            status: 'Participating',
            effectiveStart: '2026-01-01',
            acceptingNewPatients: true,
            panelSizeLimit: 1500,
            ageLimit: '0–19 years',
            genderLimit: 'All',
            languages: ['English', 'Mandarin'],
            accessibility: ['Wheelchair accessible'],
          },
          {
            id: 'np-a3',
            practitionerId: 'prac-a-3',
            practitionerName: 'Dr. Amara Okafor',
            planId: 'plan-mco-state-medicaid-a',
            planName: 'CommunityCare Managed Medicaid MCO',
            status: 'Participating',
            effectiveStart: '2026-01-01',
            acceptingNewPatients: true,
            panelSizeLimit: 600,
            ageLimit: '18+ years',
            genderLimit: 'All',
            languages: ['English'],
            accessibility: ['Telehealth enabled', 'Wheelchair accessible'],
          },
        ],
    changeRequests: [],
    delegatedUsers: [
      {
        id: 'del-1',
        practitionerId: isTenantB ? 'prac-b-1' : 'prac-a-1',
        practitionerName: isTenantB ? 'Dr. Rachel Goldstein' : 'Dr. Elena Vargas',
        delegateName: 'Morgan Ellis (Practice Manager)',
        delegateEmail: 'm.ellis@practice.synthetic',
        permissions: ['Submit directory updates', 'Upload roster CSV'],
        expiresAt: '2027-06-30',
        active: true,
      },
    ],
    attestationCampaigns: [
      {
        id: 'att-q4-2026',
        name: 'Q4 2026 Quarterly Directory Accuracy Attestation',
        createdAt: '2026-10-01',
        dueDate: '2026-12-31',
        targetedCount: isTenantB ? 3 : 7,
        attestedCount: isTenantB ? 2 : 4,
        status: 'Active',
      },
    ],
  };

  tenantOpsStore.set(tenantId, state);
  return state;
}

export const ROSTER_CSV_TEMPLATE = [
  'npi,given,family,taxonomyCode,specialty,organizationName,city,state,phone',
  `${buildValidNpi('124531959')},Clara,Bennett,207Q00000X,Family Medicine,Capital Valley Medical Group,Albany,NY,518-555-0181`,
  `${buildValidNpi('199299873')},Owen,Park,207R00000X,Internal Medicine,Capital Valley Medical Group,Troy,NY,518-555-0182`,
].join('\n');

export const providerOpsService = {
  getState(tenantId: string): TenantOpsState {
    return getOrInitOpsState(tenantId);
  },

  resetForTests(tenantId?: string): void {
    if (tenantId) {
      tenantOpsStore.delete(tenantId);
    } else {
      tenantOpsStore.clear();
    }
  },

  saveFilterPreset(tenantId: string, preset: Omit<SavedFilterPreset, 'id'>): SavedFilterPreset {
    const state = getOrInitOpsState(tenantId);
    const created: SavedFilterPreset = {
      ...preset,
      id: `flt-${Date.now()}`,
    };
    state.savedFilters.push(created);
    return created;
  },

  validateRosterRows(rawText: string, format: 'csv' | 'json'): RosterRowValidation[] {
    let parsedRows: RosterRowInput[] = [];
    if (format === 'json') {
      const arr = JSON.parse(rawText) as Array<Partial<RosterRowInput>>;
      if (!Array.isArray(arr)) {
        throw new AppError({
          message: 'Roster JSON must be an array of provider rows.',
          statusCode: 400,
          code: 'INVALID_ROSTER',
        });
      }
      parsedRows = arr.map((item, idx) => ({
        rowNumber: idx + 1,
        npi: String(item.npi ?? '').trim(),
        given: String(item.given ?? '').trim(),
        family: String(item.family ?? '').trim(),
        taxonomyCode: String(item.taxonomyCode ?? '').trim(),
        specialty: String(item.specialty ?? '').trim(),
        organizationName: String(item.organizationName ?? '').trim(),
        city: String(item.city ?? '').trim(),
        state: String(item.state ?? '').trim(),
        phone: String(item.phone ?? '').trim(),
      }));
    } else {
      const { rows } = parseSimpleCsv(rawText);
      parsedRows = rows.map((r, idx) => ({
        rowNumber: idx + 1,
        npi: (r.npi ?? '').trim(),
        given: (r.given ?? '').trim(),
        family: (r.family ?? '').trim(),
        taxonomyCode: (r.taxonomyCode ?? '').trim(),
        specialty: (r.specialty ?? '').trim(),
        organizationName: (r.organizationName ?? '').trim(),
        city: (r.city ?? '').trim(),
        state: (r.state ?? '').trim(),
        phone: (r.phone ?? '').trim(),
      }));
    }

    const seenNpis = new Set<string>();
    return parsedRows.map((row) => {
      const errors: string[] = [];
      if (!row.npi) {
        errors.push('NPI is required.');
      } else if (!validateNpi(row.npi)) {
        errors.push(`NPI '${row.npi}' failed Luhn check digit validation.`);
      } else if (seenNpis.has(row.npi)) {
        errors.push(`Duplicate NPI '${row.npi}' in upload batch.`);
      }
      if (row.npi) seenNpis.add(row.npi);
      if (!row.given) errors.push('Given name is required.');
      if (!row.family) errors.push('Family name is required.');
      if (!row.taxonomyCode || !/^[0-9A-Z]{10}$/.test(row.taxonomyCode)) {
        errors.push('Taxonomy must be a 10-character NUCC code (e.g. 207Q00000X).');
      }
      if (!row.organizationName) errors.push('Organization name is required.');

      return { row, valid: errors.length === 0, errors };
    });
  },

  async commitRoster(
    ctx: FhirRequestContext,
    validations: RosterRowValidation[],
    actor: { name: string; role: RoleName },
  ): Promise<RosterCommitSummary> {
    const client = getFhirClient();
    const existing = await providerService.listProviders(ctx);
    const existingByNpi = new Map(existing.map((p) => [p.npi, p]));

    const summary: RosterCommitSummary = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    const entries: NonNullable<FhirBundle['entry']> = [];

    for (const item of validations) {
      if (!item.valid) {
        summary.failed += 1;
        continue;
      }
      const r = item.row;
      const existingMatch = existingByNpi.get(r.npi);
      const pracUrn = existingMatch
        ? `Practitioner/${existingMatch.id}`
        : `urn:uuid:roster-prac-${r.rowNumber}-${Date.now()}`;

      const practitioner: FhirPractitioner = {
        resourceType: 'Practitioner',
        id: existingMatch?.id,
        active: true,
        identifier: [{ system: NPI_SYSTEM, value: r.npi, use: 'official' }],
        name: [
          {
            use: 'official',
            given: [r.given],
            family: r.family,
            text: `${r.given} ${r.family}`,
          },
        ],
        telecom: r.phone ? [{ system: 'phone', value: r.phone, use: 'work' }] : undefined,
        address: [{ city: r.city, state: r.state }],
        qualification: [
          {
            code: {
              coding: [
                {
                  system: TAXONOMY_SYSTEM,
                  code: r.taxonomyCode,
                  display: r.specialty || r.taxonomyCode,
                },
              ],
            },
          },
        ],
        extension: [
          {
            url: PROVIDER_STATUS_EXT_URL,
            valueCode: existingMatch?.status ?? 'Active',
          },
          { url: ACCEPTING_PATIENTS_EXT_URL, valueBoolean: true },
          { url: LAST_VERIFIED_EXT_URL, valueDateTime: new Date().toISOString().slice(0, 10) },
        ],
      };

      entries.push({
        fullUrl: pracUrn,
        resource: practitioner,
        request: existingMatch
          ? { method: 'PUT', url: `Practitioner/${existingMatch.id}` }
          : { method: 'POST', url: 'Practitioner' },
      });

      const role: FhirPractitionerRole = {
        resourceType: 'PractitionerRole',
        active: true,
        practitioner: { reference: pracUrn, display: `${r.given} ${r.family}` },
        specialty: [
          {
            coding: [
              {
                system: TAXONOMY_SYSTEM,
                code: r.taxonomyCode,
                display: r.specialty || r.taxonomyCode,
              },
            ],
          },
        ],
      };
      entries.push({
        fullUrl: `urn:uuid:roster-role-${r.rowNumber}-${Date.now()}`,
        resource: role,
        request: { method: 'POST', url: 'PractitionerRole' },
      });

      const affiliation: FhirOrganizationAffiliation = {
        resourceType: 'OrganizationAffiliation',
        active: true,
        period: { start: new Date().toISOString().slice(0, 10) },
        specialty: [
          {
            coding: [
              {
                system: TAXONOMY_SYSTEM,
                code: r.taxonomyCode,
                display: r.specialty || r.taxonomyCode,
              },
            ],
          },
        ],
      };
      entries.push({
        fullUrl: `urn:uuid:roster-aff-${r.rowNumber}-${Date.now()}`,
        resource: affiliation,
        request: { method: 'POST', url: 'OrganizationAffiliation' },
      });

      if (existingMatch) {
        summary.updated += 1;
      } else {
        summary.created += 1;
      }
    }

    if (entries.length > 0) {
      await client.transaction(ctx, {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: entries,
      });
      await auditService.record({
        ctx,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'create',
        resourceType: 'Bundle',
        outcomeDesc: `Roster upload committed: ${summary.created} created, ${summary.updated} updated, ${summary.failed} failed`,
      });
    }

    return summary;
  },

  addAffiliation(
    tenantId: string,
    input: Omit<AffiliationRecord, 'id'>,
  ): AffiliationRecord {
    const state = getOrInitOpsState(tenantId);
    // Overlap validation for same practitioner + organization
    const overlapping = state.affiliations.find((existing) => {
      if (
        existing.practitionerId !== input.practitionerId ||
        existing.organizationId !== input.organizationId
      ) {
        return false;
      }
      const aStart = existing.startDate;
      const aEnd = existing.endDate || '9999-12-31';
      const bStart = input.startDate;
      const bEnd = input.endDate || '9999-12-31';
      return aStart <= bEnd && bStart <= aEnd;
    });

    if (overlapping) {
      throw new AppError({
        message: `Overlapping affiliation period detected with existing ${overlapping.organizationName} affiliation (${overlapping.startDate} to ${overlapping.endDate ?? 'present'}).`,
        statusCode: 409,
        code: 'AFFILIATION_OVERLAP',
      });
    }

    const created: AffiliationRecord = {
      ...input,
      id: `aff-rec-${Date.now()}`,
    };
    state.affiliations.unshift(created);
    return created;
  },

  bulkUpdateNetworkParticipation(
    tenantId: string,
    ids: string[],
    patch: Partial<Pick<NetworkParticipationRecord, 'status' | 'acceptingNewPatients' | 'panelSizeLimit'>>,
  ): NetworkParticipationRecord[] {
    const state = getOrInitOpsState(tenantId);
    const idSet = new Set(ids);
    state.networkParticipations = state.networkParticipations.map((rec) =>
      idSet.has(rec.id) ? { ...rec, ...patch } : rec,
    );
    eventBus.publish({
      type: 'NetworkChanged',
      tenantId,
      sourceModule: 'M22',
      payload: { updatedCount: ids.length, patch },
    });
    return state.networkParticipations;
  },

  async submitChangeRequest(
    ctx: FhirRequestContext,
    input: {
      practitionerId: string;
      practitionerName: string;
      field: SelfServiceField;
      beforeValue: string;
      afterValue: string;
    },
    actor: { name: string; role: RoleName },
  ): Promise<ChangeRequestRecord> {
    const client = getFhirClient();
    const tenant = tenantService.getTenantById(ctx.tenantId);
    const autoFields = tenant?.businessRules.autoApproveSelfServiceFields ?? [];
    const isOwnership = input.field === 'ownershipChange';
    const isBanking = input.field === 'bankingDetails';
    const autoApprove = !isOwnership && !isBanking && autoFields.includes(input.field);

    const status: ChangeRequestRecord['status'] = isOwnership
      ? 'RoutedToEnrollment'
      : autoApprove
        ? 'AutoApplied'
        : 'PendingApproval';

    const task: FhirTask = {
      resourceType: 'Task',
      status: autoApprove ? 'completed' : 'requested',
      intent: 'order',
      code: {
        coding: [
          {
            system: 'http://providerlink.local/CodeSystem/task-type',
            code: isOwnership ? 'enrollment-ownership-change' : 'provider-self-service-change',
            display: `Change Request: ${input.field}`,
          },
        ],
      },
      description: `${input.field}: "${input.beforeValue}" -> "${input.afterValue}"`,
      for: { reference: `Practitioner/${input.practitionerId}`, display: input.practitionerName },
      authoredOn: new Date().toISOString(),
      input: [
        { type: { text: 'before' }, valueString: input.beforeValue },
        { type: { text: 'after' }, valueString: input.afterValue },
      ],
    };

    const createdTask = await client.create(ctx, task);
    const record: ChangeRequestRecord = {
      id: `cr-${Date.now()}`,
      taskId: createdTask.id ?? '',
      practitionerId: input.practitionerId,
      practitionerName: input.practitionerName,
      field: input.field,
      beforeValue: input.beforeValue,
      afterValue: input.afterValue,
      status,
      requiresApproval: !autoApprove,
      requestedBy: `${actor.name} (${actor.role})`,
      requestedAt: new Date().toISOString(),
      reviewedBy: autoApprove ? 'Tenant Auto-Approval Rule' : undefined,
    };

    if (autoApprove) {
      await this.applyChangeToFhir(ctx, record, actor);
    }

    const state = getOrInitOpsState(ctx.tenantId);
    state.changeRequests.unshift(record);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Task',
      resourceId: createdTask.id,
      outcomeDesc: `Change request (${input.field}) status: ${status}`,
    });

    return record;
  },

  async approveChangeRequest(
    ctx: FhirRequestContext,
    changeRequestId: string,
    actor: { name: string; role: RoleName },
  ): Promise<ChangeRequestRecord> {
    const state = getOrInitOpsState(ctx.tenantId);
    const req = state.changeRequests.find((c) => c.id === changeRequestId);
    if (!req) {
      throw new AppError({ message: 'Change request not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    req.status = 'Approved';
    req.reviewedBy = `${actor.name} (${actor.role})`;
    await this.applyChangeToFhir(ctx, req, actor);
    return req;
  },

  async applyChangeToFhir(
    ctx: FhirRequestContext,
    req: ChangeRequestRecord,
    actor: { name: string; role: RoleName },
  ): Promise<void> {
    const client = getFhirClient();
    const prac = await client.read<FhirPractitioner>(
      ctx,
      'Practitioner',
      req.practitionerId,
    );
    const updated: FhirPractitioner = { ...prac };

    if (req.field === 'phone') {
      updated.telecom = [
        ...(prac.telecom ?? []).filter((t) => t.system !== 'phone'),
        { system: 'phone', value: req.afterValue, use: 'work' },
      ];
    } else if (req.field === 'acceptingNewPatients') {
      updated.extension = [
        ...(prac.extension ?? []).filter((e) => e.url !== ACCEPTING_PATIENTS_EXT_URL),
        { url: ACCEPTING_PATIENTS_EXT_URL, valueBoolean: req.afterValue === 'true' },
      ];
    } else if (req.field === 'address') {
      const currentAddr = prac.address?.[0] ?? {};
      updated.address = [{ ...currentAddr, line: [req.afterValue] }];
    }

    await client.update(ctx, updated);

    const prov: FhirProvenance = {
      resourceType: 'Provenance',
      target: [{ reference: `Practitioner/${req.practitionerId}` }],
      recorded: new Date().toISOString(),
      reason: [{ text: `Applied self-service change for ${req.field}` }],
      agent: [{ who: { display: `${actor.name} (${actor.role})` } }],
    };
    await client.create(ctx, prov);
  },

  async changeProviderStatus(
    ctx: FhirRequestContext,
    practitionerId: string,
    newStatus: ProviderEnrollmentStatus,
    reason: string,
    effectiveDate: string,
    actor: { name: string; role: RoleName },
  ): Promise<ProviderDirectoryRow> {
    if (!reason.trim()) {
      throw new AppError({
        message: 'A reason is required for provider status transitions.',
        statusCode: 400,
        code: 'REASON_REQUIRED',
      });
    }
    const client = getFhirClient();
    const current = await client.read<FhirPractitioner>(
      ctx,
      'Practitioner',
      practitionerId,
    );
    const prevRow = await providerService
      .listProviders(ctx)
      .then((all) => all.find((p) => p.id === practitionerId));
    const previousStatus = prevRow?.status ?? 'Active';

    const updated: FhirPractitioner = {
      ...current,
      active: newStatus === 'Active' || newStatus === 'Revalidation Due',
      extension: [
        ...(current.extension ?? []).filter((e) => e.url !== PROVIDER_STATUS_EXT_URL),
        {
          url: PROVIDER_STATUS_EXT_URL,
          valueCode: newStatus,
          extension: [
            { url: 'effectivePeriod', valuePeriod: { start: effectiveDate } },
            { url: 'reason', valueString: reason },
          ],
        },
      ],
    };
    const saved = await client.update(ctx, updated);

    await client.create<FhirProvenance>(ctx, {
      resourceType: 'Provenance',
      target: [{ reference: `Practitioner/${practitionerId}` }],
      recorded: new Date().toISOString(),
      reason: [{ text: `${previousStatus} -> ${newStatus}: ${reason}` }],
      agent: [{ who: { display: `${actor.name} (${actor.role})` } }],
    });

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Practitioner',
      resourceId: practitionerId,
      outcomeDesc: `Provider status changed ${previousStatus} -> ${newStatus} (effective ${effectiveDate})`,
    });

    eventBus.publish({
      type: 'ProviderStatusChanged',
      tenantId: ctx.tenantId,
      sourceModule: 'M22',
      payload: {
        practitionerId,
        previousStatus,
        newStatus,
        reason,
        effectiveDate,
        claimsBlocked: newStatus !== 'Active',
      },
    });

    const refreshed = await providerService.listProviders(ctx);
    return refreshed.find((p) => p.id === saved.id) ?? prevRow!;
  },

  async sendTargetedMessage(
    ctx: FhirRequestContext,
    recipientIds: string[],
    subject: string,
    body: string,
    actor: { name: string; role: RoleName },
  ): Promise<FhirCommunication> {
    const client = getFhirClient();
    const comm: FhirCommunication = {
      resourceType: 'Communication',
      status: 'completed',
      category: [{ text: 'Targeted Provider Message' }],
      sent: new Date().toISOString(),
      recipient: recipientIds.map((id) => ({ reference: `Practitioner/${id}` })),
      sender: { display: `${actor.name} (${actor.role})` },
      payload: [{ contentString: `[${subject}] ${body}` }],
    };
    const created = await client.create(ctx, comm);
    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Communication',
      resourceId: created.id,
      outcomeDesc: `Sent targeted message '${subject}' to ${recipientIds.length} provider(s)`,
    });
    return created;
  },

  async listMessages(ctx: FhirRequestContext): Promise<FhirCommunication[]> {
    const client = getFhirClient();
    const res = await client.search<FhirCommunication>(ctx, 'Communication', {
      _count: 100,
    });
    return res.resources;
  },

  computeDataQualityScores(
    providers: ProviderDirectoryRow[],
    staleThresholdDays = 90,
  ): DataQualityScore[] {
    const nowMs = Date.now();
    return providers.map((p) => {
      const missing: string[] = [];
      let score = 100;
      if (!p.npi || !validateNpi(p.npi)) {
        missing.push('Valid NPI');
        score -= 25;
      }
      if (!p.phone) {
        missing.push('Phone');
        score -= 15;
      }
      if (!p.email) {
        missing.push('Email');
        score -= 10;
      }
      if (!p.street || !p.city || !p.state) {
        missing.push('Complete Address');
        score -= 20;
      }
      if (!p.taxonomyCode) {
        missing.push('Taxonomy Code');
        score -= 15;
      }
      if (!p.licenseNumber) {
        missing.push('State License');
        score -= 15;
      }

      const verifiedMs = p.lastVerifiedDate
        ? Date.parse(p.lastVerifiedDate)
        : 0;
      const daysSinceVerified = verifiedMs
        ? Math.max(0, Math.floor((nowMs - verifiedMs) / (1000 * 60 * 60 * 24)))
        : 999;

      return {
        practitionerId: p.id,
        fullName: p.fullName,
        npi: p.npi,
        score: Math.max(0, score),
        missingFields: missing,
        daysSinceVerified,
        isStale: daysSinceVerified > staleThresholdDays,
      };
    });
  },

  launchAttestationCampaign(
    tenantId: string,
    name: string,
    dueDate: string,
    targetedCount: number,
  ): AttestationCampaign {
    const state = getOrInitOpsState(tenantId);
    const created: AttestationCampaign = {
      id: `att-${Date.now()}`,
      name,
      createdAt: new Date().toISOString().slice(0, 10),
      dueDate,
      targetedCount,
      attestedCount: 0,
      status: 'Active',
    };
    state.attestationCampaigns.unshift(created);
    return created;
  },

  addDelegatedUser(
    tenantId: string,
    input: Omit<DelegatedUserRecord, 'id'>,
  ): DelegatedUserRecord {
    const state = getOrInitOpsState(tenantId);
    const created: DelegatedUserRecord = {
      ...input,
      id: `del-${Date.now()}`,
    };
    state.delegatedUsers.unshift(created);
    return created;
  },
};
