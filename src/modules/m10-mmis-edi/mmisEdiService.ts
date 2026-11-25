import { eventBus } from '../../events';
import { getFhirClient, type FhirRequestContext } from '../../fhir';
import { MEDICAID_ID_SYSTEM } from '../../mock-data';
import { auditService, settingsService } from '../../services';
import {
  AppError,
  type FhirEndpoint,
  type FhirPractitioner,
  type FhirProvenance,
  type FhirTask,
  type RoleName,
} from '../../types';
import {
  providerService,
  type ProviderEnrollmentStatus,
} from '../m3-directory/providerService';

export type MmisLoadStatus = 'Queued' | 'Sent' | 'Acknowledged' | 'Rejected';
export type MmisAdapterMode = 'Mock' | 'Gateway';
export type EdiTransactionCode =
  | '837P'
  | '837I'
  | '835'
  | '270/271'
  | '276/277'
  | '278';

export interface MmisLoadRecord {
  id: string;
  practitionerId: string;
  providerName: string;
  npi: string;
  medicaidId: string;
  action: 'InitialLoad' | 'StatusUpdate' | 'ReconciliationResend';
  providerStatus: ProviderEnrollmentStatus;
  effectiveDate: string;
  status: MmisLoadStatus;
  adapterUsed: MmisAdapterMode;
  fallbackWarning?: string;
  rejectionReason?: string;
  jsonPayload: string;
  fixedWidthPayload: string;
  queuedAt: string;
  sentAt?: string;
  acknowledgedAt?: string;
  taskId?: string;
}

export interface MmisReconciliationRow {
  loadId: string;
  practitionerId: string;
  providerName: string;
  npi: string;
  mmisMedicaidId: string;
  fhirMedicaidId: string;
  mmisStatus: ProviderEnrollmentStatus;
  fhirStatus: ProviderEnrollmentStatus | 'Missing';
  mismatches: string[];
}

export interface EdiTradingPartner {
  id: string;
  tradingPartnerId: string;
  name: string;
  submitterId: string;
  receiverId: string;
  transactions: EdiTransactionCode[];
  connectivity: 'Portal' | 'SFTP' | 'API';
  endpointAddress: string;
  checklist: {
    envelopeTested: boolean;
    ack999Passed: boolean;
    ack277CaPassed: boolean;
    securityVerified: boolean;
  };
  status: 'Testing' | 'Live';
  endpointResourceId?: string;
  createdAt: string;
  goLiveAt?: string;
}

export interface EdiTestResult {
  id: string;
  testedAt: string;
  transactionType: string;
  valid: boolean;
  errors: string[];
  ack999: string;
  ack277Ca: string;
}

interface TenantMmisState {
  medicaidIdPrefix: string;
  medicaidIdSeq: number;
  adapterMode: MmisAdapterMode;
  loads: MmisLoadRecord[];
  tradingPartners: EdiTradingPartner[];
  ediTests: EdiTestResult[];
}

const tenantMmisStore = new Map<string, TenantMmisState>();

function buildFixedWidthLine(rec: {
  medicaidId: string;
  npi: string;
  providerName: string;
  action: string;
  providerStatus: string;
  effectiveDate: string;
}): string {
  const pad = (val: string, len: number) => val.slice(0, len).padEnd(len, ' ');
  return [
    'HDRMMIS01',
    pad(rec.medicaidId, 16),
    pad(rec.npi, 10),
    pad(rec.providerName.toUpperCase(), 32),
    pad(rec.action.toUpperCase(), 16),
    pad(rec.providerStatus.toUpperCase(), 16),
    pad(rec.effectiveDate.replaceAll('-', ''), 8),
  ].join('');
}

