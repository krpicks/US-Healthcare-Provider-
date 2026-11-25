export type FhirResourceType =
  | 'Patient'
  | 'Practitioner'
  | 'Organization'
  | 'PractitionerRole'
  | 'Location'
  | 'Endpoint'
  | 'OrganizationAffiliation'
  | 'InsurancePlan'
  | 'Encounter'
  | 'Condition'
  | 'Observation'
  | 'Procedure'
  | 'Coverage'
  | 'Claim'
  | 'ClaimResponse'
  | 'PaymentReconciliation'
  | 'Questionnaire'
  | 'QuestionnaireResponse'
  | 'DocumentReference'
  | 'Task'
  | 'Communication'
  | 'Provenance'
  | 'AuditEvent'
  | 'Subscription'
  | 'RiskAssessment'
  | 'DetectedIssue'
  | 'Composition'
  | 'Bundle'
  | 'OperationOutcome'
  | 'MeasureReport'
  | 'Consent'
  | 'CapabilityStatement'
  | 'MedicationRequest';

export const ALL_FHIR_RESOURCE_TYPES: readonly FhirResourceType[] = [
  'Patient',
  'Practitioner',
  'Organization',
  'PractitionerRole',
  'Location',
  'Endpoint',
  'OrganizationAffiliation',
  'InsurancePlan',
  'Encounter',
  'Condition',
  'Observation',
  'Procedure',
  'MedicationRequest',
  'Coverage',
  'Claim',
  'ClaimResponse',
  'PaymentReconciliation',
  'Questionnaire',
  'QuestionnaireResponse',
  'DocumentReference',
  'Task',
  'Communication',
  'Provenance',
  'AuditEvent',
  'Subscription',
  'RiskAssessment',
  'DetectedIssue',
  'Composition',
  'Bundle',
  'OperationOutcome',
  'MeasureReport',
  'Consent',
  'CapabilityStatement',
] as const;

export interface FhirMeta {
  versionId?: string;
  lastUpdated?: string;
  source?: string;
  profile?: string[];
  tag?: FhirCoding[];
}

