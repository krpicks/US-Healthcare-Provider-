import type { FhirClient, FhirRequestContext } from '../fhir';
import { buildValidNpi } from '../rules';
import type {
  FhirBundle,
  FhirCondition,
  FhirCoverage,
  FhirEncounter,
  FhirEndpoint,
  FhirInsurancePlan,
  FhirLocation,
  FhirObservation,
  FhirOrganization,
  FhirOrganizationAffiliation,
  FhirPatient,
  FhirPractitioner,
  FhirPractitionerRole,
  FhirProcedure,
} from '../types';

export const PROVIDER_STATUS_EXT_URL =
  'http://providerlink.local/StructureDefinition/provider-enrollment-status';
export const ACCEPTING_PATIENTS_EXT_URL =
  'http://providerlink.local/StructureDefinition/accepting-new-patients';
export const PROVIDER_TYPE_EXT_URL =
  'http://providerlink.local/StructureDefinition/provider-type';
export const SENSITIVE_TIN_EXT_URL =
  'http://providerlink.local/StructureDefinition/tax-id-number';
export const SENSITIVE_SSN_EXT_URL =
  'http://providerlink.local/StructureDefinition/ssn-synthetic';
export const SENSITIVE_BANK_EXT_URL =
  'http://providerlink.local/StructureDefinition/eft-account-synthetic';
export const LAST_VERIFIED_EXT_URL =
  'http://providerlink.local/StructureDefinition/last-verified-date';

export const NPI_SYSTEM = 'http://hl7.org/fhir/sid/us-npi';
export const MEDICAID_ID_SYSTEM = 'http://providerlink.local/sid/medicaid-id';
export const TAXONOMY_SYSTEM = 'http://nucc.org/provider-taxonomy';
export const LICENSE_SYSTEM = 'http://providerlink.local/sid/state-license';
export const MRN_SYSTEM = 'http://providerlink.local/sid/mrn';

interface SeedProviderSpec {
  id: string;
  npiBase: string;
  medicaidId: string;
  given: string;
  family: string;
  prefix: string;
  providerType: string;
  specialtyCode: string;
  specialtyDisplay: string;
  licenseNumber: string;
  licenseState: string;
  status: 'Applicant' | 'Pending' | 'Active' | 'Suspended' | 'Terminated' | 'Revalidation Due';
  acceptingNewPatients: boolean;
  city: string;
  state: string;
  postalCode: string;
  street: string;
  phone: string;
  email: string;
  tin: string;
  ssn: string;
  dob: string;
  bankAccount: string;
  orgId: string;
  orgName: string;
  verifiedDaysAgo: number;
}