function getState(tenantId: string): TenantMmisState {
  let st = tenantMmisStore.get(tenantId);
  if (!st) {
    const isTenantB = tenantId.includes('health-center');
    const prefix = isTenantB ? 'IL-FQHC' : 'NY-MCD';
    const seedMedId = `${prefix}-900101`;
    const seedName = isTenantB ? 'Dr. Rachel Goldstein' : 'Dr. Elena Vargas';
    const seedNpi = isTenantB ? '1457321980' : '1234567893';
    const seedPracId = isTenantB ? 'prac-b-1' : 'prac-a-1';

    st = {
      medicaidIdPrefix: prefix,
      medicaidIdSeq: 900102,
      adapterMode: 'Mock',
      loads: [
        {
          id: `mmis-seed-1-${tenantId}`,
          practitionerId: seedPracId,
          providerName: seedName,
          npi: seedNpi,
          medicaidId: seedMedId,
          action: 'InitialLoad',
          providerStatus: 'Active',
          effectiveDate: '2026-01-01',
          status: 'Acknowledged',
          adapterUsed: 'Mock',
          jsonPayload: JSON.stringify(
            { medicaidId: seedMedId, npi: seedNpi, name: seedName, status: 'Active', effectiveDate: '2026-01-01' },
            null,
            2,
          ),
          fixedWidthPayload: buildFixedWidthLine({
            medicaidId: seedMedId,
            npi: seedNpi,
            providerName: seedName,
            action: 'InitialLoad',
            providerStatus: 'Active',
            effectiveDate: '2026-01-01',
          }),
          queuedAt: '2026-01-02T09:00:00Z',
          sentAt: '2026-01-02T09:01:00Z',
          acknowledgedAt: '2026-01-02T09:02:00Z',
        },
      ],
      tradingPartners: [
        {
          id: `tp-seed-1-${tenantId}`,
          tradingPartnerId: isTenantB ? 'TP-MWFQHC-001' : 'TP-CAPVAL-001',
          name: isTenantB ? 'Midwest FQHC Clearinghouse' : 'Capital Valley EDI Billing Hub',
          submitterId: isTenantB ? 'SUBMW001' : 'SUBCV001',
          receiverId: isTenantB ? 'ILMMIS01' : 'NYMMIS01',
          transactions: ['837P', '835', '270/271', '276/277'],
          connectivity: 'API',
          endpointAddress: 'https://edi.synthetic.example/x12/v5010',
          checklist: {
            envelopeTested: true,
            ack999Passed: true,
            ack277CaPassed: true,
            securityVerified: true,
          },
          status: 'Live',
          createdAt: '2026-01-05T10:00:00Z',
          goLiveAt: '2026-01-12T16:00:00Z',
        },
      ],
      ediTests: [],
    };
    tenantMmisStore.set(tenantId, st);
  }
  return st;
}

export const SAMPLE_X12_837P = [
  'ISA*00*          *00*          *ZZ*SUBCV001       *ZZ*NYMMIS01       *260301*1200*^*00501*000000905*0*T*:~',
  'GS*HC*SUBCV001*NYMMIS01*20260301*1200*1*X*005010X222A1~',
  'ST*837*0001*005010X222A1~',
  'BHT*0019*00*CLM2026001*20260301*1200*CH~',
  'NM1*41*2*CAPITAL VALLEY MEDICAL*****46*SUBCV001~',
  'CLM*CLM2026001*131.75***11:B:1*Y*A*Y*Y~',
  'SV1*HC:99214*131.75*UN*1***1~',
  'SE*6*0001~',
  'GE*1*1~',
  'IEA*1*000000905~',
].join('\n');

let eventListenersRegistered = false;

