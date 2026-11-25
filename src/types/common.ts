export type ThemeMode = 'light' | 'dark';

export type FhirMode = 'mock' | 'live';

export type BuildPhase = 0 | 1 | 2 | 3 | 4 | 5;

export type ModuleGroup =
  | 'Core'
  | 'Provider Lifecycle'
  | 'Interoperability'
  | 'Cross-cutting';

export type ModuleLayer =
  | 'Foundation'
  | 'Core Platform'
  | 'Domain Operations'
  | 'Interoperability'
  | 'Cross-cutting';

export type ModuleBuildStatus = 'Completed' | 'In Progress' | 'Planned';

export type TestSuiteStatus = 'Passing' | 'Failing' | 'Not Run';

export interface ModuleTestSummary {
  suiteName: string;
  status: TestSuiteStatus;
  passed: number;
  failed: number;
  total: number;
  lastRunAt?: string;
}

export interface ModuleDefinition {
  id: string;
  code: string;
  name: string;
  shortName: string;
  group: ModuleGroup;
  layer: ModuleLayer;
  phase: BuildPhase;
  route: string;
  status: ModuleBuildStatus;
  description: string;
  dependencies: string[];
  eventsPublished: string[];
  fhirResources: string[];
  tests: ModuleTestSummary;
}

export type RoleName =
  | 'PlatformAdmin'
  | 'TenantAdmin'
  | 'ProviderUser'
  | 'EnrollmentAnalyst'
  | 'ScreeningAnalyst'
  | 'CredentialingSpecialist'
  | 'ProgramIntegrityOfficer'
  | 'AgencyApprover'
  | 'PlanManager'
  | 'IntegrationEngineer'
  | 'Auditor';

export type PermissionAction =
  | 'view'
  | 'create'
  | 'edit'
  | 'approve'
  | 'delete'
  | 'export';

export interface AppErrorDetail {
  field?: string;
  code: string;
  message: string;
  severity?: 'fatal' | 'error' | 'warning' | 'information';
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly correlationId?: string;
  public readonly details: AppErrorDetail[];
  public readonly rawOutcome?: unknown;

  constructor(options: {
    message: string;
    statusCode?: number;
    code?: string;
    correlationId?: string;
    details?: AppErrorDetail[];
    rawOutcome?: unknown;
  }) {
    super(options.message);
    this.name = 'AppError';
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.correlationId = options.correlationId;
    this.details = options.details ?? [];
    this.rawOutcome = options.rawOutcome;
  }
}

export interface PaginationParams {
  page: number;
  size: number;
}

export interface SortConfig<T extends string = string> {
  field: T;
  direction: 'asc' | 'desc';
}
