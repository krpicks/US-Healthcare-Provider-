import {
  ALL_FHIR_RESOURCE_TYPES,
  AppError,
  type FhirBundle,
  type FhirBundleEntry,
  type FhirCapabilityStatement,
  type FhirCodeableConcept,
  type FhirCoding,
  type FhirOperationOutcome,
  type FhirOperationOutcomeIssue,
  type FhirResource,
  type FhirResourceType,
} from '../types';
import type {
  FhirClient,
  FhirPagedResult,
  FhirPatchOperation,
  FhirRequestContext,
  FhirSearchParams,
} from './FhirClient';
import { fhirRequestLog } from './requestLog';

type TenantStore = Map<FhirResourceType, Map<string, FhirResource[]>>;

const VALID_GENDERS = new Set(['male', 'female', 'other', 'unknown']);
const VALID_BUNDLE_TYPES = new Set([
  'document',
  'message',
  'transaction',
  'transaction-response',
  'batch',
  'batch-response',
  'history',
  'searchset',
  'collection',
]);
const VALID_OBS_STATUS = new Set([
  'registered',
  'preliminary',
  'final',
  'amended',
  'corrected',
  'cancelled',
  'entered-in-error',
  'unknown',
]);
const VALID_ENCOUNTER_STATUS = new Set([
  'planned',
  'arrived',
  'triaged',
  'in-progress',
  'onleave',
  'finished',
  'cancelled',
  'entered-in-error',
  'unknown',
]);
const VALID_TASK_STATUS = new Set([
  'draft',
  'requested',
  'received',
  'accepted',
  'rejected',
  'ready',
  'cancelled',
  'in-progress',
  'on-hold',
  'failed',
  'completed',
  'entered-in-error',
]);
const VALID_PLAN_STATUS = new Set(['draft', 'active', 'retired', 'unknown']);

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function generateResourceId(resourceType: string): string {
  const prefix = resourceType.toLowerCase().slice(0, 6);
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function extractSearchStrings(resource: FhirResource, param: string): string[] {
  const r = resource as Record<string, unknown>;
  switch (param) {
    case 'name': {
      const results: string[] = [];
      if (typeof r.name === 'string') {
        results.push(r.name);
      } else if (Array.isArray(r.name)) {
        for (const n of r.name as Array<Record<string, unknown>>) {
          if (typeof n.text === 'string') results.push(n.text);
          if (typeof n.family === 'string') results.push(n.family);
          if (Array.isArray(n.given)) {
            results.push(...(n.given as string[]));
          }
        }
      }
      return results;
    }
    case 'family':
      return Array.isArray(r.name)
        ? (r.name as Array<{ family?: string }>)
            .map((n) => n.family)
            .filter((v): v is string => Boolean(v))
        : [];
    case 'given':
      return Array.isArray(r.name)
        ? (r.name as Array<{ given?: string[] }>).flatMap((n) => n.given ?? [])
        : [];
    case 'address-city':
    case 'city':
      if (r.address && !Array.isArray(r.address)) {
        const city = (r.address as { city?: string }).city;
        return city ? [city] : [];
      }
      return Array.isArray(r.address)
        ? (r.address as Array<{ city?: string }>)
            .map((a) => a.city)
            .filter((v): v is string => Boolean(v))
        : [];
    case 'address-state':
    case 'state':
      if (r.address && !Array.isArray(r.address)) {
        const st = (r.address as { state?: string }).state;
        return st ? [st] : [];
      }
      return Array.isArray(r.address)
        ? (r.address as Array<{ state?: string }>)
            .map((a) => a.state)
            .filter((v): v is string => Boolean(v))
        : [];
    case 'title':
      return typeof r.title === 'string' ? [r.title] : [];
    default: {
      const val = r[param];
      if (typeof val === 'string') return [val];
      if (typeof val === 'number' || typeof val === 'boolean') return [String(val)];
      return [];
    }
  }
}

function extractTokens(
  resource: FhirResource,
  param: string,
): Array<{ system?: string; code?: string }> {
  const r = resource as Record<string, unknown>;
  const tokens: Array<{ system?: string; code?: string }> = [];

  const pushCoding = (c?: FhirCoding) => {
    if (!c) return;
    tokens.push({ system: c.system, code: c.code });
  };
  const pushConcept = (cc?: FhirCodeableConcept) => {
    if (!cc) return;
    cc.coding?.forEach(pushCoding);
    if (cc.text) tokens.push({ code: cc.text });
  };

  if (param === 'identifier') {
    const ids = Array.isArray(r.identifier)
      ? r.identifier
      : r.identifier
        ? [r.identifier]
        : [];
    for (const id of ids as Array<{ system?: string; value?: string }>) {
      tokens.push({ system: id.system, code: id.value });
    }
    return tokens;
  }

  if (param === 'code' || param === 'specialty' || param === 'type' || param === 'category') {
    const field = r[param];
    if (Array.isArray(field)) {
      for (const item of field) {
        if (item && typeof item === 'object') {
          if ('coding' in item || 'text' in item) {
            pushConcept(item as FhirCodeableConcept);
          } else if ('code' in item) {
            pushCoding(item as FhirCoding);
          }
        }
      }
    } else if (field && typeof field === 'object') {
      if ('coding' in field || 'text' in field) {
        pushConcept(field as FhirCodeableConcept);
      } else if ('code' in field) {
        pushCoding(field as FhirCoding);
      }
    }
    return tokens;
  }

  if (param === 'status') {
    if (typeof r.status === 'string') {
      tokens.push({ code: r.status });
    }
    // Also inspect provider enrollment status extension
    if (Array.isArray(resource.extension)) {
      const ext = resource.extension.find((e) =>
        e.url.includes('provider-enrollment-status'),
      );
      if (ext?.valueCode) tokens.push({ code: ext.valueCode });
      if (ext?.valueString) tokens.push({ code: ext.valueString });
    }
    return tokens;
  }

  if (param === 'gender' || param === 'active' || param === 'action' || param === 'outcome') {
    const val = r[param];
    if (val !== undefined && val !== null) {
      tokens.push({ code: String(val) });
    }
    return tokens;
  }

  const direct = r[param];
  if (typeof direct === 'string' || typeof direct === 'boolean' || typeof direct === 'number') {
    tokens.push({ code: String(direct) });
  } else if (direct && typeof direct === 'object') {
    if ('coding' in direct || 'text' in direct) {
      pushConcept(direct as FhirCodeableConcept);
    } else if ('code' in direct) {
      pushCoding(direct as FhirCoding);
    }
  }
  return tokens;
}

function extractReferences(resource: FhirResource, param: string): string[] {
  const r = resource as Record<string, unknown>;
  const fieldMap: Record<string, string[]> = {
    patient: ['subject', 'patient', 'beneficiary', 'for'],
    subject: ['subject', 'patient', 'beneficiary'],
    practitioner: ['practitioner'],
    organization: ['organization', 'managingOrganization', 'ownedBy', 'administeredBy', 'serviceProvider', 'insurer', 'provider'],
    'participating-organization': ['participatingOrganization'],
    location: ['location'],
    encounter: ['encounter'],
    network: ['network'],
    focus: ['focus'],
    owner: ['owner'],
    target: ['target'],
  };
  const keys = fieldMap[param] ?? [param];
  const refs: string[] = [];

  for (const key of keys) {
    const val = r[key];
    if (!val) continue;
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object' && typeof (item as { reference?: string }).reference === 'string') {
          refs.push((item as { reference: string }).reference);
        }
      }
    } else if (typeof val === 'object' && typeof (val as { reference?: string }).reference === 'string') {
      refs.push((val as { reference: string }).reference);
    }
  }
  return refs;
}

