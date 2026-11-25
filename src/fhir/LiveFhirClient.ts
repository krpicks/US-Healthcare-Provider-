import {
  AppError,
  type AppErrorDetail,
  type FhirBundle,
  type FhirCapabilityStatement,
  type FhirOperationOutcome,
  type FhirResource,
  type FhirResourceType,
} from '../types';
import {
  resolveTenantBaseUrl,
  type TenantPartitionStrategy,
} from '../tenancy/tenantContext';
import { settingsService } from '../services/settingsService';
import type {
  FhirClient,
  FhirPagedResult,
  FhirPatchOperation,
  FhirRequestContext,
  FhirSearchParams,
} from './FhirClient';
import { fhirRequestLog } from './requestLog';

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export interface LiveFhirClientOptions {
  baseUrl?: string;
  partitionStrategy?: TenantPartitionStrategy;
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  fetchImpl?: typeof fetch;
  getBearerToken?: () => string | undefined;
}

function buildQueryString(params?: FhirSearchParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined || val === '') continue;
    if (Array.isArray(val)) {
      val.forEach((v) => search.append(key, String(v)));
    } else {
      search.set(key, String(val));
    }
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

function parseOperationOutcomeError(
  status: number,
  body: unknown,
  fallbackMessage: string,
  correlationId?: string,
): AppError {
  if (
    body &&
    typeof body === 'object' &&
    (body as { resourceType?: string }).resourceType === 'OperationOutcome'
  ) {
    const outcome = body as FhirOperationOutcome;
    const details: AppErrorDetail[] = (outcome.issue ?? []).map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      field: issue.expression?.[0],
      message: issue.diagnostics ?? issue.details?.text ?? issue.code,
    }));
    const firstMsg = details[0]?.message ?? fallbackMessage;
    return new AppError({
      message: firstMsg,
      statusCode: status,
      code: details[0]?.code ?? `HTTP_${status}`,
      correlationId,
      details,
      rawOutcome: outcome,
    });
  }

  return new AppError({
    message: fallbackMessage,
    statusCode: status,
    code: `HTTP_${status}`,
    correlationId,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LiveFhirClient implements FhirClient {
  public readonly mode = 'live' as const;
  private readonly options: LiveFhirClientOptions;

  constructor(options: LiveFhirClientOptions = {}) {
    this.options = options;
  }

  private resolveUrl(ctx: FhirRequestContext, path: string): string {
    const settings = settingsService.load();
    const rawBase = this.options.baseUrl ?? settings.fhirBaseUrl;
    const strategy =
      this.options.partitionStrategy ?? settings.tenantPartitionStrategy;
    const tenantBase = resolveTenantBaseUrl(rawBase, ctx.tenantCode, strategy);
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${tenantBase}${cleanPath}`;
  }

  private async request<T>(
    ctx: FhirRequestContext,
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    if (!ctx || !ctx.tenantId) {
      throw new AppError({
        message: 'TenantContext is required for Live FHIR requests.',
        statusCode: 403,
        code: 'TENANT_CONTEXT_REQUIRED',
      });
    }

    const fetchFn = this.options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const timeoutMs = this.options.timeoutMs ?? 15000;
    const maxRetries = this.options.maxRetries ?? 3;
    const baseBackoffMs = this.options.baseBackoffMs ?? 250;
    const url = this.resolveUrl(ctx, path);
    const settings = settingsService.load();
    const strategy =
      this.options.partitionStrategy ?? settings.tenantPartitionStrategy;
    const token =
      this.options.getBearerToken?.() ??
      settingsService.getSessionSecret('fhirBearerToken');

    const headers: Record<string, string> = {
      Accept: 'application/fhir+json',
      'X-Correlation-Id': ctx.correlationId ?? `corr-${Date.now()}`,
      ...(strategy === 'header' ? { 'X-Tenant-Id': ctx.tenantCode } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/fhir+json' } : {}),
      ...(extraHeaders ?? {}),
    };

    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const started = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchFn(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        const durationMs = Math.round(performance.now() - started);

        if (RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
          fhirRequestLog.record({
            mode: 'live',
            tenantId: ctx.tenantId,
            tenantCode: ctx.tenantCode,
            method,
            url,
            status: response.status,
            durationMs,
            outcomeSummary: `Retrying (${attempt + 1}/${maxRetries})`,
          });
          await delay(baseBackoffMs * Math.pow(2, attempt));
          continue;
        }

        const text = response.status === 204 ? '' : await response.text();
        let parsed: unknown = undefined;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { raw: text };
          }
        }

        const outcome =
          parsed &&
          typeof parsed === 'object' &&
          (parsed as { resourceType?: string }).resourceType === 'OperationOutcome'
            ? (parsed as FhirOperationOutcome)
            : undefined;

        fhirRequestLog.record({
          mode: 'live',
          tenantId: ctx.tenantId,
          tenantCode: ctx.tenantCode,
          method,
          url,
          status: response.status,
          durationMs,
          outcomeSummary: outcome?.issue?.[0]?.diagnostics,
          outcome,
        });

        if (!response.ok) {
          throw parseOperationOutcomeError(
            response.status,
            parsed,
            `FHIR server returned HTTP ${response.status} ${response.statusText}`,
            ctx.correlationId,
          );
        }

        return parsed as T;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof AppError) {
          throw err;
        }
        const isAbort =
          err instanceof Error && err.name === 'AbortError';
        lastError = isAbort
          ? new AppError({
              message: `FHIR request timed out after ${timeoutMs}ms.`,
              statusCode: 504,
              code: 'TIMEOUT',
              correlationId: ctx.correlationId,
            })
          : new AppError({
              message:
                err instanceof Error
                  ? err.message
                  : 'Network error contacting FHIR server.',
              statusCode: 0,
              code: 'NETWORK_ERROR',
              correlationId: ctx.correlationId,
            });

        if (attempt < maxRetries && isAbort) {
          await delay(baseBackoffMs * Math.pow(2, attempt));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError instanceof AppError
      ? lastError
      : new AppError({
          message: 'FHIR request failed after maximum retries.',
          statusCode: 503,
          code: 'MAX_RETRIES_EXCEEDED',
        });
  }

  public async verifyFhirVersion(
    ctx: FhirRequestContext,
  ): Promise<{ ok: boolean; fhirVersion?: string; latencyMs: number; error?: string }> {
    const started = performance.now();
    try {
      const cap = await this.capabilities(ctx);
      const latencyMs = Math.round(performance.now() - started);
      if (cap.fhirVersion !== '4.0.1') {
        return {
          ok: false,
          fhirVersion: cap.fhirVersion,
          latencyMs,
          error: `Expected FHIR version 4.0.1, but server reported '${cap.fhirVersion ?? 'unknown'}'.`,
        };
      }
      return { ok: true, fhirVersion: cap.fhirVersion, latencyMs };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        error: err instanceof Error ? err.message : 'Unable to reach /metadata',
      };
    }
  }

  public capabilities(ctx: FhirRequestContext): Promise<FhirCapabilityStatement> {
    return this.request<FhirCapabilityStatement>(ctx, 'GET', '/metadata');
  }

  public create<T extends FhirResource>(
    ctx: FhirRequestContext,
    resource: T,
  ): Promise<T> {
    return this.request<T>(ctx, 'POST', `/${resource.resourceType}`, resource);
  }

  public async conditionalCreate<T extends FhirResource>(
    ctx: FhirRequestContext,
    resource: T,
    searchParams: FhirSearchParams,
  ): Promise<{ resource: T; created: boolean }> {
    const query = buildQueryString(searchParams).replace(/^\?/, '');
    const result = await this.request<T>(
      ctx,
      'POST',
      `/${resource.resourceType}`,
      resource,
      query ? { 'If-None-Exist': query } : undefined,
    );
    return { resource: result, created: result.meta?.versionId === '1' };
  }

  public read<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id: string,
  ): Promise<T> {
    return this.request<T>(ctx, 'GET', `/${resourceType}/${encodeURIComponent(id)}`);
  }

  public vread<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id: string,
    versionId: string,
  ): Promise<T> {
    return this.request<T>(
      ctx,
      'GET',
      `/${resourceType}/${encodeURIComponent(id)}/_history/${encodeURIComponent(versionId)}`,
    );
  }

  public update<T extends FhirResource>(
    ctx: FhirRequestContext,
    resource: T,
  ): Promise<T> {
    if (!resource.id) {
      throw new AppError({
        message: 'Resource id is required for update.',
        statusCode: 400,
        code: 'MISSING_ID',
      });
    }
    return this.request<T>(
      ctx,
      'PUT',
      `/${resource.resourceType}/${encodeURIComponent(resource.id)}`,
      resource,
    );
  }

  public patch<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id: string,
    operations: FhirPatchOperation[],
  ): Promise<T> {
    return this.request<T>(
      ctx,
      'PATCH',
      `/${resourceType}/${encodeURIComponent(id)}`,
      operations,
      { 'Content-Type': 'application/json-patch+json' },
    );
  }

  public async delete(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id: string,
  ): Promise<void> {
    await this.request<void>(
      ctx,
      'DELETE',
      `/${resourceType}/${encodeURIComponent(id)}`,
    );
  }

  public async search<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    params?: FhirSearchParams,
  ): Promise<FhirPagedResult<T>> {
    const query = buildQueryString(params);
    return this.fetchSearchUrl<T>(ctx, `/${resourceType}${query}`);
  }

  private async fetchSearchUrl<T extends FhirResource>(
    ctx: FhirRequestContext,
    urlOrPath: string,
  ): Promise<FhirPagedResult<T>> {
    const bundle = await this.request<FhirBundle<T>>(ctx, 'GET', urlOrPath);
    const resources = (bundle.entry ?? [])
      .filter((e) => !e.search || e.search.mode === 'match')
      .map((e) => e.resource)
      .filter((r): r is T => Boolean(r));
    const nextLink = bundle.link?.find((l) => l.relation === 'next')?.url;
    return {
      bundle,
      resources,
      total: bundle.total ?? resources.length,
      hasNext: Boolean(nextLink),
      nextPage: nextLink
        ? () => this.fetchSearchUrl<T>(ctx, nextLink)
        : undefined,
    };
  }

  public history<T extends FhirResource>(
    ctx: FhirRequestContext,
    resourceType: FhirResourceType,
    id?: string,
  ): Promise<FhirBundle<T>> {
    const path = id
      ? `/${resourceType}/${encodeURIComponent(id)}/_history`
      : `/${resourceType}/_history`;
    return this.request<FhirBundle<T>>(ctx, 'GET', path);
  }

  public transaction(
    ctx: FhirRequestContext,
    bundle: FhirBundle,
  ): Promise<FhirBundle> {
    return this.request<FhirBundle>(ctx, 'POST', '/', bundle);
  }

  public batch(
    ctx: FhirRequestContext,
    bundle: FhirBundle,
  ): Promise<FhirBundle> {
    return this.request<FhirBundle>(ctx, 'POST', '/', bundle);
  }

  public operation<TResult extends FhirResource = FhirOperationOutcome>(
    ctx: FhirRequestContext,
    operationName: '$validate' | '$everything' | string,
    options: {
      resourceType?: FhirResourceType;
      id?: string;
      resource?: FhirResource;
      params?: FhirSearchParams;
    },
  ): Promise<TResult> {
    const op = operationName.startsWith('$')
      ? operationName
      : `$${operationName}`;
    let path = `/${op}`;
    if (options.resourceType && options.id) {
      path = `/${options.resourceType}/${encodeURIComponent(options.id)}/${op}`;
    } else if (options.resourceType) {
      path = `/${options.resourceType}/${op}`;
    }

    if (options.resource) {
      return this.request<TResult>(ctx, 'POST', path, options.resource);
    }
    const query = buildQueryString(options.params);
    return this.request<TResult>(ctx, 'GET', `${path}${query}`);
  }
}
