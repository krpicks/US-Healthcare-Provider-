import { eventBus } from '../../events';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { buildValidNpi, validateNpi } from '../../rules';
import { auditService } from '../../services/auditService';
import { tenantService } from '../../tenancy';
import {
  AppError,
  type FhirDocumentReference,
  type FhirQuestionnaireResponse,
  type FhirTask,
  type RoleName,
} from '../../types';
import type { ProviderDirectoryRow } from '../m3-directory/providerService';

export type EnrollmentStatus =
  | 'Draft'
  | 'Submitted'
  | 'In Validation'
  | 'In Screening'
  | 'In Review'
  | 'RFI Issued'
  | 'Approved'
  | 'Denied'
  | 'Withdrawn';

export type ApplicationType =
  | 'New Enrollment'
  | 'Revalidation'
  | 'Update'
  | 'Change of Ownership'
  | 'Reinstatement';

export type DocumentStatus = 'Missing' | 'Uploaded' | 'Rejected';

export interface OwnershipDisclosure {
  id: string;
  name: string;
  role: 'Owner (>=5%)' | 'Managing Employee' | 'Subcontractor';
  ownershipPercent: number;
  ssnOrTinLast4: string;
  hasSanctions: boolean;
}

export interface PracticeLocationEntry {
  id: string;
  clinicName: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  hours: string;
  acceptingNewPatients: boolean;
}

export interface UploadedEnrollmentDoc {
  id: string;
  requirementName: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  status: DocumentStatus;
  uploadedAt?: string;
  documentReferenceId?: string;
  rejectionReason?: string;
}

export interface StatusHistoryEvent {
  status: EnrollmentStatus;
  timestamp: string;
  actor: string;
  note: string;
}

export interface RfiItem {
  id: string;
  issuedAt: string;
  dueDate: string;
  deficiencies: string[];
  notes: string;
  status: 'Open' | 'Responded' | 'Expired';
  responseText?: string;
  respondedAt?: string;
  attachments?: string[];
}

export interface EnrollmentApplication {
  id: string;
  tenantId: string;
  applicationNumber: string;
  status: EnrollmentStatus;
  currentStep: number;
  // Step 1: Applicant & NPI
  applicantPrefix: string;
  applicantGiven: string;
  applicantFamily: string;
  applicantEmail: string;
  applicantPhone: string;
  npi: string;
  dob: string;
  // Step 2: Application type
  applicationType: ApplicationType;
  priorMedicaidId?: string;
  // Step 3: Provider type & specialty
  providerType: string;
  specialty: string;
  yearsInBusiness: number;
  // Step 4: Contract
  contractProgram: 'FFS' | 'Managed Care' | 'Both';
  requestedPlanIds: string[];
  // Step 5: Ownership type & org details
  ownershipType: 'Sole Proprietor' | 'LLC' | 'Corporation' | 'Non-Profit' | 'Government';
  organizationName: string;
  tin: string;
  // Step 6: Disclosures
  disclosures: OwnershipDisclosure[];
  hasPriorSanctions: boolean;
  // Step 7: Practice locations
  locations: PracticeLocationEntry[];
  // Step 8: Licenses, certifications, DEA
  licenseNumber: string;
  licenseState: string;
  licenseExpiry: string;
  deaNumber: string;
  boardCertified: boolean;
  // Step 9: Taxonomy & billing
  taxonomyCode: string;
  billingNpi: string;
  eftBankRoutingLast4: string;
  // Step 10: Documents
  documents: UploadedEnrollmentDoc[];
  // Step 11: Attestations & e-signature
  attestedTruthful: boolean;
  attestedCompliance: boolean;
  eSignatureName: string;
  eSignedAt?: string;
  // Step 12: Fee & FHIR refs
  feeAmountUsd: number;
  feeStatus: 'Pending' | 'Paid' | 'Waived';
  questionnaireResponseId?: string;
  taskId?: string;
  assignedAnalyst?: string;
  riskTier?: 'Limited' | 'Moderate' | 'High';
  submittedAt?: string;
  updatedAt: string;
  createdAt: string;
  slaDueDate?: string;
  history: StatusHistoryEvent[];
  rfis: RfiItem[];
}

const DRAFT_STORAGE_PREFIX = 'providerlink.m5.draft.';
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const MAX_DOC_BYTES = 10 * 1024 * 1024; // 10 MB

const tenantApplications = new Map<string, EnrollmentApplication[]>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

/**
 * Computes SHA-256 hex digest using Web Crypto SubtleCrypto with deterministic JS fallback for non-secure test contexts.
 */
export async function computeSha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Deterministic fallback hash if WebCrypto is unavailable
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  for (let i = 0; i < bytes.length; i += 1) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  const part = ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
  return part.repeat(4).slice(0, 64);
}