const TENANT_A_PROVIDERS: SeedProviderSpec[] = [
  {
    id: 'prac-a-1',
    npiBase: '100300012',
    medicaidId: 'MCD-A-10001',
    given: 'Elena',
    family: 'Vargas',
    prefix: 'Dr.',
    providerType: 'Individual Physician',
    specialtyCode: '207Q00000X',
    specialtyDisplay: 'Family Medicine',
    licenseNumber: 'MD-449102',
    licenseState: 'NY',
    status: 'Active',
    acceptingNewPatients: true,
    city: 'Albany',
    state: 'NY',
    postalCode: '12207',
    street: '142 State St',
    phone: '518-555-0101',
    email: 'elena.vargas@synthetic.example',
    tin: '14-9012345',
    ssn: '900-11-4421',
    dob: '1978-04-12',
    bankAccount: '004829103847',
    orgId: 'org-a-capital-health',
    orgName: 'Capital Valley Medical Group',
    verifiedDaysAgo: 18,
  },
  {
    id: 'prac-a-2',
    npiBase: '100300024',
    medicaidId: 'MCD-A-10002',
    given: 'Marcus',
    family: 'Chen',
    prefix: 'Dr.',
    providerType: 'Individual Physician',
    specialtyCode: '208000000X',
    specialtyDisplay: 'Pediatrics',
    licenseNumber: 'MD-551823',
    licenseState: 'NY',
    status: 'Active',
    acceptingNewPatients: true,
    city: 'Syracuse',
    state: 'NY',
    postalCode: '13202',
    street: '310 Salina St',
    phone: '315-555-0142',
    email: 'marcus.chen@synthetic.example',
    tin: '14-9012345',
    ssn: '900-22-7812',
    dob: '1981-09-22',
    bankAccount: '004829109921',
    orgId: 'org-a-capital-health',
    orgName: 'Capital Valley Medical Group',
    verifiedDaysAgo: 42,
  },
  {
    id: 'prac-a-3',
    npiBase: '100300037',
    medicaidId: 'MCD-A-10003',
    given: 'Amara',
    family: 'Okafor',
    prefix: 'Dr.',
    providerType: 'Behavioral Health Specialist',
    specialtyCode: '2084P0800X',
    specialtyDisplay: 'Psychiatry',
    licenseNumber: 'MD-612090',
    licenseState: 'NY',
    status: 'Active',
    acceptingNewPatients: true,
    city: 'Rochester',
    state: 'NY',
    postalCode: '14604',
    street: '88 East Ave',
    phone: '585-555-0188',
    email: 'amara.okafor@synthetic.example',
    tin: '16-7782310',
    ssn: '900-33-1904',
    dob: '1975-11-03',
    bankAccount: '009182736455',
    orgId: 'org-a-lakeview-bh',
    orgName: 'Lakeview Behavioral Health Partners',
    verifiedDaysAgo: 12,
  },
  {
    id: 'prac-a-4',
    npiBase: '100300049',
    medicaidId: 'MCD-A-10004',
    given: 'David',
    family: 'Kowalski',
    prefix: 'Dr.',
    providerType: 'Dental Provider',
    specialtyCode: '1223G0001X',
    specialtyDisplay: 'General Practice Dentistry',
    licenseNumber: 'DDS-228411',
    licenseState: 'NY',
    status: 'Revalidation Due',
    acceptingNewPatients: false,
    city: 'Buffalo',
    state: 'NY',
    postalCode: '14202',
    street: '500 Pearl St',
    phone: '716-555-0164',
    email: 'david.kowalski@synthetic.example',
    tin: '16-8841209',
    ssn: '900-44-6620',
    dob: '1969-02-19',
    bankAccount: '007721948312',
    orgId: 'org-a-erie-dental',
    orgName: 'Erie Corridor Dental Associates',
    verifiedDaysAgo: 118,
  },
  {
    id: 'prac-a-5',
    npiBase: '100300051',
    medicaidId: 'MCD-A-10005',
    given: 'Priya',
    family: 'Subramanian',
    prefix: 'Dr.',
    providerType: 'Individual Physician',
    specialtyCode: '207R00000X',
    specialtyDisplay: 'Internal Medicine',
    licenseNumber: 'MD-709412',
    licenseState: 'NY',
    status: 'Active',
    acceptingNewPatients: true,
    city: 'Albany',
    state: 'NY',
    postalCode: '12208',
    street: '205 New Scotland Ave',
    phone: '518-555-0199',
    email: 'priya.subramanian@synthetic.example',
    tin: '14-9012345',
    ssn: '900-55-3189',
    dob: '1984-06-30',
    bankAccount: '005518293044',
    orgId: 'org-a-capital-health',
    orgName: 'Capital Valley Medical Group',
    verifiedDaysAgo: 9,
  },
  {
    id: 'prac-a-6',
    npiBase: '100300063',
    medicaidId: 'MCD-A-10006',
    given: 'Samuel',
    family: 'Bridges',
    prefix: 'NP',
    providerType: 'Nurse Practitioner',
    specialtyCode: '363LF0000X',
    specialtyDisplay: 'Family Nurse Practitioner',
    licenseNumber: 'NP-301188',
    licenseState: 'NY',
    status: 'Pending',
    acceptingNewPatients: true,
    city: 'Yonkers',
    state: 'NY',
    postalCode: '10701',
    street: '45 Warburton Ave',
    phone: '914-555-0123',
    email: 'samuel.bridges@synthetic.example',
    tin: '13-4421908',
    ssn: '900-66-8810',
    dob: '1988-01-14',
    bankAccount: '003381920411',
    orgId: 'org-a-lakeview-bh',
    orgName: 'Lakeview Behavioral Health Partners',
    verifiedDaysAgo: 105,
  },
  {
    id: 'prac-a-7',
    npiBase: '100300075',
    medicaidId: 'MCD-A-10007',
    given: 'Hannah',
    family: 'Alvarez',
    prefix: 'Dr.',
    providerType: 'Individual Physician',
    specialtyCode: '207V00000X',
    specialtyDisplay: 'Obstetrics & Gynecology',
    licenseNumber: 'MD-819204',
    licenseState: 'NY',
    status: 'Suspended',
    acceptingNewPatients: false,
    city: 'Syracuse',
    state: 'NY',
    postalCode: '13210',
    street: '725 Irving Ave',
    phone: '315-555-0177',
    email: 'hannah.alvarez@synthetic.example',
    tin: '15-6630192',
    ssn: '900-77-5203',
    dob: '1973-08-27',
    bankAccount: '006642198301',
    orgId: 'org-a-capital-health',
    orgName: 'Capital Valley Medical Group',
    verifiedDaysAgo: 140,
  },
];