export const mmisEdiService = {
  /**
   * Registers platform event subscriptions for ProviderApproved and ProviderStatusChanged.
   * Safe to invoke multiple times (idempotent).
   */
  ensureEventSubscriptions(): void {
    if (eventListenersRegistered) return;
    eventListenersRegistered = true;

    eventBus.subscribe<{
      practitionerId?: string;
      providerName?: string;
      npi?: string;
      effectiveDate?: string;
    }>('ProviderApproved', (evt) => {
      const p = evt.payload;
      if (!p?.npi) return;
      this.queueMmisLoad(evt.tenantId, {
        practitionerId: p.practitionerId ?? `prac-${p.npi}`,
        providerName: p.providerName ?? 'Approved Provider',
        npi: p.npi,
        action: 'InitialLoad',
        providerStatus: 'Active',
        effectiveDate: p.effectiveDate ?? new Date().toISOString().slice(0, 10),
      });
    });

    eventBus.subscribe<{
      practitionerId?: string;
      newStatus?: ProviderEnrollmentStatus;
      effectiveDate?: string;
      providerName?: string;
      npi?: string;
    }>('ProviderStatusChanged', (evt) => {
      const p = evt.payload;
      if (!p?.practitionerId || !p.newStatus) return;
      const st = getState(evt.tenantId);
      const existingLoad = st.loads.find((l) => l.practitionerId === p.practitionerId);
      this.queueMmisLoad(evt.tenantId, {
        practitionerId: p.practitionerId,
        providerName: p.providerName ?? existingLoad?.providerName ?? `Practitioner/${p.practitionerId}`,
        npi: p.npi ?? existingLoad?.npi ?? '0000000000',
        existingMedicaidId: existingLoad?.medicaidId,
        action: 'StatusUpdate',
        providerStatus: p.newStatus,
        effectiveDate: p.effectiveDate ?? new Date().toISOString().slice(0, 10),
      });
    });
  },

  getState(tenantId: string): TenantMmisState {
    this.ensureEventSubscriptions();
    return getState(tenantId);
  },

  resetForTests(tenantId?: string): void {
    if (tenantId) {
      tenantMmisStore.delete(tenantId);
    } else {
      tenantMmisStore.clear();
    }
    this.ensureEventSubscriptions();
  },

  setConfig(
    tenantId: string,
    patch: Partial<Pick<TenantMmisState, 'medicaidIdPrefix' | 'adapterMode'>>,
  ): TenantMmisState {
    const st = getState(tenantId);
    if (patch.medicaidIdPrefix !== undefined) st.medicaidIdPrefix = patch.medicaidIdPrefix;
    if (patch.adapterMode !== undefined) st.adapterMode = patch.adapterMode;
    return st;
  },

  generateMedicaidId(tenantId: string): string {
    const st = getState(tenantId);
    const id = `${st.medicaidIdPrefix}-${st.medicaidIdSeq}`;
    st.medicaidIdSeq += 1;
    return id;
  },

  queueMmisLoad(
    tenantId: string,
    input: {
      practitionerId: string;
      providerName: string;
      npi: string;
      existingMedicaidId?: string;
      action: MmisLoadRecord['action'];
      providerStatus: ProviderEnrollmentStatus;
      effectiveDate: string;
    },
  ): MmisLoadRecord {
    const st = getState(tenantId);
    const medicaidId = input.existingMedicaidId?.trim() || this.generateMedicaidId(tenantId);
    const jsonPayload = JSON.stringify(
      {
        medicaidId,
        practitionerId: input.practitionerId,
        npi: input.npi,
        providerName: input.providerName,
        action: input.action,
        status: input.providerStatus,
        effectiveDate: input.effectiveDate,
      },
      null,
      2,
    );
    const fixedWidthPayload = buildFixedWidthLine({
      medicaidId,
      npi: input.npi,
      providerName: input.providerName,
      action: input.action,
      providerStatus: input.providerStatus,
      effectiveDate: input.effectiveDate,
    });

    const record: MmisLoadRecord = {
      id: `mmis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      practitionerId: input.practitionerId,
      providerName: input.providerName,
      npi: input.npi,
      medicaidId,
      action: input.action,
      providerStatus: input.providerStatus,
      effectiveDate: input.effectiveDate,
      status: 'Queued',
      adapterUsed: st.adapterMode,
      jsonPayload,
      fixedWidthPayload,
      queuedAt: new Date().toISOString(),
    };
    st.loads.unshift(record);
    return record;
  },

  async sendMmisLoad(
    ctx: FhirRequestContext,
    loadId: string,
    actor: { name: string; role: RoleName },
    options?: { forceOutcome?: 'Acknowledged' | 'Rejected' },
  ): Promise<MmisLoadRecord> {
    const st = getState(ctx.tenantId);
    const rec = st.loads.find((l) => l.id === loadId);
    if (!rec) {
      throw new AppError({ message: 'MMIS load record not found.', statusCode: 404, code: 'NOT_FOUND' });
    }

    const now = new Date().toISOString();
    rec.sentAt = now;
    rec.status = 'Sent';
    rec.fallbackWarning = undefined;
    rec.rejectionReason = undefined;

    let outcome: 'Acknowledged' | 'Rejected' =
      options?.forceOutcome ?? (Math.random() < 0.05 ? 'Rejected' : 'Acknowledged');

    if (st.adapterMode === 'Gateway') {
      const gatewayBase = settingsService.load().gatewayBaseUrl.replace(/\/+$/, '');
      try {
        const resp = await fetch(`${gatewayBase}/api/v1/mmis/loads`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-Id': ctx.tenantCode,
          },
          body: rec.jsonPayload,
        });
        if (!resp.ok) {
          throw new Error(`Gateway HTTP ${resp.status}`);
        }
        rec.adapterUsed = 'Gateway';
        outcome = options?.forceOutcome ?? 'Acknowledged';
      } catch (err) {
        rec.adapterUsed = 'Mock';
        rec.fallbackWarning = `Gateway unreachable (${err instanceof Error ? err.message : 'network error'}); executed via Mock MMIS adapter.`;
      }
    } else {
      rec.adapterUsed = 'Mock';
    }

    rec.status = outcome;
    const client = getFhirClient();

    if (outcome === 'Acknowledged') {
      rec.acknowledgedAt = new Date().toISOString();

      // Persist Medicaid ID back onto M3 Practitioner if present in FHIR store
      try {
        const prac = await client.read<FhirPractitioner>(ctx, 'Practitioner', rec.practitionerId);
        const hasMedId = prac.identifier?.some((i) => i.system === MEDICAID_ID_SYSTEM && i.value === rec.medicaidId);
        if (!hasMedId) {
          const updated: FhirPractitioner = {
            ...prac,
            identifier: [
              ...(prac.identifier ?? []).filter((i) => i.system !== MEDICAID_ID_SYSTEM),
              { system: MEDICAID_ID_SYSTEM, value: rec.medicaidId, use: 'usual' },
            ],
          };
          await client.update(ctx, updated);
        }
      } catch {
        // Provider may not exist in FHIR store yet in isolated tests
      }

      const task = await client.create<FhirTask>(ctx, {
        resourceType: 'Task',
        status: 'completed',
        intent: 'order',
        code: { text: 'MMIS Provider Load' },
        description: `MMIS ${rec.action} Acknowledged: ${rec.medicaidId} (NPI ${rec.npi})`,
        authoredOn: rec.queuedAt,
        lastModified: rec.acknowledgedAt,
      });
      rec.taskId = task.id;

      eventBus.publish({
        type: 'MmisLoadAcknowledged',
        tenantId: ctx.tenantId,
        sourceModule: 'M10',
        payload: {
          loadId: rec.id,
          practitionerId: rec.practitionerId,
          npi: rec.npi,
          medicaidId: rec.medicaidId,
          action: rec.action,
          providerStatus: rec.providerStatus,
        },
      });
    } else {
      rec.rejectionReason = 'MMIS Segment 42 Reject: Tax ID / Medicaid Effective Date mismatch (simulated 5% reject).';
    }

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'update',
      resourceType: 'Task',
      resourceId: rec.taskId,
      outcomeDesc: `MMIS load ${rec.id} (${rec.medicaidId}) -> ${rec.status}`,
    });

    return rec;
  },

  async computeReconciliation(ctx: FhirRequestContext): Promise<MmisReconciliationRow[]> {
    const st = getState(ctx.tenantId);
    const providers = await providerService.listProviders(ctx);
    const latestByPrac = new Map<string, MmisLoadRecord>();

    for (const load of st.loads) {
      if (!latestByPrac.has(load.practitionerId)) {
        latestByPrac.set(load.practitionerId, load);
      }
    }

    return Array.from(latestByPrac.values()).map((load) => {
      const match =
        providers.find((p) => p.id === load.practitionerId) ??
        providers.find((p) => p.npi === load.npi);
      const mismatches: string[] = [];
      if (!match) {
        mismatches.push('Provider missing in FHIR directory');
      } else {
        if (match.medicaidId !== load.medicaidId) {
          mismatches.push(`Medicaid ID mismatch (MMIS: ${load.medicaidId} vs FHIR: ${match.medicaidId || 'none'})`);
        }
        if (match.status !== load.providerStatus) {
          mismatches.push(`Status mismatch (MMIS: ${load.providerStatus} vs FHIR: ${match.status})`);
        }
      }
      return {
        loadId: load.id,
        practitionerId: load.practitionerId,
        providerName: load.providerName,
        npi: load.npi,
        mmisMedicaidId: load.medicaidId,
        fhirMedicaidId: match?.medicaidId ?? '',
        mmisStatus: load.providerStatus,
        fhirStatus: match?.status ?? 'Missing',
        mismatches,
      };
    });
  },

  async fixMismatchInFhir(
    ctx: FhirRequestContext,
    loadId: string,
    actor: { name: string; role: RoleName },
  ): Promise<void> {
    const st = getState(ctx.tenantId);
    const load = st.loads.find((l) => l.id === loadId);
    if (!load) {
      throw new AppError({ message: 'MMIS load not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    const client = getFhirClient();
    const prac = await client.read<FhirPractitioner>(ctx, 'Practitioner', load.practitionerId);
    const updated: FhirPractitioner = {
      ...prac,
      identifier: [
        ...(prac.identifier ?? []).filter((i) => i.system !== MEDICAID_ID_SYSTEM),
        { system: MEDICAID_ID_SYSTEM, value: load.medicaidId, use: 'usual' },
      ],
    };
    await client.update(ctx, updated);

    await client.create<FhirProvenance>(ctx, {
      resourceType: 'Provenance',
      target: [{ reference: `Practitioner/${load.practitionerId}` }],
      recorded: new Date().toISOString(),
      reason: [{ text: `MMIS reconciliation sync: set Medicaid ID ${load.medicaidId}` }],
      agent: [{ who: { display: `${actor.name} (${actor.role})` } }],
    });
  },

  createTradingPartner(
    tenantId: string,
    input: {
      tradingPartnerId: string;
      name: string;
      submitterId: string;
      receiverId: string;
      transactions: EdiTransactionCode[];
      connectivity: 'Portal' | 'SFTP' | 'API';
      endpointAddress: string;
    },
  ): EdiTradingPartner {
    if (!input.tradingPartnerId.trim() || !input.name.trim() || input.transactions.length === 0) {
      throw new AppError({
        message: 'Trading Partner ID, name, and at least one X12 transaction are required.',
        statusCode: 400,
        code: 'INVALID_TRADING_PARTNER',
      });
    }
    const st = getState(tenantId);
    const created: EdiTradingPartner = {
      id: `tp-${Date.now().toString(36)}`,
      ...input,
      checklist: {
        envelopeTested: false,
        ack999Passed: false,
        ack277CaPassed: false,
        securityVerified: false,
      },
      status: 'Testing',
      createdAt: new Date().toISOString(),
    };
    st.tradingPartners.unshift(created);
    return created;
  },

  updatePartnerChecklist(
    tenantId: string,
    partnerId: string,
    patch: Partial<EdiTradingPartner['checklist']>,
  ): EdiTradingPartner {
    const st = getState(tenantId);
    const tp = st.tradingPartners.find((p) => p.id === partnerId);
    if (!tp) {
      throw new AppError({ message: 'Trading partner not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    tp.checklist = { ...tp.checklist, ...patch };
    return tp;
  },

  async approveTradingPartnerGoLive(
    ctx: FhirRequestContext,
    partnerId: string,
    actor: { name: string; role: RoleName },
  ): Promise<EdiTradingPartner> {
    const st = getState(ctx.tenantId);
    const tp = st.tradingPartners.find((p) => p.id === partnerId);
    if (!tp) {
      throw new AppError({ message: 'Trading partner not found.', statusCode: 404, code: 'NOT_FOUND' });
    }
    const c = tp.checklist;
    if (!c.envelopeTested || !c.ack999Passed || !c.ack277CaPassed || !c.securityVerified) {
      throw new AppError({
        message: 'Complete all 4 EDI readiness checklist items before Go-Live approval.',
        statusCode: 400,
        code: 'CHECKLIST_INCOMPLETE',
      });
    }

    const client = getFhirClient();
    const ep: FhirEndpoint = {
      resourceType: 'Endpoint',
      status: 'active',
      connectionType: {
        system: 'http://providerlink.local/CodeSystem/edi-connectivity',
        code: tp.connectivity.toLowerCase(),
        display: `X12 EDI (${tp.connectivity})`,
      },
      name: `${tp.name} (${tp.tradingPartnerId})`,
      payloadType: tp.transactions.map((tx) => ({
        coding: [{ system: 'http://x12.org/transactions', code: tx, display: `X12 ${tx}` }],
      })),
      address: tp.endpointAddress,
    };
    const createdEp = await client.create(ctx, ep);

    tp.status = 'Live';
    tp.endpointResourceId = createdEp.id;
    tp.goLiveAt = new Date().toISOString();

    await auditService.record({
      ctx,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'create',
      resourceType: 'Endpoint',
      resourceId: createdEp.id,
      outcomeDesc: `Approved EDI Trading Partner ${tp.tradingPartnerId} Go-Live (Endpoint/${createdEp.id})`,
    });

    return tp;
  },

  /**
   * Simulates X12 syntax validation and generates both 999 Implementation Ack and 277CA Claim Ack.
   */
  runEdiTestConsole(tenantId: string, rawX12: string): EdiTestResult {
    const segments = rawX12
      .split(/~|\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const errors: string[] = [];

    const hasIsa = segments.some((s) => s.startsWith('ISA*'));
    const hasGs = segments.some((s) => s.startsWith('GS*'));
    const stSeg = segments.find((s) => s.startsWith('ST*'));
    const hasSe = segments.some((s) => s.startsWith('SE*'));
    const hasGe = segments.some((s) => s.startsWith('GE*'));
    const hasIea = segments.some((s) => s.startsWith('IEA*'));

    if (!hasIsa) errors.push('Missing ISA interchange control header.');
    if (!hasGs) errors.push('Missing GS functional group header.');
    if (!stSeg) errors.push('Missing ST transaction set header.');
    if (!hasSe) errors.push('Missing SE transaction set trailer.');
    if (!hasGe) errors.push('Missing GE functional group trailer.');
    if (!hasIea) errors.push('Missing IEA interchange control trailer.');

    const txCode = stSeg?.split('*')[1] ?? '837';
    const clmSeg = segments.find((s) => s.startsWith('CLM*'));
    const clmId = clmSeg?.split('*')[1] ?? 'CLM-UNKNOWN';
    const clmAmt = clmSeg?.split('*')[2] ?? '0.00';
    const valid = errors.length === 0;
    const todayCompact = new Date().toISOString().slice(0, 10).replaceAll('-', '');

    const ack999 = [
      `ISA*00*          *00*          *ZZ*MMISACK01      *ZZ*SUBMITTER      *${todayCompact.slice(2)}*1201*^*00501*000000999*0*T*:~`,
      `GS*FA*MMISACK01*SUBMITTER*${todayCompact}*1201*999*X*005010X231A1~`,
      'ST*999*0001*005010X231A1~',
      `AK1*HC*1*005010X222A1~`,
      `AK2*${txCode}*0001~`,
      ...(valid ? [] : errors.map((e, idx) => `IK3*SEG*${idx + 1}**8*${e.slice(0, 40)}~`)),
      `IK5*${valid ? 'A' : 'R'}~`,
      `AK9*${valid ? 'A' : 'R'}*1*1*${valid ? '1' : '0'}~`,
      'SE*7*0001~',
      'GE*1*999~',
      'IEA*1*000000999~',
    ].join('\n');

    const ack277Ca = [
      `ST*277*0002*005010X214~`,
      `BHT*0085*08*277CA-${todayCompact}*${todayCompact}*1201*TH~`,
      `TRN*2*${clmId}~`,
      valid
        ? `STC*A1:19:PR*${todayCompact}*WQ*${clmAmt}~`
        : `STC*A7:128:PR*${todayCompact}*U*${clmAmt}~`,
      `REF*1K*MMIS-${clmId}~`,
      'SE*6*0002~',
    ].join('\n');

    const res: EdiTestResult = {
      id: `editest-${Date.now().toString(36)}`,
      testedAt: new Date().toISOString(),
      transactionType: txCode,
      valid,
      errors,
      ack999,
      ack277Ca,
    };
    const st = getState(tenantId);
    st.ediTests.unshift(res);
    return res;
  },
};

// Auto-register platform event listeners on module load
mmisEdiService.ensureEventSubscriptions();
