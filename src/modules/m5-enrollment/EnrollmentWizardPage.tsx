import { useEffect, useMemo, useState } from 'react';
import {
  FileCheck2,
  FileUp,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Guard, useAuth } from '../../app';
import {
  Button,
  DataTable,
  Drawer,
  Input,
  PageHeader,
  Select,
  SemanticStatus,
  Stepper,
  Tabs,
  TextArea,
  Timeline,
  useToast,
  type DataTableColumn,
  type SemanticTone,
} from '../../components';
import { buildValidNpi, validateNpi } from '../../rules';
import { useTenantContext } from '../../tenancy';
import {
  buildRequiredDocumentsForProviderType,
  computeApplicationFee,
  createBlankApplication,
  enrollmentService,
  type ApplicationType,
  type EnrollmentApplication,
  type EnrollmentStatus,
} from './enrollmentService';

const WIZARD_STEPS = [
  { id: 'applicant', label: '1. Applicant' },
  { id: 'type', label: '2. App Type' },
  { id: 'specialty', label: '3. Provider Type' },
  { id: 'contract', label: '4. Contract' },
  { id: 'org', label: '5. Organization' },
  { id: 'disclosures', label: '6. Disclosures' },
  { id: 'locations', label: '7. Locations' },
  { id: 'licenses', label: '8. Licenses' },
  { id: 'billing', label: '9. Billing' },
  { id: 'documents', label: '10. Documents' },
  { id: 'attestation', label: '11. Attestation' },
  { id: 'submit', label: '12. Review' },
];

function statusTone(status: EnrollmentStatus): SemanticTone {
  switch (status) {
    case 'Approved':
      return 'success';
    case 'Denied':
    case 'Withdrawn':
      return 'danger';
    case 'RFI Issued':
      return 'warning';
    case 'Draft':
      return 'neutral';
    default:
      return 'info';
  }
}