const TENANT_B_PROVIDERS: SeedProviderSpec[] = [
  {
    id: 'prac-b-1',
    npiBase: '100300088',
    medicaidId: 'MCD-B-20001',
    given: 'Rachel',
    family: 'Goldstein',
    prefix: 'Dr.',
    providerType: 'FQHC Clinician',
    specialtyCode: '207Q00000X',
    specialtyDisplay: 'Family Medicine',
    licenseNumber: 'IL-036-11920',
    licenseState: 'IL',
    status: 'Active',
    acceptingNewPatients: true,
    city: 'Chicago',
    state: 'IL',
    postalCode: '60612',
    street: '1900 W Polk St',
    phone: '312-555-0110',
    email: 'rachel.goldstein@fqhc-synthetic.example',
    tin: '36-4120987',
    ssn: '900-88-1029',
    dob: '1980-05-09',
    bankAccount: '002194857102',
    orgId: 'org-b-midwest-fqhc',
    orgName: 'Midwest Community Health Network',
    verifiedDaysAgo: 14,
  },
  {
    id: 'prac-b-2',
    npiBase: '100300090',
    medicaidId: 'MCD-B-20002',
    given: 'Mateo',
    family: 'Morales',
    prefix: 'PA',
    providerType: 'Physician Assistant',
    specialtyCode: '363A00000X',
    specialtyDisplay: 'Physician Assistant',
    licenseNumber: 'IL-085-44102',
    licenseState: 'IL',
    status: 'Active',
    acceptingNewPatients: true,
    city: 'Aurora',
    state: 'IL',
    postalCode: '60505',
    street: '412 N Broadway',
    phone: '630-555-0155',
    email: 'mateo.morales@fqhc-synthetic.example',
    tin: '36-4120987',
    ssn: '900-91-4470',
    dob: '1986-12-01',
    bankAccount: '002194857331',
    orgId: 'org-b-midwest-fqhc',
    orgName: 'Midwest Community Health Network',
    verifiedDaysAgo: 25,
  },
  {
    id: 'prac-b-3',
    npiBase: '100300102',
    medicaidId: 'MCD-B-20003',
    given: 'Nadia',
    family: 'Hassan',
    prefix: 'Dr.',
    providerType: 'FQHC Clinician',
    specialtyCode: '208000000X',
    specialtyDisplay: 'Pediatrics',
    licenseNumber: 'IL-036-77319',
    licenseState: 'IL',
    status: 'Applicant',
    acceptingNewPatients: true,
    city: 'Peoria',
    state: 'IL',
    postalCode: '61602',
    street: '220 NE Jefferson Ave',
    phone: '309-555-0190',
    email: 'nadia.hassan@fqhc-synthetic.example',
    tin: '36-4120987',
    ssn: '900-92-7741',
    dob: '1989-03-17',
    bankAccount: '002194857889',
    orgId: 'org-b-midwest-fqhc',
    orgName: 'Midwest Community Health Network',
    verifiedDaysAgo: 98,
  },
];