export function buildRequiredDocumentsForProviderType(
  tenantId: string,
  providerType: string,
): UploadedEnrollmentDoc[] {
  const tenant = tenantService.getTenantById(tenantId);
  const reqs =
    tenant?.businessRules.requiredDocuments[providerType] ?? [
      'State Medical License',
      'Malpractice COI',
      'W-9 Form',
    ];
  return reqs.map((req, idx) => ({
    id: `doc-req-${idx + 1}`,
    requirementName: req,
    status: 'Missing',
  }));
}

export function computeApplicationFee(
  tenantId: string,
  providerType: string,
): { feeAmountUsd: number; feeStatus: 'Pending' | 'Waived' } {
  const tenant = tenantService.getTenantById(tenantId);
  const baseFee = tenant?.businessRules.applicationFeeUsd ?? 709;
  const waivedTypes = tenant?.businessRules.feeWaivedTypes ?? [];
  if (baseFee <= 0 || waivedTypes.includes(providerType)) {
    return { feeAmountUsd: 0, feeStatus: 'Waived' };
  }
  return { feeAmountUsd: baseFee, feeStatus: 'Pending' };
}

export function createBlankApplication(
  tenantId: string,
  overrides?: Partial<EnrollmentApplication>,
): EnrollmentApplication {
  const tenant = tenantService.getTenantById(tenantId);
  const providerType =
    overrides?.providerType ??
    tenant?.businessRules.providerTypes[0] ??
    'Individual Physician';
  const fee = computeApplicationFee(tenantId, providerType);
  const now = new Date().toISOString();
  const id = overrides?.id ?? `enr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    tenantId,
    applicationNumber:
      overrides?.applicationNumber ??
      `APP-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 8999))}`,
    status: overrides?.status ?? 'Draft',
    currentStep: overrides?.currentStep ?? 0,
    applicantPrefix: overrides?.applicantPrefix ?? 'Dr.',
    applicantGiven: overrides?.applicantGiven ?? '',
    applicantFamily: overrides?.applicantFamily ?? '',
    applicantEmail: overrides?.applicantEmail ?? '',
    applicantPhone: overrides?.applicantPhone ?? '',
    npi: overrides?.npi ?? '',
    dob: overrides?.dob ?? '1980-06-15',
    applicationType: overrides?.applicationType ?? 'New Enrollment',
    priorMedicaidId: overrides?.priorMedicaidId,
    providerType,
    specialty: overrides?.specialty ?? 'Family Medicine',
    yearsInBusiness: overrides?.yearsInBusiness ?? 5,
    contractProgram: overrides?.contractProgram ?? 'Both',
    requestedPlanIds: overrides?.requestedPlanIds ?? [],
    ownershipType: overrides?.ownershipType ?? 'LLC',
    organizationName: overrides?.organizationName ?? '',
    tin: overrides?.tin ?? '',
    disclosures: overrides?.disclosures ?? [
      {
        id: 'disc-1',
        name: '',
        role: 'Owner (>=5%)',
        ownershipPercent: 100,
        ssnOrTinLast4: '4321',
        hasSanctions: false,
      },
    ],
    hasPriorSanctions: overrides?.hasPriorSanctions ?? false,
    locations: overrides?.locations ?? [
      {
        id: 'loc-1',
        clinicName: '',
        street: '',
        city: '',
        state: 'NY',
        postalCode: '',
        phone: '',
        hours: 'Mon–Fri 08:00–17:00',
        acceptingNewPatients: true,
      },
    ],
    licenseNumber: overrides?.licenseNumber ?? '',
    licenseState: overrides?.licenseState ?? 'NY',
    licenseExpiry: overrides?.licenseExpiry ?? '2028-12-31',
    deaNumber: overrides?.deaNumber ?? 'AB1234563',
    boardCertified: overrides?.boardCertified ?? true,
    taxonomyCode: overrides?.taxonomyCode ?? '207Q00000X',
    billingNpi: overrides?.billingNpi ?? '',
    eftBankRoutingLast4: overrides?.eftBankRoutingLast4 ?? '8812',
    documents:
      overrides?.documents ??
      buildRequiredDocumentsForProviderType(tenantId, providerType),
    attestedTruthful: overrides?.attestedTruthful ?? false,
    attestedCompliance: overrides?.attestedCompliance ?? false,
    eSignatureName: overrides?.eSignatureName ?? '',
    eSignedAt: overrides?.eSignedAt,
    feeAmountUsd: overrides?.feeAmountUsd ?? fee.feeAmountUsd,
    feeStatus: overrides?.feeStatus ?? fee.feeStatus,
    questionnaireResponseId: overrides?.questionnaireResponseId,
    taskId: overrides?.taskId,
    assignedAnalyst: overrides?.assignedAnalyst,
    riskTier: overrides?.riskTier,
    submittedAt: overrides?.submittedAt,
    slaDueDate: overrides?.slaDueDate,
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
    history: overrides?.history ?? [
      {
        status: 'Draft',
        timestamp: now,
        actor: 'Provider Portal',
        note: 'Enrollment draft initialized.',
      },
    ],
    rfis: overrides?.rfis ?? [],
  };
}

function seedTenantApplications(tenantId: string): EnrollmentApplication[] {
  const isTenantB = tenantId.includes('health-center');
  const now = new Date();
  const daysAgo = (d: number) =>
    new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();
  const daysFromNow = (d: number) =>
    new Date(now.getTime() + d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const npi1 = buildValidNpi(isTenantB ? '141223344' : '131223344');
  const npi2 = buildValidNpi(isTenantB ? '142334455' : '132334455');
  const npi3 = buildValidNpi(isTenantB ? '143445566' : '133445566');

  const app1 = createBlankApplication(tenantId, {
    id: `enr-seed-1-${tenantId}`,
    applicationNumber: isTenantB ? 'APP-2026-2001' : 'APP-2026-1001',
    status: 'Submitted',
    currentStep: 11,
    applicantPrefix: 'Dr.',
    applicantGiven: isTenantB ? 'Priya' : 'Lucas',
    applicantFamily: isTenantB ? 'Deshmukh' : 'Montgomery',
    applicantEmail: isTenantB ? 'p.deshmukh@fqhc.synthetic' : 'l.montgomery@med.synthetic',
    applicantPhone: isTenantB ? '312-555-0131' : '518-555-0131',
    npi: npi1,
    applicationType: 'New Enrollment',
    providerType: isTenantB ? 'FQHC Clinician' : 'Individual Physician',
    specialty: 'Family Medicine',
    yearsInBusiness: 7,
    contractProgram: 'Both',
    ownershipType: 'LLC',
    organizationName: isTenantB ? 'Lakeshore FQHC Clinic' : 'Mohawk Valley Primary Care LLC',
    tin: '47-1928374',
    disclosures: [
      {
        id: 'disc-s1',
        name: isTenantB ? 'Dr. Priya Deshmukh' : 'Dr. Lucas Montgomery',
        role: 'Owner (>=5%)',
        ownershipPercent: 100,
        ssnOrTinLast4: '7821',
        hasSanctions: false,
      },
    ],
    locations: [
      {
        id: 'loc-s1',
        clinicName: isTenantB ? 'Lakeshore Primary Clinic' : 'Mohawk Albany Care Center',
        street: isTenantB ? '420 N Michigan Ave' : '215 Washington Ave',
        city: isTenantB ? 'Chicago' : 'Albany',
        state: isTenantB ? 'IL' : 'NY',
        postalCode: isTenantB ? '60611' : '12210',
        phone: isTenantB ? '312-555-0131' : '518-555-0131',
        hours: 'Mon–Fri 08:00–17:30',
        acceptingNewPatients: true,
      },
    ],
    licenseNumber: isTenantB ? '036-119204' : '294810',
    licenseState: isTenantB ? 'IL' : 'NY',
    licenseExpiry: '2028-06-30',
    deaNumber: 'BM4455661',
    taxonomyCode: '207Q00000X',
    billingNpi: npi1,
    attestedTruthful: true,
    attestedCompliance: true,
    eSignatureName: isTenantB ? 'Dr. Priya Deshmukh' : 'Dr. Lucas Montgomery',
    eSignedAt: daysAgo(4),
    feeAmountUsd: 0,
    feeStatus: 'Waived',
    submittedAt: daysAgo(4),
    slaDueDate: daysFromNow(26),
    assignedAnalyst: 'Taylor Brooks',
    documents: buildRequiredDocumentsForProviderType(
      tenantId,
      isTenantB ? 'FQHC Clinician' : 'Individual Physician',
    ).map((d, idx) => ({
      ...d,
      fileName: `${d.requirementName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 184320 + idx * 12000,
      sha256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85${idx}`,
      status: 'Uploaded',
      uploadedAt: daysAgo(4),
    })),
    history: [
      { status: 'Draft', timestamp: daysAgo(5), actor: 'Provider Portal', note: 'Draft started.' },
      { status: 'Submitted', timestamp: daysAgo(4), actor: 'Provider Portal', note: 'Application submitted for automated validation.' },
    ],
  });

  const app2 = createBlankApplication(tenantId, {
    id: `enr-seed-2-${tenantId}`,
    applicationNumber: isTenantB ? 'APP-2026-2002' : 'APP-2026-1002',
    status: 'In Review',
    currentStep: 11,
    applicantPrefix: 'Dr.',
    applicantGiven: isTenantB ? 'Devon' : 'Sofia',
    applicantFamily: isTenantB ? 'Callahan' : 'Alvarez',
    applicantEmail: isTenantB ? 'd.callahan@fqhc.synthetic' : 's.alvarez@bh-care.synthetic',
    applicantPhone: isTenantB ? '312-555-0162' : '585-555-0162',
    npi: npi2,
    applicationType: 'New Enrollment',
    providerType: 'Behavioral Health Specialist',
    specialty: 'Psychiatry',
    yearsInBusiness: 4,
    contractProgram: 'Managed Care',
    ownershipType: 'Corporation',
    organizationName: isTenantB ? 'Heartland Behavioral Services' : 'Genesee Behavioral Health PC',
    tin: '52-8841209',
    disclosures: [
      {
        id: 'disc-s2',
        name: isTenantB ? 'Dr. Devon Callahan' : 'Dr. Sofia Alvarez',
        role: 'Owner (>=5%)',
        ownershipPercent: 60,
        ssnOrTinLast4: '5502',
        hasSanctions: false,
      },
      {
        id: 'disc-s2b',
        name: 'Avery Morales',
        role: 'Owner (>=5%)',
        ownershipPercent: 40,
        ssnOrTinLast4: '9914',
        hasSanctions: false,
      },
    ],
    locations: [
      {
        id: 'loc-s2',
        clinicName: isTenantB ? 'Heartland Counseling Center' : 'Genesee Mind & Wellness',
        street: isTenantB ? '780 W Madison St' : '110 East Ave',
        city: isTenantB ? 'Chicago' : 'Rochester',
        state: isTenantB ? 'IL' : 'NY',
        postalCode: isTenantB ? '60661' : '14604',
        phone: isTenantB ? '312-555-0162' : '585-555-0162',
        hours: 'Mon–Fri 09:00–18:00',
        acceptingNewPatients: true,
      },
    ],
    licenseNumber: isTenantB ? '036-229110' : '310445',
    licenseState: isTenantB ? 'IL' : 'NY',
    licenseExpiry: '2027-09-30',
    deaNumber: 'FA3322118',
    taxonomyCode: '2084P0800X',
    billingNpi: npi2,
    attestedTruthful: true,
    attestedCompliance: true,
    eSignatureName: isTenantB ? 'Dr. Devon Callahan' : 'Dr. Sofia Alvarez',
    eSignedAt: daysAgo(14),
    feeAmountUsd: isTenantB ? 0 : 709,
    feeStatus: isTenantB ? 'Waived' : 'Paid',
    riskTier: 'Moderate',
    submittedAt: daysAgo(14),
    slaDueDate: daysFromNow(4),
    assignedAnalyst: 'Taylor Brooks',
    documents: buildRequiredDocumentsForProviderType(
      tenantId,
      'Behavioral Health Specialist',
    ).map((d, idx) => ({
      ...d,
      fileName: `${d.requirementName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 215040 + idx * 9000,
      sha256: `9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a0${idx}`,
      status: 'Uploaded',
      uploadedAt: daysAgo(14),
    })),
    history: [
      { status: 'Draft', timestamp: daysAgo(16), actor: 'Provider Portal', note: 'Draft started.' },
      { status: 'Submitted', timestamp: daysAgo(14), actor: 'Provider Portal', note: 'Submitted with application fee.' },
      { status: 'In Validation', timestamp: daysAgo(13), actor: 'M6 Validation Engine', note: 'Automated validation completed (9/9 Pass).' },
      { status: 'In Screening', timestamp: daysAgo(11), actor: 'M7 Risk Screening', note: 'Moderate risk site visit completed.' },
      { status: 'In Review', timestamp: daysAgo(9), actor: 'M7 Risk Screening', note: 'All screening tasks complete; queued for determination.' },
    ],
  });

  const app3 = createBlankApplication(tenantId, {
    id: `enr-seed-3-${tenantId}`,
    applicationNumber: isTenantB ? 'APP-2026-2003' : 'APP-2026-1003',
    status: 'RFI Issued',
    currentStep: 11,
    applicantPrefix: '',
    applicantGiven: isTenantB ? 'Midwest' : 'Empire',
    applicantFamily: isTenantB ? 'Surgical Center' : 'Home Health Services',
    applicantEmail: isTenantB ? 'cred@midwestsurg.synthetic' : 'enroll@empirehome.synthetic',
    applicantPhone: isTenantB ? '312-555-0194' : '315-555-0194',
    npi: npi3,
    applicationType: 'New Enrollment',
    providerType: isTenantB ? 'Nurse Practitioner' : 'Hospital / Institutional',
    specialty: 'Internal Medicine',
    yearsInBusiness: 1,
    contractProgram: 'FFS',
    ownershipType: 'Corporation',
    organizationName: isTenantB ? 'Midwest Ambulatory Care Inc' : 'Empire Institutional Care Corp',
    tin: '81-6642390',
    disclosures: [
      {
        id: 'disc-s3',
        name: 'Jordan Mercer',
        role: 'Owner (>=5%)',
        ownershipPercent: 75,
        ssnOrTinLast4: '1189',
        hasSanctions: false,
      },
    ],
    locations: [
      {
        id: 'loc-s3',
        clinicName: isTenantB ? 'Midwest Care Suite' : 'Empire Syracuse Facility',
        street: isTenantB ? '1500 W Harrison St' : '400 S Salina St',
        city: isTenantB ? 'Chicago' : 'Syracuse',
        state: isTenantB ? 'IL' : 'NY',
        postalCode: isTenantB ? '60607' : '13202',
        phone: isTenantB ? '312-555-0194' : '315-555-0194',
        hours: 'Mon–Sat 07:00–19:00',
        acceptingNewPatients: true,
      },
    ],
    licenseNumber: isTenantB ? '041-889122' : 'INST-44019',
    licenseState: isTenantB ? 'IL' : 'NY',
    licenseExpiry: '2027-03-31',
    deaNumber: '',
    taxonomyCode: '207R00000X',
    billingNpi: npi3,
    attestedTruthful: true,
    attestedCompliance: true,
    eSignatureName: 'Jordan Mercer',
    eSignedAt: daysAgo(22),
    feeAmountUsd: 709,
    feeStatus: 'Paid',
    riskTier: 'High',
    submittedAt: daysAgo(22),
    slaDueDate: daysFromNow(-2),
    assignedAnalyst: 'Taylor Brooks',
    documents: buildRequiredDocumentsForProviderType(
      tenantId,
      isTenantB ? 'Nurse Practitioner' : 'Hospital / Institutional',
    ).map((d, idx) => ({
      ...d,
      fileName: idx === 0 ? 'license_scan.pdf' : undefined,
      mimeType: idx === 0 ? 'application/pdf' : undefined,
      sizeBytes: idx === 0 ? 128000 : undefined,
      sha256: idx === 0 ? 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0' : undefined,
      status: idx === 0 ? 'Uploaded' : 'Missing',
    })),
    rfis: [
      {
        id: 'rfi-seed-1',
        issuedAt: daysAgo(6),
        dueDate: daysFromNow(8),
        deficiencies: ['Missing Malpractice Certificate of Insurance', 'Clarify 5%+ ownership disclosure'],
        notes: 'Please upload current malpractice COI and confirm controlling interest documentation.',
        status: 'Open',
      },
    ],
    history: [
      { status: 'Draft', timestamp: daysAgo(24), actor: 'Provider Portal', note: 'Draft started.' },
      { status: 'Submitted', timestamp: daysAgo(22), actor: 'Provider Portal', note: 'Submitted with $709 fee.' },
      { status: 'In Validation', timestamp: daysAgo(20), actor: 'M6 Validation Engine', note: 'Flagged missing malpractice COI.' },
      { status: 'RFI Issued', timestamp: daysAgo(6), actor: 'Taylor Brooks (EnrollmentAnalyst)', note: 'RFI issued with 14-day response window.' },
    ],
  });

  return [app1, app2, app3];
}