export function EnrollmentWizardPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user, can } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'portal' | 'wizard'>('portal');
  const [applications, setApplications] = useState<EnrollmentApplication[]>(() =>
    enrollmentService.listApplications(activeTenant.id),
  );
  const [draft, setDraft] = useState<EnrollmentApplication>(() => {
    const saved = enrollmentService.loadSavedLocalDraft(activeTenant.id);
    return saved ?? createBlankApplication(activeTenant.id);
  });
  const [selectedApp, setSelectedApp] = useState<EnrollmentApplication | null>(null);
  const [rfiResponseText, setRfiResponseText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setApplications(enrollmentService.listApplications(activeTenant.id));
    const saved = enrollmentService.loadSavedLocalDraft(activeTenant.id);
    setDraft(saved ?? createBlankApplication(activeTenant.id));
    setSelectedApp(null);
    return enrollmentService.subscribe(() => {
      setApplications([...enrollmentService.listApplications(activeTenant.id)]);
    });
  }, [activeTenant.id]);

  // Autosave whenever draft changes while in Draft status
  useEffect(() => {
    if (tab === 'wizard' && draft.status === 'Draft' && (draft.applicantGiven || draft.npi)) {
      const timer = setTimeout(() => {
        enrollmentService.saveDraft(activeTenant.id, draft);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [draft, tab, activeTenant.id]);

  const progressPct = Math.round(((draft.currentStep + 1) / WIZARD_STEPS.length) * 100);

  const handleStartNew = () => {
    const fresh = createBlankApplication(activeTenant.id);
    setDraft(fresh);
    setTab('wizard');
  };

  const handleResumeDraft = (app: EnrollmentApplication) => {
    setDraft({ ...app });
    setTab('wizard');
  };

  const handleFillSampleApplicant = () => {
    const sampleNpi = buildValidNpi(String(Math.floor(145000000 + Math.random() * 40000000)));
    const pType = activeTenant.businessRules.providerTypes[0] ?? 'Individual Physician';
    const fee = computeApplicationFee(activeTenant.id, pType);
    const docs = buildRequiredDocumentsForProviderType(activeTenant.id, pType).map(
      (d, idx) => ({
        ...d,
        fileName: `${d.requirementName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 142000 + idx * 5000,
        sha256: `c0ffee00112233445566778899aabbccddeeff00112233445566778899aabb0${idx}`,
        status: 'Uploaded' as const,
        uploadedAt: new Date().toISOString(),
      }),
    );
    setDraft((prev) => ({
      ...prev,
      applicantPrefix: 'Dr.',
      applicantGiven: 'Camila',
      applicantFamily: 'Orozco',
      applicantEmail: 'camila.orozco@synthetic-clinic.example',
      applicantPhone: '518-555-0192',
      npi: sampleNpi,
      providerType: pType,
      specialty: 'Family Medicine',
      organizationName: 'Capital Community Care LLC',
      tin: '46-7718293',
      disclosures: [
        {
          id: 'disc-sample',
          name: 'Dr. Camila Orozco',
          role: 'Owner (>=5%)',
          ownershipPercent: 100,
          ssnOrTinLast4: '8420',
          hasSanctions: false,
        },
      ],
      locations: [
        {
          id: 'loc-sample',
          clinicName: 'Capital Community Care — Main',
          street: '350 Broadway',
          city: 'Albany',
          state: 'NY',
          postalCode: '12207',
          phone: '518-555-0192',
          hours: 'Mon–Fri 08:00–17:00',
          acceptingNewPatients: true,
        },
      ],
      licenseNumber: '318944',
      licenseState: 'NY',
      licenseExpiry: '2028-12-31',
      deaNumber: 'BO7788991',
      taxonomyCode: '207Q00000X',
      billingNpi: sampleNpi,
      documents: docs,
      feeAmountUsd: fee.feeAmountUsd,
      feeStatus: fee.feeStatus === 'Waived' ? 'Waived' : 'Paid',
      attestedTruthful: true,
      attestedCompliance: true,
      eSignatureName: 'Dr. Camila Orozco',
    }));
    showToast('Populated synthetic enrollment draft with valid Luhn NPI and documents.', 'info');
  };

  const handleProviderTypeChange = (nextType: string) => {
    const fee = computeApplicationFee(activeTenant.id, nextType);
    const docs = buildRequiredDocumentsForProviderType(activeTenant.id, nextType);
    setDraft((prev) => ({
      ...prev,
      providerType: nextType,
      feeAmountUsd: fee.feeAmountUsd,
      feeStatus: fee.feeStatus,
      documents: docs,
    }));
  };

  const handleDocumentUpload = async (
    requirementName: string,
    file: File | undefined,
  ) => {
    if (!file) return;
    try {
      const content = await file.arrayBuffer();
      const uploaded = await enrollmentService.uploadDocument(
        fhirContext,
        draft.id,
        requirementName,
        {
          name: file.name,
          type: file.type || 'application/pdf',
          size: file.size,
          content,
        },
        { name: user.name, role: user.role },
      );
      setDraft((prev) => ({
        ...prev,
        documents: prev.documents.map((d) =>
          d.requirementName === requirementName ? uploaded : d,
        ),
      }));
      showToast(`Uploaded ${file.name} (SHA-256 verified).`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    }
  };

  const handleSimulateSampleDocUpload = async (requirementName: string) => {
    try {
      const syntheticName = `${requirementName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_synthetic.pdf`;
      const uploaded = await enrollmentService.uploadDocument(
        fhirContext,
        draft.id,
        requirementName,
        {
          name: syntheticName,
          type: 'application/pdf',
          size: 98304,
          content: `Synthetic document content for ${requirementName} (${draft.applicationNumber})`,
        },
        { name: user.name, role: user.role },
      );
      setDraft((prev) => ({
        ...prev,
        documents: prev.documents.map((d) =>
          d.requirementName === requirementName ? uploaded : d,
        ),
      }));
      showToast(`Attached synthetic ${syntheticName} with SHA-256 hash.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to attach document', 'error');
    }
  };

  const handleSaveAndExit = () => {
    enrollmentService.saveDraft(activeTenant.id, draft);
    showToast(`Draft ${draft.applicationNumber} saved.`, 'success');
    setTab('portal');
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const submitted = await enrollmentService.submitApplication(
        fhirContext,
        draft,
        { name: user.name, role: user.role },
      );
      showToast(
        `Submitted ${submitted.applicationNumber}. Published ProviderSubmitted event for M6 Validation.`,
        'success',
      );
      setSelectedApp(submitted);
      setDraft(createBlankApplication(activeTenant.id));
      setTab('portal');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Submission failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRespondRfi = async () => {
    if (!selectedApp) return;
    const openRfi = selectedApp.rfis.find((r) => r.status === 'Open');
    if (!openRfi) return;
    if (!rfiResponseText.trim()) {
      showToast('Enter an RFI response message before submitting.', 'warning');
      return;
    }
    try {
      const uploadedDoc = await enrollmentService.uploadDocument(
        fhirContext,
        selectedApp.id,
        'RFI Supporting Evidence',
        {
          name: `rfi_response_${selectedApp.applicationNumber}.pdf`,
          type: 'application/pdf',
          size: 64000,
          content: rfiResponseText,
        },
        { name: user.name, role: user.role },
      );
      const updated = await enrollmentService.respondToRfi(
        fhirContext,
        selectedApp.id,
        openRfi.id,
        rfiResponseText,
        uploadedDoc,
        { name: user.name, role: user.role },
      );
      setSelectedApp({ ...updated });
      setRfiResponseText('');
      showToast('RFI response submitted. Case resumed in Review.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'RFI submission failed', 'error');
    }
  };

  const columns = useMemo<DataTableColumn<EnrollmentApplication>[]>(
    () => [
      {
        key: 'appNo',
        header: 'Application #',
        sortable: true,
        sortValue: (a) => a.applicationNumber,
        render: (a) => (
          <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
            {a.applicationNumber}
          </span>
        ),
      },
      {
        key: 'applicant',
        header: 'Applicant / Organization',
        sortable: true,
        sortValue: (a) => `${a.applicantFamily} ${a.applicantGiven}`,
        render: (a) => (
          <div>
            <p className="font-medium text-slate-900 dark:text-slate-100">
              {[a.applicantPrefix, a.applicantGiven, a.applicantFamily].filter(Boolean).join(' ') || 'Draft Applicant'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {a.organizationName || 'Organization pending'} · NPI {a.npi || '—'}
            </p>
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Type & Specialty',
        render: (a) => (
          <div className="text-xs">
            <p className="text-slate-800 dark:text-slate-200">{a.applicationType}</p>
            <p className="text-slate-500 dark:text-slate-400">{a.providerType}</p>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        sortValue: (a) => a.status,
        render: (a) => <SemanticStatus tone={statusTone(a.status)} label={a.status} />,
      },
      {
        key: 'sla',
        header: 'SLA Due',
        render: (a) => (
          <span className="font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">
            {a.slaDueDate ?? '—'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        render: (a) => (
          <div className="flex justify-end gap-2">
            {a.status === 'Draft' && can('m5-enrollment', 'edit') && (
              <Button size="sm" variant="secondary" onClick={() => handleResumeDraft(a)}>
                Resume
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelectedApp(a)}>
              Tracker
            </Button>
          </div>
        ),
      },
    ],
    [can],
  );

  const submitErrors = enrollmentService.validateApplicationForSubmit(draft);

  return (
    <Guard moduleId="m5-enrollment" action="view">
      <div className="space-y-6">
        <PageHeader
          kicker={`M5 · Provider Enrollment Portal · ${activeTenant.code}`}
          title="Enrollment Application Wizard"
          description="Tenant-configurable 12-step Medicaid provider enrollment with autosave, browser SHA-256 document verification, FHIR QuestionnaireResponse persistence, and RFI tracking."
          actions={
            can('m5-enrollment', 'create') ? (
              <Button onClick={handleStartNew}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>New Application</span>
              </Button>
            ) : undefined
          }
        />

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as 'portal' | 'wizard')}
          tabs={[
            { id: 'portal', label: `Applications & Tracker (${applications.length})` },
            { id: 'wizard', label: `12-Step Wizard (${draft.applicationNumber})` },
          ]}
        />

        {tab === 'portal' && (
          <div className="space-y-6">
            <dl className="grid grid-cols-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white sm:grid-cols-4 sm:divide-y-0 sm:divide-x dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              <div className="p-4">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Total applications</dt>
                <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {applications.length}
                </dd>
              </div>
              <div className="p-4">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Submitted / In progress</dt>
                <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-sky-700 dark:text-sky-400">
                  {applications.filter((a) => ['Submitted', 'In Validation', 'In Screening', 'In Review'].includes(a.status)).length}
                </dd>
              </div>
              <div className="p-4">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Open RFIs</dt>
                <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {applications.filter((a) => a.status === 'RFI Issued').length}
                </dd>
              </div>
              <div className="p-4">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Tenant SLA target</dt>
                <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {activeTenant.businessRules.slaDays}d
                </dd>
              </div>
            </dl>

            <DataTable
              rows={applications}
              columns={columns}
              getRowKey={(a) => a.id}
              searchPlaceholder="Search by application #, applicant, organization, or NPI..."
              searchText={(a) =>
                `${a.applicationNumber} ${a.applicantGiven} ${a.applicantFamily} ${a.organizationName} ${a.npi} ${a.status}`
              }
              emptyTitle="No enrollment applications"
              emptyDescription="Start a new 12-step provider enrollment application to submit to the validation engine."
            />
          </div>
        )}

        {tab === 'wizard' && (
          <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  {draft.applicationNumber} · Autosave active · Progress {progressPct}%
                </p>
                <h2 className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {WIZARD_STEPS[draft.currentStep]?.label}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={handleFillSampleApplicant}>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Prefill Synthetic Data</span>
                </Button>
                <Button size="sm" variant="secondary" onClick={handleSaveAndExit}>
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Save &amp; Exit</span>
                </Button>
              </div>
            </div>

            <Stepper
              steps={WIZARD_STEPS}
              currentStepIndex={draft.currentStep}
              onStepClick={(idx) => setDraft((prev) => ({ ...prev, currentStep: idx }))}
            />

            {/* Step bodies */}
            <div className="pt-2">
              {draft.currentStep === 0 && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label="Prefix"
                    value={draft.applicantPrefix}
                    onChange={(e) => setDraft({ ...draft, applicantPrefix: e.target.value })}
                    placeholder="Dr."
                  />
                  <Input
                    label="10-Digit US NPI"
                    required
                    value={draft.npi}
                    onChange={(e) => setDraft({ ...draft, npi: e.target.value })}
                    hint={
                      draft.npi
                        ? validateNpi(draft.npi)
                          ? 'Valid Luhn NPI — simulated NPPES lookup matched.'
                          : 'Invalid NPI check digit (US Luhn 80840 failed).'
                        : 'Enter a 10-digit NPI or use Prefill Synthetic Data.'
                    }
                    error={draft.npi && !validateNpi(draft.npi) ? 'Invalid NPI checksum' : undefined}
                  />
                  <Input
                    label="First (Given) Name"
                    required
                    value={draft.applicantGiven}
                    onChange={(e) => setDraft({ ...draft, applicantGiven: e.target.value })}
                  />
                  <Input
                    label="Last (Family) Name"
                    required
                    value={draft.applicantFamily}
                    onChange={(e) => setDraft({ ...draft, applicantFamily: e.target.value })}
                  />
                  <Input
                    label="Work Email"
                    type="email"
                    value={draft.applicantEmail}
                    onChange={(e) => setDraft({ ...draft, applicantEmail: e.target.value })}
                  />
                  <Input
                    label="Work Phone"
                    value={draft.applicantPhone}
                    onChange={(e) => setDraft({ ...draft, applicantPhone: e.target.value })}
                  />
                </div>
              )}

              {draft.currentStep === 1 && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Select
                    label="Application Type"
                    value={draft.applicationType}
                    onChange={(e) =>
                      setDraft({ ...draft, applicationType: e.target.value as ApplicationType })
                    }
                    options={activeTenant.businessRules.applicationTypes.map((t) => ({
                      value: t,
                      label: t,
                    }))}
                  />
                  <Input
                    label="Existing Medicaid ID (if Revalidation / Update / CHOW)"
                    value={draft.priorMedicaidId ?? ''}
                    onChange={(e) => setDraft({ ...draft, priorMedicaidId: e.target.value })}
                    placeholder="MCD-NY-000123"
                  />
                </div>
              )}

              {draft.currentStep === 2 && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Select
                    label="Provider Type (Tenant Configured)"
                    value={draft.providerType}
                    onChange={(e) => handleProviderTypeChange(e.target.value)}
                    options={activeTenant.businessRules.providerTypes.map((t) => ({
                      value: t,
                      label: t,
                    }))}
                    hint="Changing provider type updates required documents and fee waiver rules."
                  />
                  <Select
                    label="Primary Specialty"
                    value={draft.specialty}
                    onChange={(e) => setDraft({ ...draft, specialty: e.target.value })}
                    options={activeTenant.codeSets.specialties.map((s) => ({
                      value: s,
                      label: s,
                    }))}
                  />
                  <Input
                    label="Years in Practice / Business"
                    type="number"
                    min={0}
                    max={80}
                    value={String(draft.yearsInBusiness)}
                    onChange={(e) =>
                      setDraft({ ...draft, yearsInBusiness: Number(e.target.value) || 0 })
                    }
                  />
                </div>
              )}

              {draft.currentStep === 3 && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Select
                    label="Contract Program Participation"
                    value={draft.contractProgram}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        contractProgram: e.target.value as EnrollmentApplication['contractProgram'],
                      })
                    }
                    options={[
                      { value: 'FFS', label: 'Medicaid Fee-For-Service (FFS)' },
                      { value: 'Managed Care', label: 'Managed Care Organization (MCO)' },
                      { value: 'Both', label: 'Both FFS and Managed Care' },
                    ]}
                  />
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      Tenant Program Rules ({activeTenant.programTemplate})
                    </p>
                    <p className="mt-1">
                      Revalidation cycle: {activeTenant.businessRules.revalidationMonths} months ·
                      Recredentialing: {activeTenant.businessRules.recredentialingMonths} months ·
                      Application fee: ${draft.feeAmountUsd} ({draft.feeStatus})
                    </p>
                  </div>
                </div>
              )}

              {draft.currentStep === 4 && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Input
                    label="Legal Organization / Practice Name"
                    required
                    value={draft.organizationName}
                    onChange={(e) => setDraft({ ...draft, organizationName: e.target.value })}
                  />
                  <Select
                    label="Ownership Structure"
                    value={draft.ownershipType}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        ownershipType: e.target.value as EnrollmentApplication['ownershipType'],
                      })
                    }
                    options={[
                      { value: 'Sole Proprietor', label: 'Sole Proprietor' },
                      { value: 'LLC', label: 'LLC' },
                      { value: 'Corporation', label: 'Corporation' },
                      { value: 'Non-Profit', label: 'Non-Profit (501c3)' },
                      { value: 'Government', label: 'Government / Public' },
                    ]}
                  />
                  <Input
                    label="Federal Tax ID (EIN / TIN)"
                    required
                    value={draft.tin}
                    onChange={(e) => setDraft({ ...draft, tin: e.target.value })}
                    placeholder="XX-XXXXXXX"
                  />
                </div>
              )}

              {draft.currentStep === 5 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Disclose all owners with 5% or greater interest, managing employees, and subcontractors (42 CFR 455.104).
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          disclosures: [
                            ...prev.disclosures,
                            {
                              id: `disc-${Date.now()}`,
                              name: '',
                              role: 'Owner (>=5%)',
                              ownershipPercent: 10,
                              ssnOrTinLast4: '',
                              hasSanctions: false,
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Add Party</span>
                    </Button>
                  </div>
                  {draft.disclosures.map((d, idx) => (
                    <div
                      key={d.id}
                      className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-4 md:grid-cols-5 dark:border-slate-800"
                    >
                      <Input
                        label="Full Legal Name"
                        value={d.name}
                        onChange={(e) => {
                          const next = [...draft.disclosures];
                          next[idx] = { ...d, name: e.target.value };
                          setDraft({ ...draft, disclosures: next });
                        }}
                      />
                      <Select
                        label="Role"
                        value={d.role}
                        onChange={(e) => {
                          const next = [...draft.disclosures];
                          next[idx] = { ...d, role: e.target.value as typeof d.role };
                          setDraft({ ...draft, disclosures: next });
                        }}
                        options={[
                          { value: 'Owner (>=5%)', label: 'Owner (>=5%)' },
                          { value: 'Managing Employee', label: 'Managing Employee' },
                          { value: 'Subcontractor', label: 'Subcontractor' },
                        ]}
                      />
                      <Input
                        label="Ownership %"
                        type="number"
                        min={0}
                        max={100}
                        value={String(d.ownershipPercent)}
                        onChange={(e) => {
                          const next = [...draft.disclosures];
                          next[idx] = { ...d, ownershipPercent: Number(e.target.value) || 0 };
                          setDraft({ ...draft, disclosures: next });
                        }}
                      />
                      <Input
                        label="SSN/TIN Last 4"
                        maxLength={4}
                        value={d.ssnOrTinLast4}
                        onChange={(e) => {
                          const next = [...draft.disclosures];
                          next[idx] = { ...d, ssnOrTinLast4: e.target.value };
                          setDraft({ ...draft, disclosures: next });
                        }}
                      />
                      <div className="flex items-end justify-between gap-2">
                        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={d.hasSanctions}
                            onChange={(e) => {
                              const next = [...draft.disclosures];
                              next[idx] = { ...d, hasSanctions: e.target.checked };
                              setDraft({
                                ...draft,
                                disclosures: next,
                                hasPriorSanctions: next.some((x) => x.hasSanctions),
                              });
                            }}
                          />
                          Prior sanctions
                        </label>
                        {draft.disclosures.length > 1 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Remove disclosure"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                disclosures: draft.disclosures.filter((x) => x.id !== d.id),
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {draft.currentStep === 6 && (
                <div className="space-y-4">
                  {draft.locations.map((loc, idx) => (
                    <div
                      key={loc.id}
                      className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-4 md:grid-cols-3 dark:border-slate-800"
                    >
                      <Input
                        label="Clinic / Location Name"
                        value={loc.clinicName}
                        onChange={(e) => {
                          const next = [...draft.locations];
                          next[idx] = { ...loc, clinicName: e.target.value };
                          setDraft({ ...draft, locations: next });
                        }}
                      />
                      <Input
                        label="Street Address"
                        required
                        value={loc.street}
                        onChange={(e) => {
                          const next = [...draft.locations];
                          next[idx] = { ...loc, street: e.target.value };
                          setDraft({ ...draft, locations: next });
                        }}
                      />
                      <Input
                        label="City"
                        required
                        value={loc.city}
                        onChange={(e) => {
                          const next = [...draft.locations];
                          next[idx] = { ...loc, city: e.target.value };
                          setDraft({ ...draft, locations: next });
                        }}
                      />
                      <Input
                        label="State"
                        maxLength={2}
                        value={loc.state}
                        onChange={(e) => {
                          const next = [...draft.locations];
                          next[idx] = { ...loc, state: e.target.value.toUpperCase() };
                          setDraft({ ...draft, locations: next });
                        }}
                      />
                      <Input
                        label="ZIP Code"
                        value={loc.postalCode}
                        onChange={(e) => {
                          const next = [...draft.locations];
                          next[idx] = { ...loc, postalCode: e.target.value };
                          setDraft({ ...draft, locations: next });
                        }}
                      />
                      <Input
                        label="Office Hours"
                        value={loc.hours}
                        onChange={(e) => {
                          const next = [...draft.locations];
                          next[idx] = { ...loc, hours: e.target.value };
                          setDraft({ ...draft, locations: next });
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {draft.currentStep === 7 && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label="State License Number"
                    required
                    value={draft.licenseNumber}
                    onChange={(e) => setDraft({ ...draft, licenseNumber: e.target.value })}
                  />
                  <Input
                    label="License Issuing State"
                    maxLength={2}
                    value={draft.licenseState}
                    onChange={(e) =>
                      setDraft({ ...draft, licenseState: e.target.value.toUpperCase() })
                    }
                  />
                  <Input
                    label="License Expiration Date"
                    type="date"
                    value={draft.licenseExpiry}
                    onChange={(e) => setDraft({ ...draft, licenseExpiry: e.target.value })}
                  />
                  <Input
                    label="DEA Registration Number (Optional)"
                    value={draft.deaNumber}
                    onChange={(e) => setDraft({ ...draft, deaNumber: e.target.value })}
                    placeholder="AB1234563"
                  />
                </div>
              )}

              {draft.currentStep === 8 && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Select
                    label="NUCC Taxonomy Code"
                    value={draft.taxonomyCode}
                    onChange={(e) => setDraft({ ...draft, taxonomyCode: e.target.value })}
                    options={activeTenant.codeSets.taxonomies.map((t) => ({
                      value: t.code,
                      label: `${t.code} — ${t.display}`,
                    }))}
                  />
                  <Input
                    label="Billing NPI"
                    value={draft.billingNpi || draft.npi}
                    onChange={(e) => setDraft({ ...draft, billingNpi: e.target.value })}
                  />
                  <Input
                    label="EFT Bank Account Last 4 (Masked)"
                    maxLength={4}
                    value={draft.eftBankRoutingLast4}
                    onChange={(e) => setDraft({ ...draft, eftBankRoutingLast4: e.target.value })}
                  />
                </div>
              )}

              {draft.currentStep === 9 && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Required documents for <strong>{draft.providerType}</strong> (PDF, PNG, or JPG up to 10 MB). SHA-256 checksum is computed in-browser and stored in FHIR DocumentReference.
                  </p>
                  <div className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {draft.documents.map((doc) => (
                      <div
                        key={doc.requirementName}
                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <FileCheck2 className="h-4 w-4 text-slate-400" aria-hidden="true" />
                            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                              {doc.requirementName}
                            </span>
                            <SemanticStatus
                              tone={
                                doc.status === 'Uploaded'
                                  ? 'success'
                                  : doc.status === 'Rejected'
                                    ? 'danger'
                                    : 'warning'
                              }
                              label={doc.status}
                            />
                          </div>
                          {doc.fileName && (
                            <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                              {doc.fileName} · SHA-256: {doc.sha256?.slice(0, 16)}...
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                            <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Upload file</span>
                            <input
                              type="file"
                              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                              className="sr-only"
                              onChange={(e) =>
                                void handleDocumentUpload(doc.requirementName, e.target.files?.[0])
                              }
                            />
                          </label>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleSimulateSampleDocUpload(doc.requirementName)}
                          >
                            Attach Synthetic PDF
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {draft.currentStep === 10 && (
                <div className="space-y-4">
                  <label className="flex items-start gap-3 rounded-md border border-slate-200 p-4 text-sm text-slate-800 dark:border-slate-800 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={draft.attestedTruthful}
                      onChange={(e) => setDraft({ ...draft, attestedTruthful: e.target.checked })}
                      className="mt-0.5"
                    />
                    <span>
                      I certify under penalty of perjury that all information in this synthetic Medicaid enrollment application is accurate and complete.
                    </span>
                  </label>
                  <label className="flex items-start gap-3 rounded-md border border-slate-200 p-4 text-sm text-slate-800 dark:border-slate-800 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={draft.attestedCompliance}
                      onChange={(e) =>
                        setDraft({ ...draft, attestedCompliance: e.target.checked })
                      }
                      className="mt-0.5"
                    />
                    <span>
                      I agree to comply with 42 CFR Part 455 disclosure requirements, ongoing exclusion monitoring, and timely directory updates.
                    </span>
                  </label>
                  <Input
                    label="Authorized Electronic Signature (Type Full Legal Name)"
                    required
                    value={draft.eSignatureName}
                    onChange={(e) => setDraft({ ...draft, eSignatureName: e.target.value })}
                    placeholder="Dr. Camila Orozco"
                  />
                </div>
              )}

              {draft.currentStep === 11 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-md border border-slate-200 p-4 text-sm dark:border-slate-800">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                        Application Summary
                      </h3>
                      <dl className="mt-3 space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <dt className="text-slate-500">Applicant</dt>
                          <dd className="font-medium text-slate-900 dark:text-slate-100">
                            {draft.applicantGiven} {draft.applicantFamily} (NPI {draft.npi || '—'})
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-slate-500">Type / Specialty</dt>
                          <dd className="text-slate-800 dark:text-slate-200">
                            {draft.applicationType} · {draft.providerType} ({draft.specialty})
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-slate-500">Organization</dt>
                          <dd className="text-slate-800 dark:text-slate-200">
                            {draft.organizationName || '—'} · License {draft.licenseState}-{draft.licenseNumber || '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-slate-500">Documents uploaded</dt>
                          <dd className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                            {draft.documents.filter((d) => d.status === 'Uploaded').length} / {draft.documents.length}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="rounded-md border border-slate-200 p-4 text-sm dark:border-slate-800">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                          Application Fee (Simulated)
                        </h3>
                        <SemanticStatus
                          tone={draft.feeStatus === 'Pending' ? 'warning' : 'success'}
                          label={draft.feeStatus}
                        />
                      </div>
                      <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        ${draft.feeAmountUsd.toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {draft.feeStatus === 'Waived'
                          ? `Fee waived for ${draft.providerType} under tenant business rules.`
                          : draft.feeStatus === 'Paid'
                            ? 'Synthetic payment receipt confirmed.'
                            : 'Complete simulated payment before submitting.'}
                      </p>
                      {draft.feeStatus === 'Pending' && (
                        <Button
                          size="sm"
                          className="mt-3"
                          onClick={() => {
                            setDraft({ ...draft, feeStatus: 'Paid' });
                            showToast('Simulated application fee marked Paid.', 'success');
                          }}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Simulate Fee Payment</span>
                        </Button>
                      )}
                    </div>
                  </div>

                  {submitErrors.length > 0 && (
                    <div
                      role="alert"
                      className="rounded-md border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                    >
                      <p className="font-semibold">Complete the following before submission:</p>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4">
                        {submitErrors.map((err) => (
                          <li key={err}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
              <Button
                variant="secondary"
                disabled={draft.currentStep === 0}
                onClick={() =>
                  setDraft((prev) => ({ ...prev, currentStep: Math.max(0, prev.currentStep - 1) }))
                }
              >
                Previous Step
              </Button>
              {draft.currentStep < WIZARD_STEPS.length - 1 ? (
                <Button
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      currentStep: Math.min(WIZARD_STEPS.length - 1, prev.currentStep + 1),
                    }))
                  }
                >
                  Next Step
                </Button>
              ) : (
                <Button
                  loading={submitting}
                  disabled={submitErrors.length > 0 || !can('m5-enrollment', 'create')}
                  onClick={() => void handleSubmit()}
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  <span>Submit Enrollment</span>
                </Button>
              )}
            </div>
          </div>
        )}

        <Drawer
          open={Boolean(selectedApp)}
          onClose={() => setSelectedApp(null)}
          title={selectedApp ? `${selectedApp.applicationNumber} — Status Tracker` : ''}
        >
          {selectedApp && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {selectedApp.applicantGiven} {selectedApp.applicantFamily}
                  </p>
                  <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    NPI {selectedApp.npi} · {selectedApp.providerType}
                  </p>
                </div>
                <SemanticStatus tone={statusTone(selectedApp.status)} label={selectedApp.status} />
              </div>

              {selectedApp.rfis.some((r) => r.status === 'Open') && (
                <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
                  <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    Open Request for Information (RFI)
                  </h3>
                  {selectedApp.rfis
                    .filter((r) => r.status === 'Open')
                    .map((rfi) => (
                      <div key={rfi.id} className="space-y-2 text-xs text-amber-900 dark:text-amber-200">
                        <p>Due: {rfi.dueDate}</p>
                        <ul className="list-disc pl-4">
                          {rfi.deficiencies.map((d) => (
                            <li key={d}>{d}</li>
                          ))}
                        </ul>
                        <p>{rfi.notes}</p>
                      </div>
                    ))}
                  <TextArea
                    label="RFI Response & Explanation"
                    value={rfiResponseText}
                    onChange={(e) => setRfiResponseText(e.target.value)}
                    placeholder="Provide requested clarification; a synthetic supporting PDF will be attached automatically..."
                  />
                  <Button size="sm" onClick={() => void handleRespondRfi()}>
                    Submit RFI Response &amp; Resume Review
                  </Button>
                </div>
              )}

              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Lifecycle Timeline
                </h3>
                <Timeline
                  items={selectedApp.history.map((h, i) => ({
                    id: `${h.status}-${i}`,
                    title: h.status,
                    timestamp: new Date(h.timestamp).toLocaleString(),
                    description: `${h.note} — ${h.actor}`,
                    tone: statusTone(h.status),
                  }))}
                />
              </div>
            </div>
          )}
        </Drawer>
      </div>
    </Guard>
  );
}