function extractDateValues(resource: FhirResource, param: string): string[] {
  const r = resource as Record<string, unknown>;
  if (param === '_lastUpdated') {
    return resource.meta?.lastUpdated ? [resource.meta.lastUpdated] : [];
  }
  const dateFieldMap: Record<string, string[]> = {
    birthdate: ['birthDate'],
    date: ['date', 'recorded', 'effectiveDateTime', 'authoredOn', 'recordedDate', 'onsetDateTime', 'performedDateTime', 'created', 'sent', 'dateTime'],
    'recorded-date': ['recordedDate', 'recorded'],
    authored: ['authored', 'authoredOn'],
  };
  const keys = dateFieldMap[param] ?? [param];
  const dates: string[] = [];
  for (const key of keys) {
    const val = r[key];
    if (typeof val === 'string') {
      dates.push(val);
    } else if (val && typeof val === 'object' && typeof (val as { start?: string }).start === 'string') {
      dates.push((val as { start: string }).start);
    }
  }
  if (param === 'date' && r.period && typeof r.period === 'object') {
    const p = r.period as { start?: string; end?: string };
    if (p.start) dates.push(p.start);
  }
  return dates;
}

function matchesDateCriteria(candidateIso: string, rawCriteria: string): boolean {
  const prefixMatch = rawCriteria.match(/^(eq|ne|gt|ge|lt|le)(.+)$/);
  const op = prefixMatch ? prefixMatch[1] : 'eq';
  const targetStr = prefixMatch ? prefixMatch[2] : rawCriteria;

  const candidateDate = candidateIso.slice(0, 10);
  const targetDate = targetStr.slice(0, 10);

  // Full timestamp comparison if both include time component
  const useTimestamp = candidateIso.includes('T') && targetStr.includes('T');
  const left = useTimestamp ? Date.parse(candidateIso) : Date.parse(candidateDate);
  const right = useTimestamp ? Date.parse(targetStr) : Date.parse(targetDate);

  if (Number.isNaN(left) || Number.isNaN(right)) {
    return candidateIso.startsWith(targetStr);
  }

  switch (op) {
    case 'eq':
      return left === right;
    case 'ne':
      return left !== right;
    case 'gt':
      return left > right;
    case 'ge':
      return left >= right;
    case 'lt':
      return left < right;
    case 'le':
      return left <= right;
    default:
      return left === right;
  }
}

function matchesNumberCriteria(candidate: number, rawCriteria: string): boolean {
  const prefixMatch = rawCriteria.match(/^(eq|ne|gt|ge|lt|le)(.+)$/);
  const op = prefixMatch ? prefixMatch[1] : 'eq';
  const num = Number(prefixMatch ? prefixMatch[2] : rawCriteria);
  if (Number.isNaN(num)) return false;

  switch (op) {
    case 'eq':
      return candidate === num;
    case 'ne':
      return candidate !== num;
    case 'gt':
      return candidate > num;
    case 'ge':
      return candidate >= num;
    case 'lt':
      return candidate < num;
    case 'le':
      return candidate <= num;
    default:
      return candidate === num;
  }
}

function replaceUrnUuids(node: unknown, map: Map<string, string>): unknown {
  if (typeof node === 'string') {
    return map.get(node) ?? node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => replaceUrnUuids(item, map));
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = replaceUrnUuids(v, map);
    }
    return out;
  }
  return node;
}

function collectReferenceStrings(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((item) => collectReferenceStrings(item, found));
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (typeof obj.reference === 'string') {
      found.push(obj.reference);
    }
    for (const val of Object.values(obj)) {
      collectReferenceStrings(val, found);
    }
  }
  return found;
}

function collectCodings(node: unknown, found: Array<{ path: string; coding: FhirCoding }> = [], path = ''): Array<{ path: string; coding: FhirCoding }> {
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectCodings(item, found, `${path}[${idx}]`));
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.coding)) {
      obj.coding.forEach((c, idx) => {
        if (c && typeof c === 'object') {
          found.push({ path: `${path}.coding[${idx}]`, coding: c as FhirCoding });
        }
      });
    }
    for (const [k, val] of Object.entries(obj)) {
      if (k !== 'coding') {
        collectCodings(val, found, path ? `${path}.${k}` : k);
      }
    }
  }
  return found;
}