function getTenantList(tenantId: string): EnrollmentApplication[] {
  let list = tenantApplications.get(tenantId);
  if (!list) {
    list = seedTenantApplications(tenantId);
    tenantApplications.set(tenantId, list);
  }
  return list;
}

export const enrollmentService = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  resetForTests(tenantId?: string): void {
    if (tenantId) {
      tenantApplications.delete(tenantId);
    } else {
      tenantApplications.clear();
    }
    notify();
  },

  listApplications(tenantId: string): EnrollmentApplication[] {
    return getTenantList(tenantId);
  },

  getApplicationById(
    tenantId: string,
    applicationId: string,
  ): EnrollmentApplication | undefined {
    return getTenantList(tenantId).find((a) => a.id === applicationId);
  },

  saveDraft(
    tenantId: string,
    draft: EnrollmentApplication,
  ): EnrollmentApplication {
    const list = getTenantList(tenantId);
    const updated: EnrollmentApplication = {
      ...draft,
      tenantId,
      updatedAt: new Date().toISOString(),
    };
    const idx = list.findIndex((a) => a.id === updated.id);
    if (idx >= 0) {
      list[idx] = updated;
    } else {
      list.unshift(updated);
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          `${DRAFT_STORAGE_PREFIX}${tenantId}`,
          JSON.stringify(updated),
        );
      } catch {
        // Ignore storage quota errors
      }
    }
    notify();
    return updated;
  },

  loadSavedLocalDraft(tenantId: string): EnrollmentApplication | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${tenantId}`);
      if (!raw) return null;
      return JSON.parse(raw) as EnrollmentApplication;
    } catch {
      return null;
    }
  },

  clearSavedLocalDraft(tenantId: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${tenantId}`);
    } catch {
      // Ignore
    }
  },

  /**
   * Validates file MIME type (PDF, PNG, JPG) and size <= 10 MB, computes SHA-256 hash,
   * and writes a FHIR DocumentReference in the active tenant partition.
   */
  async uploadDocument(
    ctx: FhirRequestContext,
    applicationId: string,
    requirementName: string,
    file: { name: string; type: string; size: number; content: ArrayBuffer | string },
    actor: { name: string; role: RoleName },
  ): Promise<UploadedEnrollmentDoc> {
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      throw new AppError({
        message: `Unsupported file type '${file.type}'. Only PDF, PNG, and JPG files are allowed.`,
        statusCode: 400,
        code: 'INVALID_FILE_TYPE',
      });
    }
    if (file.size > MAX_DOC_BYTES) {
      throw new AppError({
        message: 'File exceeds the 10 MB maximum upload limit.',
        statusCode: 400,
        code: 'FILE_TOO_LARGE',
      });
    }

    const sha256 = await computeSha256Hex(file.content);
    const client = getFhirClient();
    const docRef: FhirDocumentReference = {
      resourceType: 'DocumentReference',
      status: 'current',
      type: {
        coding: [
          {
            system: 'http://providerlink.local/CodeSystem/enrollment-document',
            code: requirementName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            display: requirementName,
          },
        ],
        text: requirementName,
      },
      date: new Date().toISOString(),
      description: `Enrollment document (${applicationId}): ${file.name}`,
      content: [
        {
          attachment: {
            contentType: file.type,
            title: file.name,
            size: file.size,
            hash: sha256,
            creation: new Date().toISOString(),
          },
        },
      ],
    };
    const createdDoc = await client.create(ctx, docRef);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'DocumentReference',
      resourceId: createdDoc.id,
      outcomeDesc: `Uploaded enrollment document '${file.name}' (SHA-256: ${sha256.slice(0, 12)}...)`,
    });

    return {
      id: `doc-${Date.now().toString(36)}`,
      requirementName,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      sha256,
      status: 'Uploaded',
      uploadedAt: new Date().toISOString(),
      documentReferenceId: createdDoc.id,
    };
  },

  validateApplicationForSubmit(app: EnrollmentApplication): string[] {
    const errors: string[] = [];
    if (!app.applicantGiven.trim() || !app.applicantFamily.trim()) {
      errors.push('Applicant first and last name are required (Step 1).');
    }
    if (!validateNpi(app.npi)) {
      errors.push('A valid 10-digit Luhn NPI is required (Step 1).');
    }
    if (!app.organizationName.trim() || !app.tin.trim()) {
      errors.push('Organization name and Tax ID (TIN) are required (Step 5).');
    }
    if (app.locations.length === 0 || !app.locations[0].street.trim() || !app.locations[0].city.trim()) {
      errors.push('At least one practice location with street and city is required (Step 7).');
    }
    if (!app.licenseNumber.trim()) {
      errors.push('Active state license number is required (Step 8).');
    }
    if (!/^[0-9A-Z]{10}$/.test(app.taxonomyCode.trim())) {
      errors.push('A valid 10-character NUCC taxonomy code is required (Step 9).');
    }
    const missingDocs = app.documents.filter((d) => d.status !== 'Uploaded');
    if (missingDocs.length > 0) {
      errors.push(
        `Missing required document(s): ${missingDocs.map((d) => d.requirementName).join(', ')} (Step 10).`,
      );
    }
    if (!app.attestedTruthful || !app.attestedCompliance || !app.eSignatureName.trim()) {
      errors.push('Both attestations and e-signature are required (Step 11).');
    }
    if (app.feeStatus === 'Pending' && app.feeAmountUsd > 0) {
      errors.push('Application fee must be paid or waived before submission (Step 12).');
    }
    return errors;
  },

  /**
   * Submits enrollment application: stores FHIR QuestionnaireResponse + Task,
   * transitions to Submitted, records AuditEvent, and publishes ProviderSubmitted.
   */
  async submitApplication(
    ctx: FhirRequestContext,
    draft: EnrollmentApplication,
    actor: { name: string; role: RoleName },
  ): Promise<EnrollmentApplication> {
    const errors = this.validateApplicationForSubmit(draft);
    if (errors.length > 0) {
      throw new AppError({
        message: errors[0],
        statusCode: 400,
        code: 'ENROLLMENT_VALIDATION_ERROR',
      });
    }

    const client = getFhirClient();
    const now = new Date().toISOString();
    const tenant = tenantService.getTenantById(ctx.tenantId);
    const slaDays = tenant?.businessRules.slaDays ?? 30;
    const slaDueDate = new Date(Date.now() + slaDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const qr: FhirQuestionnaireResponse = {
      resourceType: 'QuestionnaireResponse',
      questionnaire: `Questionnaire/medicaid-enrollment-${draft.providerType.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      status: 'completed',
      authored: now,
      item: [
        {
          linkId: 'applicant',
          text: 'Applicant & NPI',
          item: [
            { linkId: 'npi', text: 'NPI', answer: [{ valueString: draft.npi }] },
            {
              linkId: 'name',
              text: 'Applicant Name',
              answer: [{ valueString: `${draft.applicantGiven} ${draft.applicantFamily}` }],
            },
            { linkId: 'applicationType', text: 'Application Type', answer: [{ valueString: draft.applicationType }] },
            { linkId: 'providerType', text: 'Provider Type', answer: [{ valueString: draft.providerType }] },
          ],
        },
        {
          linkId: 'organization',
          text: 'Organization & Billing',
          item: [
            { linkId: 'orgName', text: 'Organization', answer: [{ valueString: draft.organizationName }] },
            { linkId: 'taxonomy', text: 'Taxonomy', answer: [{ valueString: draft.taxonomyCode }] },
            { linkId: 'license', text: 'License', answer: [{ valueString: `${draft.licenseState}-${draft.licenseNumber}` }] },
          ],
        },
      ],
    };
    const createdQr = await client.create(ctx, qr);

    const task: FhirTask = {
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      priority: draft.applicationType === 'Change of Ownership' ? 'urgent' : 'routine',
      code: {
        coding: [
          {
            system: 'http://providerlink.local/CodeSystem/task-type',
            code: 'provider-enrollment',
            display: `Provider Enrollment (${draft.applicationType})`,
          },
        ],
      },
      description: `${draft.applicationNumber}: ${draft.applicantGiven} ${draft.applicantFamily} (NPI ${draft.npi})`,
      authoredOn: now,
      input: [
        { type: { text: 'questionnaireResponseId' }, valueString: createdQr.id ?? '' },
        { type: { text: 'npi' }, valueString: draft.npi },
      ],
    };
    const createdTask = await client.create(ctx, task);

    const submitted: EnrollmentApplication = {
      ...draft,
      tenantId: ctx.tenantId,
      status: 'Submitted',
      currentStep: 11,
      eSignedAt: draft.eSignedAt ?? now,
      submittedAt: now,
      updatedAt: now,
      slaDueDate,
      questionnaireResponseId: createdQr.id,
      taskId: createdTask.id,
      history: [
        ...draft.history,
        {
          status: 'Submitted',
          timestamp: now,
          actor: `${actor.name} (${actor.role})`,
          note: `Submitted to FHIR (QuestionnaireResponse/${createdQr.id}, Task/${createdTask.id}).`,
        },
      ],
    };

    const list = getTenantList(ctx.tenantId);
    const idx = list.findIndex((a) => a.id === submitted.id);
    if (idx >= 0) {
      list[idx] = submitted;
    } else {
      list.unshift(submitted);
    }

    this.clearSavedLocalDraft(ctx.tenantId);

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'QuestionnaireResponse',
      resourceId: createdQr.id,
      outcomeDesc: `Submitted enrollment ${submitted.applicationNumber} for NPI ${submitted.npi}`,
    });

    eventBus.publish({
      type: 'ProviderSubmitted',
      tenantId: ctx.tenantId,
      sourceModule: 'M5',
      payload: {
        applicationId: submitted.id,
        applicationNumber: submitted.applicationNumber,
        npi: submitted.npi,
        providerName: `${submitted.applicantGiven} ${submitted.applicantFamily}`,
        providerType: submitted.providerType,
        questionnaireResponseId: createdQr.id,
        taskId: createdTask.id,
      },
    });

    notify();
    return submitted;
  },

  transitionStatus(
    tenantId: string,
    applicationId: string,
    nextStatus: EnrollmentStatus,
    actorLabel: string,
    note: string,
    extra?: Partial<Pick<EnrollmentApplication, 'riskTier' | 'assignedAnalyst'>>,
  ): EnrollmentApplication {
    const list = getTenantList(tenantId);
    const app = list.find((a) => a.id === applicationId);
    if (!app) {
      throw new AppError({
        message: `Enrollment application '${applicationId}' not found.`,
        statusCode: 404,
        code: 'ENROLLMENT_NOT_FOUND',
      });
    }
    const now = new Date().toISOString();
    app.status = nextStatus;
    app.updatedAt = now;
    if (extra?.riskTier) app.riskTier = extra.riskTier;
    if (extra?.assignedAnalyst) app.assignedAnalyst = extra.assignedAnalyst;
    app.history.push({
      status: nextStatus,
      timestamp: now,
      actor: actorLabel,
      note,
    });
    notify();
    return app;
  },

  addRfiToApplication(
    tenantId: string,
    applicationId: string,
    rfi: Omit<RfiItem, 'id' | 'issuedAt' | 'status'>,
    actorLabel: string,
  ): RfiItem {
    const app = this.getApplicationById(tenantId, applicationId);
    if (!app) {
      throw new AppError({ message: 'Application not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    const item: RfiItem = {
      ...rfi,
      id: `rfi-${Date.now().toString(36)}`,
      issuedAt: new Date().toISOString(),
      status: 'Open',
    };
    app.rfis.unshift(item);
    this.transitionStatus(
      tenantId,
      applicationId,
      'RFI Issued',
      actorLabel,
      `RFI issued (${rfi.deficiencies.join('; ')}), due ${rfi.dueDate}.`,
    );
    return item;
  },

  async respondToRfi(
    ctx: FhirRequestContext,
    applicationId: string,
    rfiId: string,
    responseText: string,
    uploadedDoc: UploadedEnrollmentDoc | undefined,
    actor: { name: string; role: RoleName },
  ): Promise<EnrollmentApplication> {
    const app = this.getApplicationById(ctx.tenantId, applicationId);
    if (!app) {
      throw new AppError({ message: 'Application not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    const rfi = app.rfis.find((r) => r.id === rfiId);
    if (!rfi) {
      throw new AppError({ message: 'RFI not found', statusCode: 404, code: 'NOT_FOUND' });
    }
    rfi.status = 'Responded';
    rfi.responseText = responseText;
    rfi.respondedAt = new Date().toISOString();
    if (uploadedDoc) {
      rfi.attachments = [...(rfi.attachments ?? []), uploadedDoc.fileName ?? uploadedDoc.requirementName];
      const existingIdx = app.documents.findIndex(
        (d) => d.requirementName === uploadedDoc.requirementName,
      );
      if (existingIdx >= 0) {
        app.documents[existingIdx] = uploadedDoc;
      } else {
        app.documents.push(uploadedDoc);
      }
    }

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Task',
      resourceId: app.taskId,
      outcomeDesc: `Provider responded to RFI ${rfiId} for ${app.applicationNumber}`,
    });

    return this.transitionStatus(
      ctx.tenantId,
      applicationId,
      'In Review',
      `${actor.name} (${actor.role})`,
      `RFI response submitted; case resumed in review.`,
    );
  },

  /**
   * Reused by M12 Ongoing Monitoring to pre-fill the M5 wizard for provider revalidation.
   */
  createRevalidationDraftFromProvider(
    tenantId: string,
    provider: ProviderDirectoryRow,
    applicationType: 'Revalidation' | 'Change of Ownership' = 'Revalidation',
  ): EnrollmentApplication {
    const nameParts = provider.fullName.replace(/^Dr\.\s*/i, '').split(' ');
    const given = nameParts[0] ?? 'Provider';
    const family = nameParts.slice(1).join(' ') || 'Record';

    const draft = createBlankApplication(tenantId, {
      applicationType,
      priorMedicaidId: provider.medicaidId,
      applicantPrefix: provider.fullName.startsWith('Dr.') ? 'Dr.' : '',
      applicantGiven: given,
      applicantFamily: family,
      applicantEmail: provider.email,
      applicantPhone: provider.phone,
      npi: provider.npi,
      dob: provider.dob ?? '1980-01-01',
      providerType: provider.providerType,
      specialty: provider.specialty,
      organizationName: `${provider.fullName} Practice`,
      tin: provider.tin ?? '45-1234567',
      licenseNumber: provider.licenseNumber,
      licenseState: provider.licenseState,
      taxonomyCode: provider.taxonomyCode || '207Q00000X',
      billingNpi: provider.npi,
      locations: [
        {
          id: 'loc-reval-1',
          clinicName: `${provider.fullName} Clinic`,
          street: provider.street || '100 Clinic Way',
          city: provider.city || 'Albany',
          state: provider.state || 'NY',
          postalCode: provider.postalCode || '12207',
          phone: provider.phone || '518-555-0100',
          hours: 'Mon–Fri 08:00–17:00',
          acceptingNewPatients: provider.acceptingNewPatients,
        },
      ],
    });

    return this.saveDraft(tenantId, draft);
  },
};
