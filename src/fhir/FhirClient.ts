import type {
  FhirBundle,
  FhirCapabilityStatement,
  FhirOperationOutcome,
  FhirResource,
  FhirResourceType,
} from '../types';

export type FhirSearchParams = Record<
  string,
  string | number | boolean | Array<string | number | boolean> | undefined
>;

export interface FhirRequestContext {
  tenantId: string;
  tenantCode: string;
  correlationId?: string;
}

export interface FhirPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'test';
  path: string;
  value?: unknown;
}

export interface FhirPagedResult<T extends FhirResource = FhirResource> {
  bundle: FhirBundle<T>;
  resources: T[];
  total: number;
  hasNext: boolean;
  nextPage?: () => Promise<FhirPagedResult<T>>;
}

export interface FhirClient {
  readonly mode: 'mock' | 'live';

  capabilities(ctx: FhirRequestContext): Promise<FhirCapabilityStatement>;

  create<T extends FhirResource>(
    ctx: FhirRequestContext,
    resource: T,
  ): Promise<T>;

  conditionalCreate<T extends FhirResource>(
    ctx: FhirRequestContext,
    resource: T,
    searchParams: FhirSearchParams,
  ): Promise<{ resource: T; created: boolean }>;

  read<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id: string,
  ): Promise<T>;

  vread<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id: string,
    versionId: string,
  ): Promise<T>;

  update<T extends FhirResource>(
    ctx: FhirRequestContext,
    resource: T,
  ): Promise<T>;

  patch<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id: string,
    operations: FhirPatchOperation[],
  ): Promise<T>;

  delete(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id: string,
  ): Promise<void>;

  search<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    params?: FhirSearchParams,
  ): Promise<FhirPagedResult<T>>;

  history<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id?: string,
  ): Promise<FhirBundle<T>>;

  transaction(
    ctx: FhirRequestContext,
    bundle: FhirBundle,
  ): Promise<FhirBundle>;

  batch(ctx: FhirRequestContext, bundle: FhirBundle): Promise<FhirBundle>;

  operation<TResult extends FhirResource = FhirOperationOutcome>(
    ctx: FhirRequestContext,
    operationName: '$validate' | '$everything' | string,
    options: {
      resourceType?: FhirResourceType;
      id?: string;
      resource?: FhirResource;
      params?: FhirSearchParams;
    },
  ): Promise<TResult>;
}
