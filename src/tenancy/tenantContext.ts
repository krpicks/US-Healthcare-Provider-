export type TenantType =
  | 'State Medicaid agency'
  | 'Health plan'
  | 'Health center'
  | 'Vendor';

export type TenantStatus =
  | 'Draft'
  | 'Provisioning'
  | 'Active'
  | 'Suspended'
  | 'Offboarded';

export type TenantPartitionStrategy = 'path' | 'header';

export interface TenantSummary {
  id: string;
  code: string;
  legalName: string;
  type: TenantType;
  status: TenantStatus;
  timezone: string;
  locale: string;
  dataRegion: string;
}

export interface TenantContextValue {
  activeTenant: TenantSummary;
  availableTenants: TenantSummary[];
  setActiveTenantById: (tenantId: string) => void;
}

export const DEFAULT_SEED_TENANTS: TenantSummary[] = [
  {
    id: 'tenant-state-medicaid',
    code: 'state-medicaid-a',
    legalName: 'State Medicaid Agency (Synthetic Tenant A)',
    type: 'State Medicaid agency',
    status: 'Active',
    timezone: 'America/New_York',
    locale: 'en-US',
    dataRegion: 'us-east-1',
  },
  {
    id: 'tenant-health-center-net',
    code: 'fqhc-network-b',
    legalName: 'Community Health Center Network (Synthetic Tenant B)',
    type: 'Health center',
    status: 'Active',
    timezone: 'America/Chicago',
    locale: 'en-US',
    dataRegion: 'us-central-1',
  },
];

export function resolveTenantBaseUrl(
  fhirBaseUrl: string,
  tenantCode: string,
  strategy: TenantPartitionStrategy,
): string {
  const normalizedBase = fhirBaseUrl.replace(/\/+$/, '');
  if (strategy === 'path') {
    return `${normalizedBase}/${encodeURIComponent(tenantCode)}`;
  }
  return normalizedBase;
}