export function buildSampleClinicalBundle(tenantCode: string): FhirBundle {
  const now = new Date().toISOString();
  const patientId = `pat-jane-doe-${tenantCode}`;
  const encounterId = `enc-jane-doe-amb-${tenantCode}`;
  const conditionId = `cond-jane-doe-covid-${tenantCode}`;
  const obsId = `obs-jane-doe-sars-${tenantCode}`;

  const patient: FhirPatient = {
    resourceType: 'Patient',
    id: patientId,
    meta: {
      profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'],
    },
    identifier: [
      {
        use: 'usual',
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
              code: 'MR',
              display: 'Medical Record Number',
            },
          ],
        },
        system: MRN_SYSTEM,
        value: 'MRN-1001',
      },
    ],
    active: true,
    name: [{ use: 'official', family: 'Doe', given: ['Jane'], text: 'Jane Doe' }],
    telecom: [{ system: 'phone', value: '555-010-1001', use: 'home' }],
    gender: 'female',
    birthDate: '1985-07-14',
    address: [
      {
        use: 'home',
        line: ['120 Maple Grove Rd'],
        city: tenantCode.includes('fqhc') ? 'Chicago' : 'Albany',
        state: tenantCode.includes('fqhc') ? 'IL' : 'NY',
        postalCode: tenantCode.includes('fqhc') ? '60612' : '12207',
      },
    ],
    extension: [
      { url: SENSITIVE_SSN_EXT_URL, valueString: '900-10-1001' },
    ],
  };

  const encounter: FhirEncounter = {
    resourceType: 'Encounter',
    id: encounterId,
    status: 'finished',
    class: {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code: 'AMB',
      display: 'ambulatory',
    },
    type: [
      {
        coding: [
          {
            system: 'http://snomed.info/sct',
            code: '185349003',
            display: 'Encounter for check up',
          },
        ],
        text: 'Ambulatory respiratory clinic visit',
      },
    ],
    subject: { reference: `Patient/${patientId}`, display: 'Jane Doe' },
    period: { start: '2026-11-10T14:00:00Z', end: '2026-11-10T14:45:00Z' },
    reasonCode: [
      {
        coding: [
          {
            system: 'http://snomed.info/sct',
            code: '49727002',
            display: 'Cough',
          },
        ],
      },
    ],
  };

  const condition: FhirCondition = {
    resourceType: 'Condition',
    id: conditionId,
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'encounter-diagnosis',
            display: 'Encounter Diagnosis',
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '840539006',
          display: 'Disease caused by severe acute respiratory syndrome coronavirus 2 (COVID-19)',
        },
      ],
      text: 'COVID-19',
    },
    subject: { reference: `Patient/${patientId}`, display: 'Jane Doe' },
    encounter: { reference: `Encounter/${encounterId}` },
    onsetDateTime: '2026-11-08T00:00:00Z',
    recordedDate: '2026-11-10T14:20:00Z',
  };

  const observation: FhirObservation = {
    resourceType: 'Observation',
    id: obsId,
    status: 'final',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'laboratory',
            display: 'Laboratory',
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '94500-6',
          display: 'SARS-CoV-2 (COVID-19) RNA [Presence] in Respiratory specimen by NAA with probe detection',
        },
      ],
      text: 'SARS-CoV-2 RNA PCR',
    },
    subject: { reference: `Patient/${patientId}`, display: 'Jane Doe' },
    encounter: { reference: `Encounter/${encounterId}` },
    effectiveDateTime: '2026-11-10T14:30:00Z',
    issued: '2026-11-10T15:10:00Z',
    valueCodeableConcept: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '260373001',
          display: 'Detected',
        },
      ],
      text: 'Detected',
    },
  };

  const procedure: FhirProcedure = {
    resourceType: 'Procedure',
    id: `proc-jane-doe-swab-${tenantCode}`,
    status: 'completed',
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '258500001',
          display: 'Nasopharyngeal swab',
        },
      ],
      text: 'Nasopharyngeal specimen collection',
    },
    subject: { reference: `Patient/${patientId}`, display: 'Jane Doe' },
    encounter: { reference: `Encounter/${encounterId}` },
    performedDateTime: '2026-11-10T14:15:00Z',
  };

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    timestamp: now,
    entry: [patient, encounter, condition, observation, procedure].map((res) => ({
      fullUrl: `${res.resourceType}/${res.id}`,
      resource: res,
      request: {
        method: 'PUT',
        url: `${res.resourceType}/${res.id}`,
      },
    })),
  };
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function buildProviderResources(spec: SeedProviderSpec): {
  practitioner: FhirPractitioner;
  location: FhirLocation;
  endpoint: FhirEndpoint;
  role: FhirPractitionerRole;
  affiliation: FhirOrganizationAffiliation;
} {
  const npi = buildValidNpi(spec.npiBase);
  const locId = `loc-${spec.id}`;
  const epId = `ep-${spec.id}`;
  const roleId = `role-${spec.id}`;
  const affId = `aff-${spec.id}`;

  const practitioner: FhirPractitioner = {
    resourceType: 'Practitioner',
    id: spec.id,
    active: spec.status === 'Active' || spec.status === 'Revalidation Due',
    identifier: [
      { system: NPI_SYSTEM, value: npi, use: 'official' },
      { system: MEDICAID_ID_SYSTEM, value: spec.medicaidId, use: 'usual' },
      {
        system: LICENSE_SYSTEM,
        value: `${spec.licenseState}-${spec.licenseNumber}`,
        use: 'secondary',
      },
    ],
    name: [
      {
        use: 'official',
        prefix: [spec.prefix],
        given: [spec.given],
        family: spec.family,
        text: `${spec.prefix} ${spec.given} ${spec.family}`,
      },
    ],
    telecom: [
      { system: 'phone', value: spec.phone, use: 'work' },
      { system: 'email', value: spec.email, use: 'work' },
    ],
    address: [
      {
        use: 'work',
        line: [spec.street],
        city: spec.city,
        state: spec.state,
        postalCode: spec.postalCode,
      },
    ],
    birthDate: spec.dob,
    qualification: [
      {
        identifier: [{ system: LICENSE_SYSTEM, value: spec.licenseNumber }],
        code: {
          coding: [
            {
              system: TAXONOMY_SYSTEM,
              code: spec.specialtyCode,
              display: spec.specialtyDisplay,
            },
          ],
          text: `${spec.licenseState} License ${spec.licenseNumber}`,
        },
        period: { start: '2022-01-01', end: '2027-12-31' },
      },
    ],
    extension: [
      {
        url: PROVIDER_STATUS_EXT_URL,
        valueCode: spec.status,
        extension: [
          {
            url: 'effectivePeriod',
            valuePeriod: { start: '2025-01-01' },
          },
        ],
      },
      { url: ACCEPTING_PATIENTS_EXT_URL, valueBoolean: spec.acceptingNewPatients },
      { url: PROVIDER_TYPE_EXT_URL, valueString: spec.providerType },
      { url: SENSITIVE_TIN_EXT_URL, valueString: spec.tin },
      { url: SENSITIVE_SSN_EXT_URL, valueString: spec.ssn },
      { url: SENSITIVE_BANK_EXT_URL, valueString: spec.bankAccount },
      { url: LAST_VERIFIED_EXT_URL, valueDateTime: daysAgoIso(spec.verifiedDaysAgo) },
    ],
  };

  const location: FhirLocation = {
    resourceType: 'Location',
    id: locId,
    status: 'active',
    name: `${spec.orgName} - ${spec.city} Clinic`,
    telecom: [{ system: 'phone', value: spec.phone, use: 'work' }],
    address: {
      use: 'work',
      line: [spec.street],
      city: spec.city,
      state: spec.state,
      postalCode: spec.postalCode,
    },
    managingOrganization: {
      reference: `Organization/${spec.orgId}`,
      display: spec.orgName,
    },
  };

  const endpoint: FhirEndpoint = {
    resourceType: 'Endpoint',
    id: epId,
    status: 'active',
    connectionType: {
      system: 'http://terminology.hl7.org/CodeSystem/endpoint-connection-type',
      code: 'hl7-fhir-rest',
      display: 'HL7 FHIR',
    },
    name: `${spec.family} Direct/FHIR Endpoint`,
    managingOrganization: {
      reference: `Organization/${spec.orgId}`,
      display: spec.orgName,
    },
    payloadType: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/endpoint-payload-type',
            code: 'any',
            display: 'Any',
          },
        ],
      },
    ],
    address: `https://fhir.synthetic.example/${spec.id}`,
  };

  const role: FhirPractitionerRole = {
    resourceType: 'PractitionerRole',
    id: roleId,
    active: spec.status === 'Active',
    period: { start: '2025-01-01' },
    practitioner: {
      reference: `Practitioner/${spec.id}`,
      display: `${spec.prefix} ${spec.given} ${spec.family}`,
    },
    organization: {
      reference: `Organization/${spec.orgId}`,
      display: spec.orgName,
    },
    code: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/practitioner-role',
            code: 'doctor',
            display: spec.providerType,
          },
        ],
      },
    ],
    specialty: [
      {
        coding: [
          {
            system: TAXONOMY_SYSTEM,
            code: spec.specialtyCode,
            display: spec.specialtyDisplay,
          },
        ],
      },
    ],
    location: [{ reference: `Location/${locId}`, display: location.name }],
    endpoint: [{ reference: `Endpoint/${epId}`, display: endpoint.name }],
  };

  const affiliation: FhirOrganizationAffiliation = {
    resourceType: 'OrganizationAffiliation',
    id: affId,
    active: spec.status === 'Active',
    period: { start: '2025-01-01', end: '2027-12-31' },
    organization: {
      reference: `Organization/${spec.orgId}`,
      display: spec.orgName,
    },
    participatingOrganization: {
      reference: `Organization/${spec.orgId}`,
      display: spec.orgName,
    },
    specialty: [
      {
        coding: [
          {
            system: TAXONOMY_SYSTEM,
            code: spec.specialtyCode,
            display: spec.specialtyDisplay,
          },
        ],
      },
    ],
    location: [{ reference: `Location/${locId}`, display: location.name }],
  };

  return { practitioner, location, endpoint, role, affiliation };
}

