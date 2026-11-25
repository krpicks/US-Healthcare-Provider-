import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Eye,
  EyeOff,
  GitMerge,
  Plus,
  Send,
} from 'lucide-react';
import {
  Button,
  DataTable,
  Input,
  Modal,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  Timeline,
  useToast,
  type DataTableColumn,
} from '../../components';
import { Guard } from '../../app/Guard';
import { useAuth, usePermission } from '../../app/AuthContext';
import { maskSensitiveValue, validateNpi } from '../../rules';
import { auditService, buildCsvString, downloadTextFile } from '../../services';
import { useTenantContext } from '../../tenancy';
import {
  providerService,
  type CreateOrUpdateProviderInput,
  type DuplicateCandidate,
  type Provider360Data,
  type ProviderDirectoryRow,
  type ProviderEnrollmentStatus,
} from './providerService';

function statusTone(status: ProviderEnrollmentStatus) {
  switch (status) {
    case 'Active':
      return 'success';
    case 'Pending':
    case 'Applicant':
    case 'Revalidation Due':
      return 'warning';
    case 'Suspended':
    case 'Terminated':
      return 'danger';
  }
}

export function ProviderDirectoryPage() {
  const { activeTenant, fhirContext, seedReady } = useTenantContext();
  const { user, canUnmask } = useAuth();
  const { notify } = useToast();
  const canCreate = usePermission('m3-directory', 'create');
  const canEdit = usePermission('m3-directory', 'edit');
  const canExport = usePermission('m3-directory', 'export');

  const [providers, setProviders] = useState<ProviderDirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'directory' | 'duplicates'>('directory');

  // Directory filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [specialtyFilter, setSpecialtyFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('');
  const [acceptingFilter, setAcceptingFilter] = useState('all');

  // Provider 360 state
  const [selected360, setSelected360] = useState<Provider360Data | null>(null);
  const [p360Tab, setP360Tab] = useState('profile');
  const [unmasked, setUnmasked] = useState(false);

  // Create / Edit / Sync modal
  const [modalOpen, setModalOpen] = useState(false);
  const [formState, setFormState] = useState<CreateOrUpdateProviderInput>({
    prefix: 'Dr.',
    given: '',
    family: '',
    npi: '',
    medicaidId: '',
    providerType: activeTenant.businessRules.providerTypes[0] ?? 'Individual Physician',
    taxonomyCode: activeTenant.codeSets.taxonomies[0]?.code ?? '207Q00000X',
    specialty: activeTenant.codeSets.taxonomies[0]?.display ?? 'Family Medicine',
    licenseNumber: '',
    licenseState: 'NY',
    status: 'Active',
    acceptingNewPatients: true,
    street: '',
    city: '',
    state: 'NY',
    postalCode: '',
    phone: '',
    email: '',
    organizationName: '',
    endpointUrl: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await providerService.listProviders(fhirContext);
      setProviders(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load providers.');
    } finally {
      setLoading(false);
    }
  }, [fhirContext]);

  useEffect(() => {
    if (seedReady) {
      void loadProviders();
      setSelected360(null);
      setUnmasked(false);
    }
  }, [seedReady, loadProviders]);

  const filteredProviders = useMemo(() => {
    return providers.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (typeFilter !== 'all' && p.providerType !== typeFilter) return false;
      if (specialtyFilter !== 'all' && p.specialty !== specialtyFilter) return false;
      if (stateFilter.trim() && !p.state.toLowerCase().includes(stateFilter.trim().toLowerCase())) return false;
      if (acceptingFilter === 'yes' && !p.acceptingNewPatients) return false;
      if (acceptingFilter === 'no' && p.acceptingNewPatients) return false;
      return true;
    });
  }, [providers, statusFilter, typeFilter, specialtyFilter, stateFilter, acceptingFilter]);

  const duplicates = useMemo(
    () => providerService.detectDuplicates(providers),
    [providers],
  );

  const handleOpen360 = async (row: ProviderDirectoryRow) => {
    const data = await providerService.getProvider360(fhirContext, row.id);
    setSelected360(data);
    setP360Tab('profile');
    setUnmasked(false);
  };

  const handleToggleUnmask = async () => {
    if (!canUnmask || !selected360) return;
    if (!unmasked) {
      await auditService.record({
        ctx: fhirContext,
        actorName: user.name,
        actorRole: user.role,
        action: 'unmask',
        resourceType: 'Practitioner',
        resourceId: selected360.provider.id,
        outcomeDesc: `Unmasked SSN/TIN/DOB/Bank details on Practitioner/${selected360.provider.id}`,
      });
      notify({
        title: 'Sensitive fields unmasked',
        description: 'Action logged to FHIR AuditEvent.',
        variant: 'info',
      });
    }
    setUnmasked((v) => !v);
  };

  const handleExportCsv = async () => {
    const csv = buildCsvString(
      ['Name', 'NPI', 'Medicaid ID', 'Provider Type', 'Specialty', 'City', 'State', 'Status', 'Accepting Patients'],
      filteredProviders.map((p) => [
        p.fullName,
        p.npi,
        p.medicaidId,
        p.providerType,
        p.specialty,
        p.city,
        p.state,
        p.status,
        p.acceptingNewPatients ? 'Yes' : 'No',
      ]),
    );
    downloadTextFile(`${activeTenant.code}-provider-directory.csv`, csv, 'text/csv');
    await auditService.record({
      ctx: fhirContext,
      actorName: user.name,
      actorRole: user.role,
      action: 'export',
      resourceType: 'Practitioner',
      outcomeDesc: `Exported ${filteredProviders.length} providers to CSV`,
    });
    notify({ title: 'Provider Directory CSV exported', variant: 'success' });
  };

  const handleSaveProvider = async (syncFullBundle: boolean) => {
    setFormError(null);
    if (!validateNpi(formState.npi)) {
      setFormError('Enter a valid 10-digit NPI passing Luhn validation (e.g. 1245319599).');
      return;
    }
    if (!formState.given.trim() || !formState.family.trim()) {
      setFormError('First name and last name are required.');
      return;
    }
    try {
      if (syncFullBundle) {
        const res = await providerService.publishProviderToFhir(
          fhirContext,
          formState,
          { name: user.name, role: user.role },
        );
        notify({
          title: 'Transaction Bundle synced to FHIR',
          description: `${res.responseBundle.entry?.length ?? 0} linked resources created with urn:uuid resolution.`,
          variant: 'success',
        });
      } else {
        const res = await providerService.createOrUpdateProvider(
          fhirContext,
          formState,
          { name: user.name, role: user.role },
        );
        notify({
          title: res.created
            ? `Provider ${res.provider.fullName} created`
            : `Provider ${res.provider.fullName} updated / matched by NPI`,
          variant: 'success',
        });
      }
      setModalOpen(false);
      await loadProviders();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const handleMerge = async (dup: DuplicateCandidate) => {
    await providerService.mergeDuplicateProviders(
      fhirContext,
      dup.primary.id,
      dup.candidate.id,
      `Duplicate score ${dup.score}: ${dup.reasons.join('; ')}`,
      { name: user.name, role: user.role },
    );
    notify({
      title: 'Duplicate merged & Provenance recorded',
      description: `${dup.candidate.fullName} merged into ${dup.primary.fullName}.`,
      variant: 'success',
    });
    await loadProviders();
  };

  const columns: DataTableColumn<ProviderDirectoryRow>[] = [
    {
      key: 'name',
      header: 'Provider',
      sortable: true,
      sortValue: (p) => p.fullName,
      render: (p) => (
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-100">{p.fullName}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {p.providerType} · {p.specialty}
          </p>
        </div>
      ),
    },
    {
      key: 'npi',
      header: 'NPI / Medicaid ID',
      sortable: true,
      sortValue: (p) => p.npi,
      render: (p) => (
        <div className="font-mono text-xs tabular-nums">
          <p className="text-slate-900 dark:text-slate-100">{p.npi}</p>
          <p className="text-slate-500">{p.medicaidId || '—'}</p>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      sortable: true,
      sortValue: (p) => `${p.city}, ${p.state}`,
      render: (p) => (
        <span className="text-xs text-slate-700 dark:text-slate-300">
          {p.city}, {p.state} {p.postalCode}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (p) => p.status,
      render: (p) => (
        <SemanticStatus label={p.status} tone={statusTone(p.status)} />
      ),
    },
    {
      key: 'accepting',
      header: 'New Patients',
      render: (p) => (
        <span className="text-xs text-slate-700 dark:text-slate-300">
          {p.acceptingNewPatients ? 'Accepting' : 'Closed'}
        </span>
      ),
    },
  ];

  // Provider 360 Detail View
  if (selected360) {
    const p = selected360.provider;
    return (
      <Guard moduleId="m3-directory" action="view" moduleName="Provider 360" showForbiddenPage>
        <div className="space-y-6">
          <PageHeader
            kicker={`M3 · Provider 360 · NPI ${p.npi} · ${p.medicaidId || 'No Medicaid ID'}`}
            title={p.fullName}
            description={`${p.providerType} · ${p.specialty} (${p.taxonomyCode}) · ${p.city}, ${p.state}`}
            actions={
              <>
                <Button onClick={() => setSelected360(null)}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span>Back to Directory</span>
                </Button>
                {canEdit && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      const parts = p.fullName.replace(/^(Dr\.|NP|PA)\s+/, '').split(' ');
                      setFormState({
                        id: p.id,
                        prefix: p.resource.name?.[0]?.prefix?.[0] ?? '',
                        given: p.resource.name?.[0]?.given?.[0] ?? parts[0] ?? '',
                        family: p.resource.name?.[0]?.family ?? parts[1] ?? '',
                        npi: p.npi,
                        medicaidId: p.medicaidId,
                        providerType: p.providerType,
                        taxonomyCode: p.taxonomyCode,
                        specialty: p.specialty,
                        licenseNumber: p.licenseNumber,
                        licenseState: p.licenseState,
                        status: p.status,
                        acceptingNewPatients: p.acceptingNewPatients,
                        street: p.street,
                        city: p.city,
                        state: p.state,
                        postalCode: p.postalCode,
                        phone: p.phone,
                        email: p.email,
                      });
                      setModalOpen(true);
                    }}
                  >
                    Edit Profile
                  </Button>
                )}
              </>
            }
          />

          <Tabs
            activeTab={p360Tab}
            onChange={setP360Tab}
            tabs={[
              { id: 'profile', label: 'Profile' },
              { id: 'roles', label: 'Roles & Specialties', count: selected360.roles.length },
              { id: 'locations', label: 'Locations', count: selected360.locations.length },
              { id: 'identifiers', label: 'Identifiers' },
              { id: 'status-history', label: 'Status History', count: selected360.provenance.length },
              { id: 'documents', label: 'Documents' },
              { id: 'enrollment', label: 'Enrollment Cases' },
              { id: 'credentialing', label: 'Credentialing' },
              { id: 'alerts', label: 'Alerts' },
              { id: 'audit', label: 'Audit', count: selected360.audits.length },
            ]}
          />

          <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            {p360Tab === 'profile' && (
              <dl className="grid grid-cols-1 gap-6 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs text-slate-500">Enrollment Status</dt>
                  <dd className="mt-1">
                    <SemanticStatus label={`${p.status} (since ${p.statusEffectiveStart})`} tone={statusTone(p.status)} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Provider Type</dt>
                  <dd className="mt-1 font-medium">{p.providerType}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Accepting New Patients</dt>
                  <dd className="mt-1 font-medium">{p.acceptingNewPatients ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Practice Address</dt>
                  <dd className="mt-1">{p.street}, {p.city}, {p.state} {p.postalCode}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Work Phone / Email</dt>
                  <dd className="mt-1 font-mono text-xs">{p.phone || '—'} · {p.email || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Last Verified</dt>
                  <dd className="mt-1 font-mono text-xs">{p.lastVerifiedDate ?? '—'}</dd>
                </div>
              </dl>
            )}

            {p360Tab === 'roles' && (
              <div className="space-y-3">
                {selected360.roles.length === 0 ? (
                  <p className="text-sm text-slate-500">No PractitionerRole resources linked yet.</p>
                ) : (
                  selected360.roles.map((r) => (
                    <div key={r.id} className="rounded-md border border-slate-200 p-4 text-sm dark:border-slate-800">
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {r.organization?.display ?? 'Independent Practice'} · {r.specialty?.[0]?.coding?.[0]?.display ?? p.specialty}
                      </p>
                      <p className="mt-1 font-mono text-xs text-slate-500">
                        PractitionerRole/{r.id} · Taxonomy {r.specialty?.[0]?.coding?.[0]?.code ?? p.taxonomyCode} · Active: {String(r.active)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}

            {p360Tab === 'locations' && (
              <div className="space-y-3">
                {selected360.locations.length === 0 ? (
                  <p className="text-sm text-slate-500">Primary practice address: {p.street}, {p.city}, {p.state} {p.postalCode}</p>
                ) : (
                  selected360.locations.map((loc) => (
                    <div key={loc.id} className="rounded-md border border-slate-200 p-4 text-sm dark:border-slate-800">
                      <p className="font-medium">{loc.name}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {loc.address?.line?.join(', ')}, {loc.address?.city}, {loc.address?.state} {loc.address?.postalCode}
                      </p>
                    </div>
                  ))
                )}
                {selected360.endpoints.length > 0 && (
                  <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                    <h3 className="text-xs font-semibold text-slate-500">FHIR / Direct Endpoints</h3>
                    {selected360.endpoints.map((ep) => (
                      <p key={ep.id} className="mt-1 font-mono text-xs text-slate-800 dark:text-slate-200">
                        {ep.name}: {ep.address} ({ep.status})
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {p360Tab === 'identifiers' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    SSN, TIN, DOB, and EFT bank details are masked by default. Unmasking writes a FHIR AuditEvent.
                  </p>
                  {canUnmask && (
                    <Button size="sm" onClick={() => void handleToggleUnmask()}>
                      {unmasked ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                      <span>{unmasked ? 'Mask PII' : 'Unmask PII (Audited)'}</span>
                    </Button>
                  )}
                </div>
                <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt className="text-xs text-slate-500">US NPI (Luhn Verified)</dt>
                    <dd className="mt-1 font-mono">{p.npi} · {validateNpi(p.npi) ? 'Valid' : 'Invalid'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Medicaid ID</dt>
                    <dd className="mt-1 font-mono">{p.medicaidId || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">State License</dt>
                    <dd className="mt-1 font-mono">{p.licenseState}-{p.licenseNumber || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Tax ID (TIN)</dt>
                    <dd className="mt-1 font-mono">{unmasked ? (p.tin ?? '—') : maskSensitiveValue(p.tin, 'tin')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">SSN (Synthetic)</dt>
                    <dd className="mt-1 font-mono">{unmasked ? (p.ssn ?? '—') : maskSensitiveValue(p.ssn, 'ssn')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Date of Birth</dt>
                    <dd className="mt-1 font-mono">{unmasked ? (p.dob ?? '—') : maskSensitiveValue(p.dob, 'dob')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">EFT Bank Account</dt>
                    <dd className="mt-1 font-mono">{unmasked ? (p.bankAccount ?? '—') : maskSensitiveValue(p.bankAccount, 'bank')}</dd>
                  </div>
                </dl>
              </div>
            )}

            {p360Tab === 'status-history' && (
              <Timeline
                items={[
                  {
                    id: 'curr-status',
                    timestamp: `${p.statusEffectiveStart}T00:00:00Z`,
                    title: `Current Status: ${p.status}`,
                    subtitle: `Practitioner/${p.id} (v${p.resource.meta?.versionId ?? '1'})`,
                  },
                  ...selected360.provenance.map((pv) => ({
                    id: pv.id ?? pv.recorded,
                    timestamp: pv.recorded,
                    title: pv.activity?.coding?.[0]?.display ?? 'Provenance Record',
                    subtitle: pv.reason?.[0]?.text,
                    detail: pv.agent?.[0]?.who?.display,
                  })),
                ]}
              />
            )}

            {p360Tab === 'documents' && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Required documents per tenant rule ({p.providerType}):{' '}
                {(activeTenant.businessRules.requiredDocuments[p.providerType] ?? ['State License', 'W-9 Form']).join(', ')}.
                Upload and SHA-256 verification integrates with M5 Enrollment Wizard in Phase 2.
              </p>
            )}

            {p360Tab === 'enrollment' && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Enrollment workflow cases (M5–M8) linked to Practitioner/{p.id} will appear here once Phase 2 Provider Lifecycle is enabled.
              </p>
            )}

            {p360Tab === 'credentialing' && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Primary Source Verification (PSV) files and recredentialing cycle ({activeTenant.businessRules.recredentialingMonths} months) link to M9 Credentialing in Phase 2.
              </p>
            )}

            {p360Tab === 'alerts' && (
              <div className="space-y-2 text-sm">
                {p.status === 'Suspended' ? (
                  <SemanticStatus label="Claims blocked: Provider status is Suspended" tone="danger" />
                ) : p.status === 'Revalidation Due' ? (
                  <SemanticStatus label="Action required: Revalidation due" tone="warning" />
                ) : (
                  <SemanticStatus label="No active compliance alerts" tone="success" />
                )}
              </div>
            )}

            {p360Tab === 'audit' && (
              <Timeline
                items={selected360.audits.map((a) => ({
                  id: a.id ?? a.recorded,
                  timestamp: a.recorded,
                  title: a.outcomeDesc ?? a.type.display ?? 'AuditEvent',
                  subtitle: `${a.agent?.[0]?.name ?? 'System'} (${a.agent?.[0]?.altId ?? ''})`,
                }))}
              />
            )}
          </div>
        </div>
      </Guard>
    );
  }

  return (
    <Guard
      moduleId="m3-directory"
      action="view"
      moduleName="Provider Master Data & Directory (M3)"
      showForbiddenPage
    >
      <div className="space-y-6">
        <PageHeader
          kicker={`M3 · Tenant ${activeTenant.code} · ${providers.length} Providers`}
          title="Provider Master Data & Directory"
          description="Search enrolled providers across Practitioner, Organization, Location, and Endpoint resources, open Provider 360 profiles, resolve duplicates with Provenance, and sync FHIR transaction bundles."
          actions={
            <>
              {canExport && (
                <Button onClick={() => void handleExportCsv()}>
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Export CSV</span>
                </Button>
              )}
              {canCreate && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setFormState({
                      prefix: 'Dr.',
                      given: '',
                      family: '',
                      npi: '',
                      medicaidId: '',
                      providerType: activeTenant.businessRules.providerTypes[0] ?? 'Individual Physician',
                      taxonomyCode: activeTenant.codeSets.taxonomies[0]?.code ?? '207Q00000X',
                      specialty: activeTenant.codeSets.taxonomies[0]?.display ?? 'Family Medicine',
                      licenseNumber: '',
                      licenseState: 'NY',
                      status: 'Active',
                      acceptingNewPatients: true,
                      street: '',
                      city: '',
                      state: 'NY',
                      postalCode: '',
                      phone: '',
                      email: '',
                      organizationName: '',
                      endpointUrl: '',
                    });
                    setFormError(null);
                    setModalOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Add Provider</span>
                </Button>
              )}
            </>
          }
        />

        <Tabs
          activeTab={activeView}
          onChange={(id) => setActiveView(id as 'directory' | 'duplicates')}
          tabs={[
            { id: 'directory', label: 'Provider Directory', count: filteredProviders.length },
            { id: 'duplicates', label: 'Duplicate Review', count: duplicates.length },
          ]}
        />

        {activeView === 'directory' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Select
                aria-label="Filter by status"
                value={statusFilter}
                options={[
                  { value: 'all', label: 'All statuses' },
                  { value: 'Active', label: 'Active' },
                  { value: 'Pending', label: 'Pending' },
                  { value: 'Applicant', label: 'Applicant' },
                  { value: 'Revalidation Due', label: 'Revalidation Due' },
                  { value: 'Suspended', label: 'Suspended' },
                  { value: 'Terminated', label: 'Terminated' },
                ]}
                onChange={(e) => setStatusFilter(e.target.value)}
              />
              <Select
                aria-label="Filter by provider type"
                value={typeFilter}
                options={[
                  { value: 'all', label: 'All provider types' },
                  ...activeTenant.businessRules.providerTypes.map((t) => ({
                    value: t,
                    label: t,
                  })),
                ]}
                onChange={(e) => setTypeFilter(e.target.value)}
              />
              <Select
                aria-label="Filter by specialty"
                value={specialtyFilter}
                options={[
                  { value: 'all', label: 'All specialties' },
                  ...activeTenant.codeSets.specialties.map((s) => ({
                    value: s,
                    label: s,
                  })),
                ]}
                onChange={(e) => setSpecialtyFilter(e.target.value)}
              />
              <Input
                aria-label="Filter by state"
                placeholder="State (e.g. NY, IL)"
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
              />
              <Select
                aria-label="Filter by accepting new patients"
                value={acceptingFilter}
                options={[
                  { value: 'all', label: 'Accepting: Any' },
                  { value: 'yes', label: 'Accepting new patients' },
                  { value: 'no', label: 'Not accepting' },
                ]}
                onChange={(e) => setAcceptingFilter(e.target.value)}
              />
            </div>

            <DataTable
              rows={filteredProviders}
              columns={columns}
              getRowKey={(p) => p.id}
              loading={loading}
              error={error}
              onRetry={() => void loadProviders()}
              onRowClick={(row) => void handleOpen360(row)}
              searchPlaceholder="Search by name, NPI, specialty, or city..."
              searchText={(p) => `${p.fullName} ${p.npi} ${p.medicaidId} ${p.specialty} ${p.city} ${p.state}`}
            />
          </div>
        )}

        {activeView === 'duplicates' && (
          <div className="space-y-4">
            {duplicates.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                No potential duplicate providers scored above threshold (30+) in {activeTenant.code}.
              </div>
            ) : (
              duplicates.map((dup) => (
                <div
                  key={dup.id}
                  className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Match Score: <span className="font-mono">{dup.score}/100</span>
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Signals: {dup.reasons.join(' · ')}
                      </p>
                    </div>
                    {canEdit && (
                      <Button variant="primary" size="sm" onClick={() => void handleMerge(dup)}>
                        <GitMerge className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Merge into Primary (Record Provenance)</span>
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {[
                      { label: 'Surviving Primary', row: dup.primary },
                      { label: 'Duplicate Candidate', row: dup.candidate },
                    ].map(({ label, row }) => (
                      <div
                        key={row.id}
                        className="rounded-md border border-slate-200 p-3 text-xs dark:border-slate-800"
                      >
                        <p className="font-semibold text-slate-500">{label}</p>
                        <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                          {row.fullName}
                        </p>
                        <p className="mt-1 font-mono text-slate-600 dark:text-slate-400">
                          NPI: {row.npi} · Status: {row.status}
                        </p>
                        <p className="text-slate-600 dark:text-slate-400">
                          {row.street}, {row.city}, {row.state} · TIN: {maskSensitiveValue(row.tin, 'tin')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <Modal
          open={modalOpen}
          title={formState.id ? 'Edit Provider' : 'Create / Sync Provider'}
          description="Validates US NPI Luhn check digit. Uses conditionalCreate on NPI or publishes a full FHIR transaction Bundle."
          maxWidthClass="max-w-2xl"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
              {!formState.id && (
                <Button onClick={() => void handleSaveProvider(true)}>
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sync Full Transaction Bundle</span>
                </Button>
              )}
              <Button variant="primary" onClick={() => void handleSaveProvider(false)}>
                Save Practitioner
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {formError && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {formError}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input label="Prefix" value={formState.prefix ?? ''} onChange={(e) => setFormState({ ...formState, prefix: e.target.value })} />
              <Input label="First Name" required value={formState.given} onChange={(e) => setFormState({ ...formState, given: e.target.value })} />
              <Input label="Last Name" required value={formState.family} onChange={(e) => setFormState({ ...formState, family: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="NPI (10-digit Luhn)"
                required
                value={formState.npi}
                hint="e.g. 1245319599"
                error={formState.npi && !validateNpi(formState.npi) ? 'Failed NPI Luhn check digit' : undefined}
                onChange={(e) => setFormState({ ...formState, npi: e.target.value })}
              />
              <Input label="Medicaid ID" value={formState.medicaidId ?? ''} onChange={(e) => setFormState({ ...formState, medicaidId: e.target.value })} />
              <Select
                label="Provider Type"
                value={formState.providerType}
                options={activeTenant.businessRules.providerTypes.map((t) => ({ value: t, label: t }))}
                onChange={(e) => setFormState({ ...formState, providerType: e.target.value })}
              />
              <Select
                label="Taxonomy / Specialty"
                value={formState.taxonomyCode}
                options={activeTenant.codeSets.taxonomies.map((t) => ({
                  value: t.code,
                  label: `${t.code} — ${t.display}`,
                }))}
                onChange={(e) => {
                  const found = activeTenant.codeSets.taxonomies.find((t) => t.code === e.target.value);
                  setFormState({
                    ...formState,
                    taxonomyCode: e.target.value,
                    specialty: found?.display ?? e.target.value,
                  });
                }}
              />
              <Input label="License Number" value={formState.licenseNumber} onChange={(e) => setFormState({ ...formState, licenseNumber: e.target.value })} />
              <Select
                label="Enrollment Status"
                value={formState.status}
                options={['Applicant', 'Pending', 'Active', 'Revalidation Due', 'Suspended', 'Terminated'].map((s) => ({
                  value: s,
                  label: s,
                }))}
                onChange={(e) => setFormState({ ...formState, status: e.target.value as ProviderEnrollmentStatus })}
              />
              <Input label="Street" value={formState.street} onChange={(e) => setFormState({ ...formState, street: e.target.value })} />
              <Input label="City" value={formState.city} onChange={(e) => setFormState({ ...formState, city: e.target.value })} />
              <Input label="State" value={formState.state} onChange={(e) => setFormState({ ...formState, state: e.target.value })} />
              <Input label="Postal Code" value={formState.postalCode} onChange={(e) => setFormState({ ...formState, postalCode: e.target.value })} />
              <Input label="Work Phone" value={formState.phone} onChange={(e) => setFormState({ ...formState, phone: e.target.value })} />
              <Input label="Work Email" value={formState.email} onChange={(e) => setFormState({ ...formState, email: e.target.value })} />
            </div>
          </div>
        </Modal>
      </div>
    </Guard>
  );
}