function applyJsonPatch(target: Record<string, unknown>, ops: FhirPatchOperation[]): Record<string, unknown> {
  const clone = deepClone(target);
  for (const op of ops) {
    const segments = op.path.replace(/^\//, '').split('/').filter(Boolean);
    if (segments.length === 0) continue;
    let cursor: Record<string, unknown> = clone;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      if (cursor[seg] === undefined || cursor[seg] === null || typeof cursor[seg] !== 'object') {
        cursor[seg] = {};
      }
      cursor = cursor[seg] as Record<string, unknown>;
    }
    const leaf = segments[segments.length - 1];
    if (op.op === 'add' || op.op === 'replace') {
      if (Array.isArray(cursor) && leaf === '-') {
        cursor.push(op.value);
      } else {
        cursor[leaf] = op.value;
      }
    } else if (op.op === 'remove') {
      if (Array.isArray(cursor)) {
        const idx = Number(leaf);
        if (!Number.isNaN(idx)) cursor.splice(idx, 1);
      } else {
        delete cursor[leaf];
      }
    } else if (op.op === 'test') {
      if (JSON.stringify(cursor[leaf]) !== JSON.stringify(op.value)) {
        throw new AppError({
          message: `JSON Patch test operation failed at ${op.path}`,
          statusCode: 412,
          code: 'PATCH_TEST_FAILED',
        });
      }
    }
  }
  return clone;
}

function getSortComparable(resource: FhirResource, field: string): string | number {
  if (field === '_lastUpdated') return resource.meta?.lastUpdated ?? '';
  if (field === '_id') return resource.id ?? '';
  const strings = extractSearchStrings(resource, field);
  if (strings.length > 0) return strings[0].toLowerCase();
  const dates = extractDateValues(resource, field);
  if (dates.length > 0) return dates[0];
  const val = (resource as Record<string, unknown>)[field];
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return val.toLowerCase();
  return '';
}

export class MockFhirClient implements FhirClient {
  public readonly mode = 'mock' as const;
  private tenantStores = new Map<string, TenantStore>();

  private requireTenantStore(ctx: FhirRequestContext): TenantStore {
    if (!ctx || !ctx.tenantId || !ctx.tenantId.trim()) {
      throw new AppError({
        message: 'TenantContext is required for all FHIR operations.',
        statusCode: 403,
        code: 'TENANT_CONTEXT_REQUIRED',
      });
    }
    let store = this.tenantStores.get(ctx.tenantId);
    if (!store) {
      store = new Map<FhirResourceType, Map<string, FhirResource[]>>();
      this.tenantStores.set(ctx.tenantId, store);
    }
    return store;
  }

  private getTypeBucket(
    store: TenantStore,
    resourceType: FhirResourceType,
  ): Map<string, FhirResource[]> {
    let bucket = store.get(resourceType);
    if (!bucket) {
      bucket = new Map<string, FhirResource[]>();
      store.set(resourceType, bucket);
    }
    return bucket;
  }

  public clearTenantStore(tenantId: string): void {
    this.tenantStores.delete(tenantId);
  }

  public hasTenantStore(tenantId: string): boolean {
    return this.tenantStores.has(tenantId);
  }

  public getTenantResourceCounts(tenantId: string): Record<string, number> {
    const store = this.tenantStores.get(tenantId);
    const counts: Record<string, number> = {};
    if (!store) return counts;
    for (const [type, bucket] of store.entries()) {
      counts[type] = bucket.size;
    }
    return counts;
  }

  public exportTenantBundle(ctx: FhirRequestContext): FhirBundle {
    const store = this.requireTenantStore(ctx);
    const entries: FhirBundleEntry[] = [];
    for (const [, bucket] of store.entries()) {
      for (const versions of bucket.values()) {
        const latest = versions[versions.length - 1];
        if (latest) {
          entries.push({
            fullUrl: `${latest.resourceType}/${latest.id}`,
            resource: deepClone(latest),
          });
        }
      }
    }
    return {
      resourceType: 'Bundle',
      type: 'collection',
      timestamp: new Date().toISOString(),
      total: entries.length,
      entry: entries,
    };
  }

  public async capabilities(ctx: FhirRequestContext): Promise<FhirCapabilityStatement> {
    const started = performance.now();
    this.requireTenantStore(ctx);
    const statement: FhirCapabilityStatement = {
      resourceType: 'CapabilityStatement',
      id: `mock-cap-${ctx.tenantCode}`,
      status: 'active',
      date: new Date().toISOString(),
      kind: 'instance',
      fhirVersion: '4.0.1',
      format: ['application/fhir+json'],
      software: {
        name: 'ProviderLink Mock FHIR R4 Store',
        version: '1.0.0',
      },
      rest: [
        {
          mode: 'server',
          resource: ALL_FHIR_RESOURCE_TYPES.map((type) => ({
            type,
            interaction: [
              { code: 'read' },
              { code: 'vread' },
              { code: 'update' },
              { code: 'patch' },
              { code: 'delete' },
              { code: 'history-instance' },
              { code: 'create' },
              { code: 'search-type' },
            ],
            searchParam: [
              { name: '_id', type: 'token' },
              { name: '_lastUpdated', type: 'date' },
              { name: 'identifier', type: 'token' },
              { name: 'status', type: 'token' },
              { name: 'name', type: 'string' },
            ],
          })),
        },
      ],
    };
    fhirRequestLog.record({
      mode: 'mock',
      tenantId: ctx.tenantId,
      tenantCode: ctx.tenantCode,
      method: 'GET',
      url: `/${ctx.tenantCode}/metadata`,
      status: 200,
      durationMs: Math.round(performance.now() - started),
    });
    return statement;
  }

  public async create<T extends FhirResource>(
    ctx: FhirRequestContext,
    resource: T,
  ): Promise<T> {
    const started = performance.now();
    const store = this.requireTenantStore(ctx);
    const bucket = this.getTypeBucket(store, resource.resourceType);

    const id = resource.id && !bucket.has(resource.id)
      ? resource.id
      : generateResourceId(resource.resourceType);

    const stored: T = deepClone({
      ...resource,
      id,
      meta: {
        ...(resource.meta ?? {}),
        versionId: '1',
        lastUpdated: new Date().toISOString(),
      },
    });

    bucket.set(id, [stored]);
    fhirRequestLog.record({
      mode: 'mock',
      tenantId: ctx.tenantId,
      tenantCode: ctx.tenantCode,
      method: 'POST',
      url: `/${ctx.tenantCode}/${resource.resourceType}`,
      status: 201,
      durationMs: Math.round(performance.now() - started),
    });
    return deepClone(stored);
  }