const seededTenants = new Set<string>();

export async function seedTenantFhirData(
  client: FhirClient,
  ctx: FhirRequestContext,
  force = false,
): Promise<{ resourcesWritten: number }> {
  const key = `${client.mode}:${ctx.tenantId}`;
  if (seededTenants.has(key) && !force) {
    return { resourcesWritten: 0 };
  }

  const isTenantB =
    ctx.tenantId.includes('health-center') || ctx.tenantCode.includes('fqhc');
  const providerSpecs = isTenantB ? TENANT_B_PROVIDERS : TENANT_A_PROVIDERS;

  const orgMap = new Map<string, FhirOrganization>();
  for (const spec of providerSpecs) {
    if (!orgMap.has(spec.orgId)) {
      orgMap.set(spec.orgId, {
        resourceType: 'Organization',
        id: spec.orgId,
        active: true,
        identifier: [
          { system: NPI_SYSTEM, value: buildValidNpi(spec.npiBase.replace(/^1/, '2')) },
        ],
        type: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/organization-type',
                code: 'prov',
                display: 'Healthcare Provider',
              },
            ],
          },
        ],
        name: spec.orgName,
        address: [
          {
            use: 'work',
            line: [spec.street],
            city: spec.city,
            state: spec.state,
            postalCode: spec.postalCode,
          },
        ],
      });
    }
  }

  // Payor org + 3 InsurancePlans
  const payorOrgId = isTenantB ? 'org-payor-b' : 'org-payor-a';
  orgMap.set(payorOrgId, {
    resourceType: 'Organization',
    id: payorOrgId,
    active: true,
    type: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/organization-type',
            code: 'pay',
            display: 'Payer',
          },
        ],
      },
    ],
    name: isTenantB
      ? 'Midwest Medicaid Payer Authority'
      : 'State Medicaid Agency Payer Division',
  });

  const plans: FhirInsurancePlan[] = [
    {
      resourceType: 'InsurancePlan',
      id: `plan-ffs-${ctx.tenantCode}`,
      identifier: [{ system: 'http://providerlink.local/sid/plan-code', value: 'MED-FFS-2026' }],
      status: 'active',
      type: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/insurance-plan-type',
              code: 'FFS',
              display: 'Medicaid Fee-For-Service',
            },
          ],
        },
      ],
      name: 'State Medicaid Fee-For-Service Core',
      period: { start: '2026-01-01', end: '2026-12-31' },
      ownedBy: { reference: `Organization/${payorOrgId}` },
    },
    {
      resourceType: 'InsurancePlan',
      id: `plan-mco-${ctx.tenantCode}`,
      identifier: [{ system: 'http://providerlink.local/sid/plan-code', value: 'MCO-COMP-2026' }],
      status: 'active',
      type: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/insurance-plan-type',
              code: 'MCO',
              display: 'Managed Care Organization',
            },
          ],
        },
      ],
      name: 'CommunityCare Managed Medicaid MCO',
      period: { start: '2026-01-01', end: '2026-12-31' },
      ownedBy: { reference: `Organization/${payorOrgId}` },
    },
    {
      resourceType: 'InsurancePlan',
      id: `plan-chip-${ctx.tenantCode}`,
      identifier: [{ system: 'http://providerlink.local/sid/plan-code', value: 'CHIP-PLUS-2026' }],
      status: 'active',
      type: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/insurance-plan-type',
              code: 'CHIP',
              display: 'Children Health Insurance Program',
            },
          ],
        },
      ],
      name: 'ChildHealth Plus CHIP Network',
      period: { start: '2026-01-01', end: '2026-12-31' },
      ownedBy: { reference: `Organization/${payorOrgId}` },
    },
  ];

  const txEntries: NonNullable<FhirBundle['entry']> = [];
  for (const org of orgMap.values()) {
    txEntries.push({
      fullUrl: `Organization/${org.id}`,
      resource: org,
      request: { method: 'PUT', url: `Organization/${org.id}` },
    });
  }
  for (const spec of providerSpecs) {
    const built = buildProviderResources(spec);
    for (const res of [
      built.practitioner,
      built.location,
      built.endpoint,
      built.role,
      built.affiliation,
    ]) {
      txEntries.push({
        fullUrl: `${res.resourceType}/${res.id}`,
        resource: res,
        request: { method: 'PUT', url: `${res.resourceType}/${res.id}` },
      });
    }
  }
  for (const plan of plans) {
    txEntries.push({
      fullUrl: `InsurancePlan/${plan.id}`,
      resource: plan,
      request: { method: 'PUT', url: `InsurancePlan/${plan.id}` },
    });
  }

  // Add sample clinical bundle (Jane Doe MRN-1001 + COVID-19)
  const clinicalBundle = buildSampleClinicalBundle(ctx.tenantCode);
  txEntries.push(...(clinicalBundle.entry ?? []));

  // Add sample Coverage for Jane Doe
  const coverage: FhirCoverage = {
    resourceType: 'Coverage',
    id: `cov-jane-doe-${ctx.tenantCode}`,
    status: 'active',
    subscriberId: `SUB-${ctx.tenantCode.toUpperCase()}-1001`,
    beneficiary: {
      reference: `Patient/pat-jane-doe-${ctx.tenantCode}`,
      display: 'Jane Doe',
    },
    period: { start: '2026-01-01', end: '2026-12-31' },
    payor: [{ reference: `Organization/${payorOrgId}` }],
    class: [
      {
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/coverage-class',
              code: 'plan',
              display: 'Plan',
            },
          ],
        },
        value: `plan-ffs-${ctx.tenantCode}`,
        name: 'State Medicaid Fee-For-Service Core',
      },
    ],
  };
  txEntries.push({
    fullUrl: `Coverage/${coverage.id}`,
    resource: coverage,
    request: { method: 'PUT', url: `Coverage/${coverage.id}` },
  });

  await client.transaction(ctx, {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: txEntries,
  });

  seededTenants.add(key);
  return { resourcesWritten: txEntries.length };
}

export function resetSeedTracker(tenantId?: string): void {
  if (!tenantId) {
    seededTenants.clear();
    return;
  }
  for (const key of Array.from(seededTenants)) {
    if (key.endsWith(`:${tenantId}`)) {
      seededTenants.delete(key);
    }
  }
}