export interface FhirCoding {
  system?: string;
  version?: string;
  code?: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirPeriod {
  start?: string;
  end?: string;
}

export interface FhirIdentifier {
  use?: 'usual' | 'official' | 'temp' | 'secondary' | 'old';
  type?: FhirCodeableConcept;
  system?: string;
  value?: string;
  period?: FhirPeriod;
}

export interface FhirReference {
  reference?: string;
  type?: string;
  identifier?: FhirIdentifier;
  display?: string;
}

export interface FhirHumanName {
  use?: 'usual' | 'official' | 'temp' | 'nickname' | 'anonymous' | 'old' | 'maiden';
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
  period?: FhirPeriod;
}

export interface FhirContactPoint {
  system?: 'phone' | 'fax' | 'email' | 'pager' | 'url' | 'sms' | 'other';
  value?: string;
  use?: 'home' | 'work' | 'temp' | 'old' | 'mobile';
  rank?: number;
  period?: FhirPeriod;
}

export interface FhirAddress {
  use?: 'home' | 'work' | 'temp' | 'old' | 'billing';
  type?: 'postal' | 'physical' | 'both';
  text?: string;
  line?: string[];
  city?: string;
  district?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  period?: FhirPeriod;
}

export interface FhirQuantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

export interface FhirMoney {
  value?: number;
  currency?: string;
}

export interface FhirAttachment {
  contentType?: string;
  language?: string;
  data?: string;
  url?: string;
  size?: number;
  hash?: string;
  title?: string;
  creation?: string;
}

export interface FhirExtension {
  url: string;
  valueString?: string;
  valueBoolean?: boolean;
  valueCode?: string;
  valueInteger?: number;
  valueDecimal?: number;
  valueDateTime?: string;
  valuePeriod?: FhirPeriod;
  valueCodeableConcept?: FhirCodeableConcept;
  extension?: FhirExtension[];
}

export interface FhirResource {
  resourceType: FhirResourceType;
  id?: string;
  meta?: FhirMeta;
  extension?: FhirExtension[];
  [key: string]: unknown;
}

export interface FhirPatient extends FhirResource {
  resourceType: 'Patient';
  identifier?: FhirIdentifier[];
  active?: boolean;
  name?: FhirHumanName[];
  telecom?: FhirContactPoint[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  deceasedBoolean?: boolean;
  address?: FhirAddress[];
  communication?: Array<{
    language: FhirCodeableConcept;
    preferred?: boolean;
  }>;
  managingOrganization?: FhirReference;
}

export interface FhirPractitioner extends FhirResource {
  resourceType: 'Practitioner';
  identifier?: FhirIdentifier[];
  active?: boolean;
  name?: FhirHumanName[];
  telecom?: FhirContactPoint[];
  address?: FhirAddress[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  qualification?: Array<{
    identifier?: FhirIdentifier[];
    code: FhirCodeableConcept;
    period?: FhirPeriod;
    issuer?: FhirReference;
  }>;
  communication?: FhirCodeableConcept[];
}

export interface FhirOrganization extends FhirResource {
  resourceType: 'Organization';
  identifier?: FhirIdentifier[];
  active?: boolean;
  type?: FhirCodeableConcept[];
  name?: string;
  alias?: string[];
  telecom?: FhirContactPoint[];
  address?: FhirAddress[];
  partOf?: FhirReference;
  contact?: Array<{
    purpose?: FhirCodeableConcept;
    name?: FhirHumanName;
    telecom?: FhirContactPoint[];
    address?: FhirAddress;
  }>;
  endpoint?: FhirReference[];
}

export interface FhirPractitionerRole extends FhirResource {
  resourceType: 'PractitionerRole';
  identifier?: FhirIdentifier[];
  active?: boolean;
  period?: FhirPeriod;
  practitioner?: FhirReference;
  organization?: FhirReference;
  code?: FhirCodeableConcept[];
  specialty?: FhirCodeableConcept[];
  location?: FhirReference[];
  telecom?: FhirContactPoint[];
  availableTime?: Array<{
    daysOfWeek?: string[];
    allDay?: boolean;
    availableStartTime?: string;
    availableEndTime?: string;
  }>;
  endpoint?: FhirReference[];
}

export interface FhirLocation extends FhirResource {
  resourceType: 'Location';
  identifier?: FhirIdentifier[];
  status?: 'active' | 'suspended' | 'inactive';
  name?: string;
  description?: string;
  mode?: 'instance' | 'kind';
  type?: FhirCodeableConcept[];
  telecom?: FhirContactPoint[];
  address?: FhirAddress;
  managingOrganization?: FhirReference;
  hoursOfOperation?: Array<{
    daysOfWeek?: string[];
    allDay?: boolean;
    openingTime?: string;
    closingTime?: string;
  }>;
}

export interface FhirEndpoint extends FhirResource {
  resourceType: 'Endpoint';
  identifier?: FhirIdentifier[];
  status: 'active' | 'suspended' | 'error' | 'off' | 'entered-in-error' | 'test';
  connectionType: FhirCoding;
  name?: string;
  managingOrganization?: FhirReference;
  payloadType: FhirCodeableConcept[];
  payloadMimeType?: string[];
  address: string;
}

export interface FhirOrganizationAffiliation extends FhirResource {
  resourceType: 'OrganizationAffiliation';
  identifier?: FhirIdentifier[];
  active?: boolean;
  period?: FhirPeriod;
  organization?: FhirReference;
  participatingOrganization?: FhirReference;
  network?: FhirReference[];
  code?: FhirCodeableConcept[];
  specialty?: FhirCodeableConcept[];
  location?: FhirReference[];
  endpoint?: FhirReference[];
}

export interface FhirInsurancePlan extends FhirResource {
  resourceType: 'InsurancePlan';
  identifier?: FhirIdentifier[];
  status?: 'draft' | 'active' | 'retired' | 'unknown';
  type?: FhirCodeableConcept[];
  name?: string;
  alias?: string[];
  period?: FhirPeriod;
  ownedBy?: FhirReference;
  administeredBy?: FhirReference;
  coverageArea?: FhirReference[];
  contact?: Array<{
    purpose?: FhirCodeableConcept;
    name?: FhirHumanName;
    telecom?: FhirContactPoint[];
  }>;
  network?: FhirReference[];
  coverage?: Array<{
    type: FhirCodeableConcept;
    network?: FhirReference[];
    benefit: Array<{
      type: FhirCodeableConcept;
      requirement?: string;
      limit?: Array<{ value?: FhirQuantity; code?: FhirCodeableConcept }>;
    }>;
  }>;
  plan?: Array<{
    identifier?: FhirIdentifier[];
    type?: FhirCodeableConcept;
    generalCost?: Array<{
      type?: FhirCodeableConcept;
      cost?: FhirMoney;
      comment?: string;
    }>;
  }>;
}

export interface FhirEncounter extends FhirResource {
  resourceType: 'Encounter';
  identifier?: FhirIdentifier[];
  status:
    | 'planned'
    | 'arrived'
    | 'triaged'
    | 'in-progress'
    | 'onleave'
    | 'finished'
    | 'cancelled'
    | 'entered-in-error'
    | 'unknown';
  class: FhirCoding;
  type?: FhirCodeableConcept[];
  subject?: FhirReference;
  participant?: Array<{
    individual?: FhirReference;
  }>;
  period?: FhirPeriod;
  reasonCode?: FhirCodeableConcept[];
  serviceProvider?: FhirReference;
}

export interface FhirCondition extends FhirResource {
  resourceType: 'Condition';
  identifier?: FhirIdentifier[];
  clinicalStatus?: FhirCodeableConcept;
  verificationStatus?: FhirCodeableConcept;
  category?: FhirCodeableConcept[];
  severity?: FhirCodeableConcept;
  code?: FhirCodeableConcept;
  subject: FhirReference;
  encounter?: FhirReference;
  onsetDateTime?: string;
  recordedDate?: string;
}

export interface FhirObservation extends FhirResource {
  resourceType: 'Observation';
  identifier?: FhirIdentifier[];
  status:
    | 'registered'
    | 'preliminary'
    | 'final'
    | 'amended'
    | 'corrected'
    | 'cancelled'
    | 'entered-in-error'
    | 'unknown';
  category?: FhirCodeableConcept[];
  code: FhirCodeableConcept;
  subject?: FhirReference;
  encounter?: FhirReference;
  effectiveDateTime?: string;
  issued?: string;
  valueQuantity?: FhirQuantity;
  valueCodeableConcept?: FhirCodeableConcept;
  valueString?: string;
  interpretation?: FhirCodeableConcept[];
}

export interface FhirProcedure extends FhirResource {
  resourceType: 'Procedure';
  identifier?: FhirIdentifier[];
  status:
    | 'preparation'
    | 'in-progress'
    | 'not-done'
    | 'on-hold'
    | 'stopped'
    | 'completed'
    | 'entered-in-error'
    | 'unknown';
  code?: FhirCodeableConcept;
  subject: FhirReference;
  encounter?: FhirReference;
  performedDateTime?: string;
  performedPeriod?: FhirPeriod;
  performer?: Array<{ actor: FhirReference }>;
}

export interface FhirMedicationRequest extends FhirResource {
  resourceType: 'MedicationRequest';
  identifier?: FhirIdentifier[];
  status:
    | 'active'
    | 'on-hold'
    | 'cancelled'
    | 'completed'
    | 'entered-in-error'
    | 'stopped'
    | 'draft'
    | 'unknown';
  intent: 'proposal' | 'plan' | 'order' | 'original-order' | 'instance-order';
  medicationCodeableConcept?: FhirCodeableConcept;
  subject: FhirReference;
  encounter?: FhirReference;
  authoredOn?: string;
  requester?: FhirReference;
}

export interface FhirCoverage extends FhirResource {
  resourceType: 'Coverage';
  identifier?: FhirIdentifier[];
  status: 'active' | 'cancelled' | 'draft' | 'entered-in-error';
  type?: FhirCodeableConcept;
  subscriberId?: string;
  beneficiary: FhirReference;
  period?: FhirPeriod;
  payor: FhirReference[];
  class?: Array<{
    type: FhirCodeableConcept;
    value: string;
    name?: string;
  }>;
}

export interface FhirClaim extends FhirResource {
  resourceType: 'Claim';
  identifier?: FhirIdentifier[];
  status: 'active' | 'cancelled' | 'draft' | 'entered-in-error';
  type: FhirCodeableConcept;
  use: 'claim' | 'preauthorization' | 'predetermination';
  patient: FhirReference;
  created: string;
  insurer?: FhirReference;
  provider: FhirReference;
  priority: FhirCodeableConcept;
  diagnosis?: Array<{
    sequence: number;
    diagnosisCodeableConcept?: FhirCodeableConcept;
  }>;
  insurance: Array<{
    sequence: number;
    focal: boolean;
    coverage: FhirReference;
  }>;
  item?: Array<{
    sequence: number;
    productOrService: FhirCodeableConcept;
    modifier?: FhirCodeableConcept[];
    servicedDate?: string;
    quantity?: FhirQuantity;
    unitPrice?: FhirMoney;
    net?: FhirMoney;
  }>;
  total?: FhirMoney;
}

export interface FhirClaimResponse extends FhirResource {
  resourceType: 'ClaimResponse';
  identifier?: FhirIdentifier[];
  status: 'active' | 'cancelled' | 'draft' | 'entered-in-error';
  type: FhirCodeableConcept;
  use: 'claim' | 'preauthorization' | 'predetermination';
  patient: FhirReference;
  created: string;
  insurer: FhirReference;
  request?: FhirReference;
  outcome: 'queued' | 'complete' | 'error' | 'partial';
  disposition?: string;
  total?: Array<{
    category: FhirCodeableConcept;
    amount: FhirMoney;
  }>;
  error?: Array<{
    itemSequence?: number;
    code: FhirCodeableConcept;
  }>;
}

export interface FhirPaymentReconciliation extends FhirResource {
  resourceType: 'PaymentReconciliation';
  identifier?: FhirIdentifier[];
  status: 'active' | 'cancelled' | 'draft' | 'entered-in-error';
  created: string;
  paymentIssuer?: FhirReference;
  paymentDate: string;
  paymentAmount: FhirMoney;
  outcome?: 'queued' | 'complete' | 'error' | 'partial';
  disposition?: string;
  detail?: Array<{
    identifier?: FhirIdentifier;
    type: FhirCodeableConcept;
    request?: FhirReference;
    response?: FhirReference;
    date?: string;
    amount?: FhirMoney;
  }>;
}

export interface FhirQuestionnaire extends FhirResource {
  resourceType: 'Questionnaire';
  url?: string;
  version?: string;
  name?: string;
  title?: string;
  status: 'draft' | 'active' | 'retired' | 'unknown';
  item?: Array<{
    linkId: string;
    text?: string;
    type: string;
    required?: boolean;
  }>;
}

export interface FhirQuestionnaireResponseItem {
  linkId: string;
  text?: string;
  answer?: Array<{
    valueString?: string;
    valueBoolean?: boolean;
    valueInteger?: number;
    valueDate?: string;
  }>;
  item?: FhirQuestionnaireResponseItem[];
}

export interface FhirQuestionnaireResponse extends FhirResource {
  resourceType: 'QuestionnaireResponse';
  identifier?: FhirIdentifier;
  questionnaire?: string;
  status: 'in-progress' | 'completed' | 'amended' | 'entered-in-error' | 'stopped';
  subject?: FhirReference;
  authored?: string;
  author?: FhirReference;
  item?: FhirQuestionnaireResponseItem[];
}

export interface FhirDocumentReference extends FhirResource {
  resourceType: 'DocumentReference';
  identifier?: FhirIdentifier[];
  status: 'current' | 'superseded' | 'entered-in-error';
  docStatus?: 'preliminary' | 'final' | 'amended' | 'entered-in-error';
  type?: FhirCodeableConcept;
  subject?: FhirReference;
  date?: string;
  description?: string;
  content: Array<{
    attachment: FhirAttachment;
  }>;
}

export interface FhirTask extends FhirResource {
  resourceType: 'Task';
  identifier?: FhirIdentifier[];
  status:
    | 'draft'
    | 'requested'
    | 'received'
    | 'accepted'
    | 'rejected'
    | 'ready'
    | 'cancelled'
    | 'in-progress'
    | 'on-hold'
    | 'failed'
    | 'completed'
    | 'entered-in-error';
  intent: 'unknown' | 'proposal' | 'plan' | 'order' | 'original-order';
  priority?: 'routine' | 'urgent' | 'asap' | 'stat';
  code?: FhirCodeableConcept;
  description?: string;
  focus?: FhirReference;
  for?: FhirReference;
  authoredOn?: string;
  lastModified?: string;
  requester?: FhirReference;
  owner?: FhirReference;
  note?: Array<{ text: string; time?: string; authorString?: string }>;
  input?: Array<{ type: FhirCodeableConcept; valueString?: string }>;
  output?: Array<{ type: FhirCodeableConcept; valueString?: string }>;
}

export interface FhirCommunication extends FhirResource {
  resourceType: 'Communication';
  identifier?: FhirIdentifier[];
  status:
    | 'preparation'
    | 'in-progress'
    | 'not-done'
    | 'on-hold'
    | 'stopped'
    | 'completed'
    | 'entered-in-error'
    | 'unknown';
  category?: FhirCodeableConcept[];
  subject?: FhirReference;
  about?: FhirReference[];
  sent?: string;
  received?: string;
  recipient?: FhirReference[];
  sender?: FhirReference;
  payload?: Array<{
    contentString?: string;
    contentAttachment?: FhirAttachment;
  }>;
}

export interface FhirProvenance extends FhirResource {
  resourceType: 'Provenance';
  target: FhirReference[];
  recorded: string;
  reason?: FhirCodeableConcept[];
  activity?: FhirCodeableConcept;
  agent: Array<{
    type?: FhirCodeableConcept;
    who: FhirReference;
  }>;
  entity?: Array<{
    role: 'derivation' | 'revision' | 'quotation' | 'source' | 'removal';
    what: FhirReference;
  }>;
}

export interface FhirAuditEvent extends FhirResource {
  resourceType: 'AuditEvent';
  type: FhirCoding;
  subtype?: FhirCoding[];
  action?: 'C' | 'R' | 'U' | 'D' | 'E';
  recorded: string;
  outcome?: '0' | '4' | '8' | '12';
  outcomeDesc?: string;
  agent: Array<{
    type?: FhirCodeableConcept;
    role?: FhirCodeableConcept[];
    who?: FhirReference;
    altId?: string;
    name?: string;
    requestor: boolean;
  }>;
  source: {
    site?: string;
    observer: FhirReference;
  };
  entity?: Array<{
    what?: FhirReference;
    type?: FhirCoding;
    name?: string;
    description?: string;
    detail?: Array<{ type: string; valueString?: string }>;
  }>;
}

export interface FhirSubscription extends FhirResource {
  resourceType: 'Subscription';
  status: 'requested' | 'active' | 'error' | 'off';
  reason: string;
  criteria: string;
  channel: {
    type: 'rest-hook' | 'websocket' | 'email' | 'sms' | 'message';
    endpoint?: string;
    payload?: string;
  };
}

export interface FhirRiskAssessment extends FhirResource {
  resourceType: 'RiskAssessment';
  status: 'registered' | 'preliminary' | 'final' | 'amended' | 'cancelled';
  subject: FhirReference;
  occurrenceDateTime?: string;
  prediction?: Array<{
    outcome?: FhirCodeableConcept;
    qualitativeRisk?: FhirCodeableConcept;
    rationale?: string;
  }>;
  note?: Array<{ text: string }>;
}

export interface FhirDetectedIssue extends FhirResource {
  resourceType: 'DetectedIssue';
  status: 'registered' | 'preliminary' | 'final' | 'amended' | 'cancelled';
  code?: FhirCodeableConcept;
  severity?: 'high' | 'moderate' | 'low';
  patient?: FhirReference;
  identifiedDateTime?: string;
  detail?: string;
  implicated?: FhirReference[];
}

export interface FhirComposition extends FhirResource {
  resourceType: 'Composition';
  identifier?: FhirIdentifier;
  status: 'preliminary' | 'final' | 'amended' | 'entered-in-error';
  type: FhirCodeableConcept;
  subject?: FhirReference;
  encounter?: FhirReference;
  date: string;
  author: FhirReference[];
  title: string;
  section?: Array<{
    title?: string;
    code?: FhirCodeableConcept;
    text?: { status: string; div: string };
    entry?: FhirReference[];
  }>;
}

export interface FhirMeasureReport extends FhirResource {
  resourceType: 'MeasureReport';
  status: 'complete' | 'pending' | 'error';
  type: 'individual' | 'subject-list' | 'summary' | 'data-collection';
  measure: string;
  date?: string;
  period: FhirPeriod;
  group?: Array<{
    code?: FhirCodeableConcept;
    population?: Array<{
      code?: FhirCodeableConcept;
      count?: number;
    }>;
  }>;
}

export interface FhirConsent extends FhirResource {
  resourceType: 'Consent';
  status: 'draft' | 'proposed' | 'active' | 'rejected' | 'inactive' | 'entered-in-error';
  scope: FhirCodeableConcept;
  category: FhirCodeableConcept[];
  patient?: FhirReference;
  dateTime?: string;
  policyRule?: FhirCodeableConcept;
  provision?: {
    type?: 'deny' | 'permit';
    period?: FhirPeriod;
    securityLabel?: FhirCoding[];
  };
}

export interface FhirOperationOutcomeIssue {
  severity: 'fatal' | 'error' | 'warning' | 'information';
  code: string;
  details?: FhirCodeableConcept;
  diagnostics?: string;
  expression?: string[];
}

export interface FhirOperationOutcome extends FhirResource {
  resourceType: 'OperationOutcome';
  issue: FhirOperationOutcomeIssue[];
}

export interface FhirBundleEntry<T extends FhirResource = FhirResource> {
  fullUrl?: string;
  resource?: T;
  search?: {
    mode?: 'match' | 'include' | 'outcome';
  };
  request?: {
    method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    url: string;
    ifNoneExist?: string;
  };
  response?: {
    status: string;
    location?: string;
    etag?: string;
    lastModified?: string;
    outcome?: FhirOperationOutcome;
  };
}

export interface FhirBundleLink {
  relation: 'self' | 'next' | 'previous' | 'first' | 'last';
  url: string;
}

export interface FhirBundle<T extends FhirResource = FhirResource>
  extends FhirResource {
  resourceType: 'Bundle';
  type:
    | 'document'
    | 'message'
    | 'transaction'
    | 'transaction-response'
    | 'batch'
    | 'batch-response'
    | 'history'
    | 'searchset'
    | 'collection';
  timestamp?: string;
  total?: number;
  link?: FhirBundleLink[];
  entry?: FhirBundleEntry<T>[];
}

export interface FhirCapabilityStatement extends FhirResource {
  resourceType: 'CapabilityStatement';
  status: 'draft' | 'active' | 'retired' | 'unknown';
  date: string;
  kind: 'instance' | 'capability' | 'requirements';
  fhirVersion: string;
  format: string[];
  software?: {
    name: string;
    version?: string;
  };
  rest?: Array<{
    mode: 'client' | 'server';
    resource?: Array<{
      type: string;
      interaction?: Array<{ code: string }>;
      searchParam?: Array<{ name: string; type: string }>;
    }>;
  }>;
}