  public async conditionalCreate<T extends FhirResource>(
    ctx: FhirRequestContext,
    resource: T,
    searchParams: FhirSearchParams,
  ): Promise<{ resource: T; created: boolean }> {
    const existing = await this.search<T>(ctx, resource.resourceType, searchParams);
    if (existing.resources.length > 0) {
      return { resource: existing.resources[0], created: false };
    }
    const created = await this.create(ctx, resource);
    return { resource: created, created: true };
  }

  public async read<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id: string,
  ): Promise<T> {
    const started = performance.now();
    const store = this.requireTenantStore(ctx);
    const versions = store.get(resourceType)?.get(id);
    if (!versions || versions.length === 0) {
      const outcome: FhirOperationOutcome = {
        resourceType: 'OperationOutcome',
        issue: [
          {
            severity: 'error',
            code: 'not-found',
            diagnostics: `${resourceType}/${id} was not found in tenant ${ctx.tenantCode}.`,
          },
        ],
      };
      fhirRequestLog.record({
        mode: 'mock',
        tenantId: ctx.tenantId,
        tenantCode: ctx.tenantCode,
        method: 'GET',
        url: `/${ctx.tenantCode}/${resourceType}/${id}`,
        status: 404,
        durationMs: Math.round(performance.now() - started),
        outcomeSummary: outcome.issue[0].diagnostics,
        outcome,
      });
      throw new AppError({
        message: outcome.issue[0].diagnostics ?? 'Resource not found',
        statusCode: 404,
        code: 'NOT_FOUND',
        correlationId: ctx.correlationId,
        rawOutcome: outcome,
      });
    }

    fhirRequestLog.record({
      mode: 'mock',
      tenantId: ctx.tenantId,
      tenantCode: ctx.tenantCode,
      method: 'GET',
      url: `/${ctx.tenantCode}/${resourceType}/${id}`,
      status: 200,
      durationMs: Math.round(performance.now() - started),
    });
    return deepClone(versions[versions.length - 1] as T);
  }

  public async vread<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id: string,
    versionId: string,
  ): Promise<T> {
    const started = performance.now();
    const store = this.requireTenantStore(ctx);
    const versions = store.get(resourceType)?.get(id);
    const match = versions?.find((v) => v.meta?.versionId === versionId);
    if (!match) {
      throw new AppError({
        message: `${resourceType}/${id}/_history/${versionId} not found.`,
        statusCode: 404,
        code: 'VERSION_NOT_FOUND',
        correlationId: ctx.correlationId,
      });
    }
    fhirRequestLog.record({
      mode: 'mock',
      tenantId: ctx.tenantId,
      tenantCode: ctx.tenantCode,
      method: 'GET',
      url: `/${ctx.tenantCode}/${resourceType}/${id}/_history/${versionId}`,
      status: 200,
      durationMs: Math.round(performance.now() - started),
    });
    return deepClone(match as T);
  }

  public async update<T extends FhirResource>(
    ctx: FhirRequestContext,
    resource: T,
  ): Promise<T> {
    const started = performance.now();
    const store = this.requireTenantStore(ctx);
    if (!resource.id) {
      throw new AppError({
        message: 'Resource id is required for update.',
        statusCode: 400,
        code: 'MISSING_ID',
      });
    }
    const bucket = this.getTypeBucket(store, resource.resourceType);
    const existing = bucket.get(resource.id) ?? [];
    const nextVersion = String(existing.length + 1);
    const updated: T = deepClone({
      ...resource,
      meta: {
        ...(resource.meta ?? {}),
        versionId: nextVersion,
        lastUpdated: new Date().toISOString(),
      },
    });
    existing.push(updated);
    bucket.set(resource.id, existing);

    fhirRequestLog.record({
      mode: 'mock',
      tenantId: ctx.tenantId,
      tenantCode: ctx.tenantCode,
      method: 'PUT',
      url: `/${ctx.tenantCode}/${resource.resourceType}/${resource.id}`,
      status: existing.length === 1 ? 201 : 200,
      durationMs: Math.round(performance.now() - started),
    });
    return deepClone(updated);
  }

  public async patch<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id: string,
    operations: FhirPatchOperation[],
  ): Promise<T> {
    const current = await this.read<T>(ctx, resourceType, id);
    const patched = applyJsonPatch(
      current as Record<string, unknown>,
      operations,
    ) as T;
    return this.update(ctx, patched);
  }

  public async delete(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id: string,
  ): Promise<void> {
    const started = performance.now();
    const store = this.requireTenantStore(ctx);
    const bucket = store.get(resourceType);
    if (!bucket || !bucket.has(id)) {
      throw new AppError({
        message: `${resourceType}/${id} not found for deletion.`,
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    }
    bucket.delete(id);
    fhirRequestLog.record({
      mode: 'mock',
      tenantId: ctx.tenantId,
      tenantCode: ctx.tenantCode,
      method: 'DELETE',
      url: `/${ctx.tenantCode}/${resourceType}/${id}`,
      status: 204,
      durationMs: Math.round(performance.now() - started),
    });
  }

  public async search<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    params: FhirSearchParams = {},
  ): Promise<FhirPagedResult<T>> {
    return this.executeSearchPage<T>(ctx, resourceType, params, 0);
  }

  private async executeSearchPage<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    params: FhirSearchParams,
    offset: number,
  ): Promise<FhirPagedResult<T>> {
    const started = performance.now();
    const store = this.requireTenantStore(ctx);
    const bucket = store.get(resourceType);
    const allLatest: T[] = [];
    if (bucket) {
      for (const versions of bucket.values()) {
        const latest = versions[versions.length - 1];
        if (latest) allLatest.push(deepClone(latest as T));
      }
    }

    const filtered = allLatest.filter((resource) =>
      this.matchesParams(resource, params),
    );

    const sortParam = typeof params._sort === 'string' ? params._sort : undefined;
    if (sortParam) {
      const desc = sortParam.startsWith('-');
      const field = desc ? sortParam.slice(1) : sortParam;
      filtered.sort((a, b) => {
        const va = getSortComparable(a, field);
        const vb = getSortComparable(b, field);
        const cmp =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb));
        return desc ? -cmp : cmp;
      });
    }

    const total = filtered.length;
    const summaryCount = params._summary === 'count';
    const count =
      typeof params._count === 'number'
        ? params._count
        : typeof params._count === 'string' && !Number.isNaN(Number(params._count))
          ? Math.max(1, Number(params._count))
          : 50;

    const pageItems = summaryCount ? [] : filtered.slice(offset, offset + count);

    const entries: FhirBundleEntry<T>[] = pageItems.map((res) => ({
      fullUrl: `${res.resourceType}/${res.id}`,
      resource: res,
      search: { mode: 'match' },
    }));

    // Handle _include (e.g. PractitionerRole:practitioner)
    const includeParams = this.normalizeParamArray(params._include);
    const includedKeys = new Set<string>();
    if (!summaryCount && includeParams.length > 0) {
      for (const inc of includeParams) {
        const parts = inc.split(':');
        const sourceType = parts[0];
        const searchField = parts[1];
        if (!searchField || (sourceType !== '*' && sourceType !== resourceType)) continue;
        for (const item of pageItems) {
          const refs = extractReferences(item, searchField);
          for (const ref of refs) {
            const [targetType, targetId] = ref.split('/');
            if (!targetType || !targetId) continue;
            const key = `${targetType}/${targetId}`;
            if (includedKeys.has(key)) continue;
            const targetVersions = store
              .get(targetType as FhirResourceType)
              ?.get(targetId);
            const targetLatest = targetVersions?.[targetVersions.length - 1];
            if (targetLatest) {
              includedKeys.add(key);
              entries.push({
                fullUrl: key,
                resource: deepClone(targetLatest as T),
                search: { mode: 'include' },
              });
            }
          }
        }
      }
    }

    // Handle _revinclude (e.g. Condition:patient or Encounter:subject)
    const revIncludeParams = this.normalizeParamArray(params._revinclude);
    if (!summaryCount && revIncludeParams.length > 0) {
      const matchedRefs = new Set(pageItems.map((p) => `${p.resourceType}/${p.id}`));
      for (const rev of revIncludeParams) {
        const [sourceType, searchField] = rev.split(':');
        if (!sourceType || !searchField) continue;
        const sourceBucket = store.get(sourceType as FhirResourceType);
        if (!sourceBucket) continue;
        for (const versions of sourceBucket.values()) {
          const candidate = versions[versions.length - 1];
          if (!candidate) continue;
          const refs = extractReferences(candidate, searchField);
          if (refs.some((ref) => matchedRefs.has(ref))) {
            const key = `${candidate.resourceType}/${candidate.id}`;
            if (!includedKeys.has(key)) {
              includedKeys.add(key);
              entries.push({
                fullUrl: key,
                resource: deepClone(candidate as T),
                search: { mode: 'include' },
              });
            }
          }
        }
      }
    }

    const hasNext = !summaryCount && offset + count < total;
    const queryStr = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');

    const bundle: FhirBundle<T> = {
      resourceType: 'Bundle',
      type: 'searchset',
      timestamp: new Date().toISOString(),
      total,
      link: [
        {
          relation: 'self',
          url: `/${ctx.tenantCode}/${resourceType}${queryStr ? `?${queryStr}` : ''}`,
        },
        ...(hasNext
          ? [
              {
                relation: 'next' as const,
                url: `/${ctx.tenantCode}/${resourceType}?_offset=${offset + count}&_count=${count}`,
              },
            ]
          : []),
      ],
      entry: entries,
    };

    fhirRequestLog.record({
      mode: 'mock',
      tenantId: ctx.tenantId,
      tenantCode: ctx.tenantCode,
      method: 'GET',
      url: `/${ctx.tenantCode}/${resourceType}${queryStr ? `?${queryStr}` : ''}`,
      status: 200,
      durationMs: Math.round(performance.now() - started),
    });

    return {
      bundle,
      resources: pageItems,
      total,
      hasNext,
      nextPage: hasNext
        ? () => this.executeSearchPage<T>(ctx, resourceType, params, offset + count)
        : undefined,
    };
  }

  private normalizeParamArray(
    value: FhirSearchParams[string],
  ): string[] {
    if (value === undefined) return [];
    if (Array.isArray(value)) return value.map(String);
    return [String(value)];
  }

  private matchesParams(resource: FhirResource, params: FhirSearchParams): boolean {
    for (const [key, rawValue] of Object.entries(params)) {
      if (
        rawValue === undefined ||
        rawValue === '' ||
        key === '_count' ||
        key === '_sort' ||
        key === '_summary' ||
        key === '_include' ||
        key === '_revinclude'
      ) {
        continue;
      }
      const values = Array.isArray(rawValue) ? rawValue.map(String) : [String(rawValue)];
      for (const value of values) {
        if (!this.matchesSingleParam(resource, key, value)) {
          return false;
        }
      }
    }
    return true;
  }

  private matchesSingleParam(
    resource: FhirResource,
    key: string,
    rawVal: string,
  ): boolean {
    // Support comma-separated OR values in FHIR
    const orValues = rawVal.split(',').map((s) => s.trim()).filter(Boolean);
    if (orValues.length > 1) {
      return orValues.some((v) => this.matchesSingleParam(resource, key, v));
    }
    const val = orValues[0] ?? rawVal;

    if (key === '_id') {
      return resource.id === val;
    }

    if (
      key === '_lastUpdated' ||
      key === 'birthdate' ||
      key === 'date' ||
      key === 'recorded-date' ||
      key === 'authored'
    ) {
      const dates = extractDateValues(resource, key);
      return dates.some((d) => matchesDateCriteria(d, val));
    }

    if (
      key === 'identifier' ||
      key === 'code' ||
      key === 'specialty' ||
      key === 'type' ||
      key === 'category' ||
      key === 'status' ||
      key === 'gender' ||
      key === 'active' ||
      key === 'action' ||
      key === 'outcome'
    ) {
      const tokens = extractTokens(resource, key);
      if (val.includes('|')) {
        const [reqSystem, reqCode] = val.split('|');
        return tokens.some((t) => {
          const sysMatch = !reqSystem || t.system === reqSystem;
          const codeMatch =
            !reqCode || (t.code ?? '').toLowerCase() === reqCode.toLowerCase();
          return sysMatch && codeMatch;
        });
      }
      const lower = val.toLowerCase();
      return tokens.some(
        (t) =>
          (t.code ?? '').toLowerCase() === lower ||
          (t.system ?? '').toLowerCase() === lower,
      );
    }

    if (
      key === 'patient' ||
      key === 'subject' ||
      key === 'practitioner' ||
      key === 'organization' ||
      key === 'participating-organization' ||
      key === 'location' ||
      key === 'encounter' ||
      key === 'network' ||
      key === 'focus' ||
      key === 'owner' ||
      key === 'target'
    ) {
      const refs = extractReferences(resource, key);
      return refs.some((ref) => ref === val || ref.endsWith(`/${val}`));
    }

    // Numeric search (e.g., value-quantity, total)
    const directNumeric = (resource as Record<string, unknown>)[key];
    if (typeof directNumeric === 'number') {
      return matchesNumberCriteria(directNumeric, val);
    }
    if (key === 'value-quantity' && resource.resourceType === 'Observation') {
      const qtyVal = (resource as unknown as { valueQuantity?: { value?: number } })
        .valueQuantity?.value;
      if (typeof qtyVal === 'number') {
        return matchesNumberCriteria(qtyVal, val);
      }
    }

    // String search (case-insensitive substring/prefix)
    const strings = extractSearchStrings(resource, key);
    const needle = val.toLowerCase();
    return strings.some((s) => s.toLowerCase().includes(needle));
  }

  public async history<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id?: string,
  ): Promise<FhirBundle<T>> {
    const started = performance.now();
    const store = this.requireTenantStore(ctx);
    const bucket = store.get(resourceType);
    const entries: FhirBundleEntry<T>[] = [];

    if (bucket) {
      const versionLists = id
        ? [bucket.get(id) ?? []]
        : Array.from(bucket.values());
      for (const versions of versionLists) {
        for (let i = versions.length - 1; i >= 0; i -= 1) {
          const res = versions[i] as T;
          entries.push({
            fullUrl: `${res.resourceType}/${res.id}`,
            resource: deepClone(res),
          });
        }
      }
    }

    fhirRequestLog.record({
      mode: 'mock',
      tenantId: ctx.tenantId,
      tenantCode: ctx.tenantCode,
      method: 'GET',
      url: id
        ? `/${ctx.tenantCode}/${resourceType}/${id}/_history`
        : `/${ctx.tenantCode}/${resourceType}/_history`,
      status: 200,
      durationMs: Math.round(performance.now() - started),
    });

    return {
      resourceType: 'Bundle',
      type: 'history',
      timestamp: new Date().toISOString(),
      total: entries.length,
      entry: entries,
    };
  }

  public async transaction(
    ctx: FhirRequestContext,
    bundle: FhirBundle,
  ): Promise<FhirBundle> {
    const started = performance.now();
    const store = this.requireTenantStore(ctx);
    const entries = bundle.entry ?? [];

    // Snapshot tenant store for atomic rollback if any entry fails
    const snapshot = new Map<FhirResourceType, Map<string, FhirResource[]>>();
    for (const [type, bucket] of store.entries()) {
      const clonedBucket = new Map<string, FhirResource[]>();
      for (const [resId, versions] of bucket.entries()) {
        clonedBucket.set(resId, deepClone(versions));
      }
      snapshot.set(type, clonedBucket);
    }

    try {
      // Pass 1: Pre-allocate IDs for urn:uuid fullUrls
      const urnMap = new Map<string, string>();
      const workingEntries = deepClone(entries);

      for (const entry of workingEntries) {
        if (entry.fullUrl?.startsWith('urn:uuid:') && entry.resource) {
          const assignedId =
            entry.resource.id || generateResourceId(entry.resource.resourceType);
          entry.resource.id = assignedId;
          urnMap.set(entry.fullUrl, `${entry.resource.resourceType}/${assignedId}`);
        }
      }

      // Pass 2: Resolve urn:uuid references across all entries
      const resolvedEntries = replaceUrnUuids(
        workingEntries,
        urnMap,
      ) as FhirBundleEntry[];

      // Pass 3: Execute requests
      const responseEntries: FhirBundleEntry[] = [];
      for (const entry of resolvedEntries) {
        const method = entry.request?.method ?? 'POST';
        const res = entry.resource;

        if (method === 'POST' && res) {
          if (entry.request?.ifNoneExist) {
            const searchParams: FhirSearchParams = {};
            const qp = new URLSearchParams(entry.request.ifNoneExist);
            qp.forEach((v, k) => {
              searchParams[k] = v;
            });
            const result = await this.conditionalCreate(ctx, res, searchParams);
            responseEntries.push({
              fullUrl: `${result.resource.resourceType}/${result.resource.id}`,
              resource: result.resource,
              response: {
                status: result.created ? '201 Created' : '200 OK',
                location: `${result.resource.resourceType}/${result.resource.id}/_history/${result.resource.meta?.versionId ?? '1'}`,
              },
            });
          } else {
            const created = await this.create(ctx, res);
            responseEntries.push({
              fullUrl: `${created.resourceType}/${created.id}`,
              resource: created,
              response: {
                status: '201 Created',
                location: `${created.resourceType}/${created.id}/_history/${created.meta?.versionId ?? '1'}`,
              },
            });
          }
        } else if (method === 'PUT' && res) {
          const updated = await this.update(ctx, res);
          responseEntries.push({
            fullUrl: `${updated.resourceType}/${updated.id}`,
            resource: updated,
            response: {
              status: '200 OK',
              location: `${updated.resourceType}/${updated.id}/_history/${updated.meta?.versionId ?? '1'}`,
            },
          });
        } else if (method === 'DELETE' && entry.request?.url) {
          const [resType, resId] = entry.request.url.split('/');
          await this.delete(ctx, resType as FhirResourceType, resId);
          responseEntries.push({
            response: { status: '204 No Content' },
          });
        } else if (method === 'GET' && entry.request?.url) {
          const [resType, resId] = entry.request.url.split('/');
          const found = await this.read(ctx, resType as FhirResourceType, resId);
          responseEntries.push({
            fullUrl: `${found.resourceType}/${found.id}`,
            resource: found,
            response: { status: '200 OK' },
          });
        } else {
          throw new AppError({
            message: `Unsupported transaction entry method: ${method}`,
            statusCode: 400,
            code: 'INVALID_TRANSACTION',
          });
        }
      }

      fhirRequestLog.record({
        mode: 'mock',
        tenantId: ctx.tenantId,
        tenantCode: ctx.tenantCode,
        method: 'POST',
        url: `/${ctx.tenantCode} (transaction:${responseEntries.length})`,
        status: 200,
        durationMs: Math.round(performance.now() - started),
      });

      return {
        resourceType: 'Bundle',
        type: 'transaction-response',
        timestamp: new Date().toISOString(),
        entry: responseEntries,
      };
    } catch (err) {
      // Atomic rollback
      this.tenantStores.set(ctx.tenantId, snapshot);
      throw err;
    }
  }

  public async batch(
    ctx: FhirRequestContext,
    bundle: FhirBundle,
  ): Promise<FhirBundle> {
    const started = performance.now();
    this.requireTenantStore(ctx);
    const responseEntries: FhirBundleEntry[] = [];

    for (const entry of bundle.entry ?? []) {
      try {
        const single = await this.transaction(ctx, {
          resourceType: 'Bundle',
          type: 'transaction',
          entry: [entry],
        });
        if (single.entry?.[0]) {
          responseEntries.push(single.entry[0]);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Batch entry failed';
        responseEntries.push({
          response: {
            status: err instanceof AppError ? String(err.statusCode) : '400 Bad Request',
            outcome: {
              resourceType: 'OperationOutcome',
              issue: [{ severity: 'error', code: 'processing', diagnostics: message }],
            },
          },
        });
      }
    }

    fhirRequestLog.record({
      mode: 'mock',
      tenantId: ctx.tenantId,
      tenantCode: ctx.tenantCode,
      method: 'POST',
      url: `/${ctx.tenantCode} (batch:${responseEntries.length})`,
      status: 200,
      durationMs: Math.round(performance.now() - started),
    });

    return {
      resourceType: 'Bundle',
      type: 'batch-response',
      timestamp: new Date().toISOString(),
      entry: responseEntries,
    };
  }

  public async operation<TResult extends FhirResource = FhirOperationOutcome>(
    ctx: FhirRequestContext,
    operationName: '$validate' | '$everything' | string,
    options: {
      resourceType?: FhirResourceType;
      id?: string;
      resource?: FhirResource;
      params?: FhirSearchParams;
    },
  ): Promise<TResult> {
    const started = performance.now();
    const store = this.requireTenantStore(ctx);

    if (operationName === '$validate') {
      const target = options.resource;
      const issues: FhirOperationOutcomeIssue[] = [];

      if (!target || typeof target !== 'object') {
        issues.push({
          severity: 'error',
          code: 'required',
          diagnostics: 'Validation requires a FHIR resource payload.',
        });
      } else {
        if (
          !target.resourceType ||
          !ALL_FHIR_RESOURCE_TYPES.includes(target.resourceType)
        ) {
          issues.push({
            severity: 'error',
            code: 'invalid',
            expression: ['resourceType'],
            diagnostics: `Unknown or missing resourceType: ${String(target.resourceType)}`,
          });
        }

        const r = target as Record<string, unknown>;

        // Required fields & enum checks by resource type
        switch (target.resourceType) {
          case 'Patient':
            if (r.gender && !VALID_GENDERS.has(String(r.gender))) {
              issues.push({
                severity: 'error',
                code: 'code-invalid',
                expression: ['Patient.gender'],
                diagnostics: `Invalid Patient.gender '${String(r.gender)}'. Expected male | female | other | unknown.`,
              });
            }
            if (!Array.isArray(r.name) || r.name.length === 0) {
              issues.push({
                severity: 'warning',
                code: 'incomplete',
                expression: ['Patient.name'],
                diagnostics: 'Patient.name is recommended by US Core.',
              });
            }
            break;
          case 'Practitioner':
            if (!Array.isArray(r.name) || r.name.length === 0) {
              issues.push({
                severity: 'error',
                code: 'required',
                expression: ['Practitioner.name'],
                diagnostics: 'Practitioner.name is required.',
              });
            }
            break;
          case 'Organization':
            if (typeof r.name !== 'string' || !r.name.trim()) {
              issues.push({
                severity: 'error',
                code: 'required',
                expression: ['Organization.name'],
                diagnostics: 'Organization.name is required.',
              });
            }
            break;
          case 'InsurancePlan':
            if (typeof r.name !== 'string' || !r.name.trim()) {
              issues.push({
                severity: 'error',
                code: 'required',
                expression: ['InsurancePlan.name'],
                diagnostics: 'InsurancePlan.name is required.',
              });
            }
            if (r.status && !VALID_PLAN_STATUS.has(String(r.status))) {
              issues.push({
                severity: 'error',
                code: 'code-invalid',
                expression: ['InsurancePlan.status'],
                diagnostics: `Invalid InsurancePlan.status '${String(r.status)}'.`,
              });
            }
            break;
          case 'Observation':
            if (!r.status || !VALID_OBS_STATUS.has(String(r.status))) {
              issues.push({
                severity: 'error',
                code: 'code-invalid',
                expression: ['Observation.status'],
                diagnostics: `Observation.status must be a valid FHIR R4 code.`,
              });
            }
            if (!r.code) {
              issues.push({
                severity: 'error',
                code: 'required',
                expression: ['Observation.code'],
                diagnostics: 'Observation.code is required.',
              });
            }
            break;
          case 'Condition':
            if (!r.subject) {
              issues.push({
                severity: 'error',
                code: 'required',
                expression: ['Condition.subject'],
                diagnostics: 'Condition.subject is required.',
              });
            }
            break;
          case 'Encounter':
            if (!r.status || !VALID_ENCOUNTER_STATUS.has(String(r.status))) {
              issues.push({
                severity: 'error',
                code: 'code-invalid',
                expression: ['Encounter.status'],
                diagnostics: 'Encounter.status must be a valid FHIR R4 code.',
              });
            }
            if (!r.class) {
              issues.push({
                severity: 'error',
                code: 'required',
                expression: ['Encounter.class'],
                diagnostics: 'Encounter.class is required.',
              });
            }
            break;
          case 'Task':
            if (!r.status || !VALID_TASK_STATUS.has(String(r.status))) {
              issues.push({
                severity: 'error',
                code: 'code-invalid',
                expression: ['Task.status'],
                diagnostics: 'Task.status must be a valid FHIR R4 code.',
              });
            }
            if (!r.intent) {
              issues.push({
                severity: 'error',
                code: 'required',
                expression: ['Task.intent'],
                diagnostics: 'Task.intent is required.',
              });
            }
            break;
          case 'Bundle':
            if (!r.type || !VALID_BUNDLE_TYPES.has(String(r.type))) {
              issues.push({
                severity: 'error',
                code: 'code-invalid',
                expression: ['Bundle.type'],
                diagnostics: 'Bundle.type must be a valid FHIR R4 bundle type.',
              });
            }
            break;
          default:
            break;
        }

        // Check code systems present on codings
        const codings = collectCodings(target);
        for (const item of codings) {
          if (item.coding.code && !item.coding.system) {
            issues.push({
              severity: 'error',
              code: 'code-invalid',
              expression: [item.path],
              diagnostics: `Coding at ${item.path} specifies code '${item.coding.code}' without a system URI.`,
            });
          }
        }

        // Check reference targets exist in this tenant store (unless internal urn:uuid in a Bundle)
        const internalFullUrls = new Set<string>();
        if (target.resourceType === 'Bundle' && Array.isArray(r.entry)) {
          for (const e of r.entry as FhirBundleEntry[]) {
            if (e.fullUrl) internalFullUrls.add(e.fullUrl);
            if (e.resource?.resourceType && e.resource.id) {
              internalFullUrls.add(`${e.resource.resourceType}/${e.resource.id}`);
            }
          }
        }

        const refs = collectReferenceStrings(target);
        for (const ref of refs) {
          if (
            ref.startsWith('#') ||
            internalFullUrls.has(ref) ||
            ref.startsWith('http://') ||
            ref.startsWith('https://')
          ) {
            continue;
          }
          if (ref.startsWith('urn:uuid:')) {
            issues.push({
              severity: 'error',
              code: 'not-found',
              diagnostics: `Unresolved urn:uuid reference '${ref}' does not match any entry fullUrl in this Bundle.`,
            });
            continue;
          }
          const [refType, refId] = ref.split('/');
          if (refType && refId && ALL_FHIR_RESOURCE_TYPES.includes(refType as FhirResourceType)) {
            const exists = store.get(refType as FhirResourceType)?.has(refId);
            if (!exists) {
              issues.push({
                severity: 'error',
                code: 'not-found',
                diagnostics: `Referenced target '${ref}' does not exist in tenant '${ctx.tenantCode}'.`,
              });
            }
          }
        }
      }

      if (issues.length === 0) {
        issues.push({
          severity: 'information',
          code: 'informational',
          diagnostics: 'Validation passed with no errors.',
        });
      }

      const outcome: FhirOperationOutcome = {
        resourceType: 'OperationOutcome',
        issue: issues,
      };
      const hasErrors = issues.some(
        (i) => i.severity === 'error' || i.severity === 'fatal',
      );
      fhirRequestLog.record({
        mode: 'mock',
        tenantId: ctx.tenantId,
        tenantCode: ctx.tenantCode,
        method: 'POST',
        url: `/${ctx.tenantCode}/${options.resourceType ?? options.resource?.resourceType ?? ''}/$validate`,
        status: hasErrors ? 422 : 200,
        durationMs: Math.round(performance.now() - started),
        outcomeSummary: hasErrors
          ? `${issues.filter((i) => i.severity === 'error' || i.severity === 'fatal').length} validation error(s)`
          : 'Valid',
        outcome,
      });

      return outcome as unknown as TResult;
    }

    if (operationName === '$everything' && options.resourceType === 'Patient' && options.id) {
      const patient = await this.read(ctx, 'Patient', options.id);
      const patientRef = `Patient/${options.id}`;
      const entries: FhirBundleEntry[] = [
        { fullUrl: patientRef, resource: patient, search: { mode: 'match' } },
      ];

      const linkedTypes: FhirResourceType[] = [
        'Encounter',
        'Condition',
        'Observation',
        'Procedure',
        'MedicationRequest',
        'Coverage',
        'Claim',
        'ClaimResponse',
        'DocumentReference',
        'Consent',
      ];

      for (const linkedType of linkedTypes) {
        const bucket = store.get(linkedType);
        if (!bucket) continue;
        for (const versions of bucket.values()) {
          const latest = versions[versions.length - 1];
          if (!latest) continue;
          const refs = extractReferences(latest, 'patient');
          if (refs.includes(patientRef)) {
            entries.push({
              fullUrl: `${latest.resourceType}/${latest.id}`,
              resource: deepClone(latest),
              search: { mode: 'include' },
            });
          }
        }
      }

      const bundle: FhirBundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        timestamp: new Date().toISOString(),
        total: entries.length,
        entry: entries,
      };

      fhirRequestLog.record({
        mode: 'mock',
        tenantId: ctx.tenantId,
        tenantCode: ctx.tenantCode,
        method: 'GET',
        url: `/${ctx.tenantCode}/Patient/${options.id}/$everything`,
        status: 200,
        durationMs: Math.round(performance.now() - started),
      });

      return bundle as unknown as TResult;
    }

    throw new AppError({
      message: `Operation '${operationName}' is not supported by MockFhirClient.`,
      statusCode: 501,
      code: 'NOT_IMPLEMENTED',
    });
  }
}
