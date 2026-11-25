import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Play,
  RefreshCw,
  Send,
  Terminal,
} from 'lucide-react';
import { Guard, useAuth } from '../../app';
import {
  Button,
  Input,
  Modal,
  PageHeader,
  Select,
  SemanticStatus,
  Tabs,
  TextArea,
  useToast,
  type SemanticTone,
} from '../../components';
import { useTenantContext } from '../../tenancy';
import {
  providerService,
  type ProviderDirectoryRow,
} from '../m3-directory/providerService';
import {
  SAMPLE_X12_837P,
  mmisEdiService,
  type EdiTestResult,
  type EdiTransactionCode,
  type MmisLoadStatus,
  type MmisReconciliationRow,
} from './mmisEdiService';

const ALL_EDI_TX: EdiTransactionCode[] = ['837P', '837I', '835', '270/271', '276/277', '278'];

function loadTone(status: MmisLoadStatus): SemanticTone {
  if (status === 'Acknowledged') return 'success';
  if (status === 'Rejected') return 'danger';
  if (status === 'Sent') return 'info';
  return 'warning';
}

export function MmisEdiPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'loads' | 'reconcile' | 'partners' | 'console'>('loads');
  const [providers, setProviders] = useState<ProviderDirectoryRow[]>([]);
  const [reconRows, setReconRows] = useState<MmisReconciliationRow[]>([]);
  const [tick, setTick] = useState(0);

  const state = mmisEdiService.getState(activeTenant.id);

  // Queue manual load
  const [selectedProvId, setSelectedProvId] = useState('');
  const [payloadModal, setPayloadModal] = useState<{ title: string; json: string; fixed: string } | null>(null);

  // EDI partner wizard
  const [tpId, setTpId] = useState('TP-MED-2026');
  const [tpName, setTpName] = useState('');
  const [submitterId, setSubmitterId] = useState('SUB202601');
  const [receiverId, setReceiverId] = useState('STMMIS01');
  const [connectivity, setConnectivity] = useState<'Portal' | 'SFTP' | 'API'>('API');
  const [endpointAddress, setEndpointAddress] = useState('https://edi.synthetic.example/x12');
  const [selectedTx, setSelectedTx] = useState<EdiTransactionCode[]>(['837P', '835', '270/271']);

  // EDI test console
  const [x12Input, setX12Input] = useState(SAMPLE_X12_837P);
  const [lastEdiTest, setLastEdiTest] = useState<EdiTestResult | null>(null);

  const loadData = async () => {
    const [provs, recon] = await Promise.all([
      providerService.listProviders(fhirContext),
      mmisEdiService.computeReconciliation(fhirContext),
    ]);
    setProviders(provs);
    setReconRows(recon);
    if (!selectedProvId && provs[0]) {
      setSelectedProvId(provs[0].id);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id, fhirContext, tick]);

  const handleQueueLoad = () => {
    const prov = providers.find((p) => p.id === selectedProvId);
    if (!prov) return;
    mmisEdiService.queueMmisLoad(activeTenant.id, {
      practitionerId: prov.id,
      providerName: prov.fullName,
      npi: prov.npi,
      existingMedicaidId: prov.medicaidId || undefined,
      action: 'InitialLoad',
      providerStatus: prov.status,
      effectiveDate: new Date().toISOString().slice(0, 10),
    });
    setTick((t) => t + 1);
    showToast(`Queued MMIS load for ${prov.fullName}.`, 'success');
  };

  const handleSendLoad = async (loadId: string, forceOutcome?: 'Acknowledged' | 'Rejected') => {
    try {
      const updated = await mmisEdiService.sendMmisLoad(
        fhirContext,
        loadId,
        { name: user.name, role: user.role },
        forceOutcome ? { forceOutcome } : undefined,
      );
      setTick((t) => t + 1);
      if (updated.fallbackWarning) {
        showToast(updated.fallbackWarning, 'warning');
      }
      showToast(
        `MMIS load ${updated.medicaidId}: ${updated.status}`,
        updated.status === 'Acknowledged' ? 'success' : 'error',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'MMIS send failed.', 'error');
    }
  };

  const handleFixInFhir = async (loadId: string) => {
    try {
      await mmisEdiService.fixMismatchInFhir(fhirContext, loadId, { name: user.name, role: user.role });
      setTick((t) => t + 1);
      showToast('Updated FHIR Practitioner to match MMIS Medicaid ID.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to update FHIR.', 'error');
    }
  };

  const handleResend = (row: MmisReconciliationRow) => {
    mmisEdiService.queueMmisLoad(activeTenant.id, {
      practitionerId: row.practitionerId,
      providerName: row.providerName,
      npi: row.npi,
      existingMedicaidId: row.fhirMedicaidId || row.mmisMedicaidId,
      action: 'ReconciliationResend',
      providerStatus: row.fhirStatus === 'Missing' ? row.mmisStatus : row.fhirStatus,
      effectiveDate: new Date().toISOString().slice(0, 10),
    });
    setTick((t) => t + 1);
    setTab('loads');
    showToast(`Re-queued MMIS load for ${row.providerName}.`, 'info');
  };

  const handleCreatePartner = () => {
    try {
      mmisEdiService.createTradingPartner(activeTenant.id, {
        tradingPartnerId: tpId,
        name: tpName || `${tpId} Clearinghouse`,
        submitterId,
        receiverId,
        transactions: selectedTx,
        connectivity,
        endpointAddress,
      });
      setTpName('');
      setTick((t) => t + 1);
      showToast(`Created EDI trading partner ${tpId} in Testing status.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to create partner.', 'error');
    }
  };

  const handleGoLive = async (partnerId: string) => {
    try {
      const tp = await mmisEdiService.approveTradingPartnerGoLive(
        fhirContext,
        partnerId,
        { name: user.name, role: user.role },
      );
      setTick((t) => t + 1);
      showToast(`EDI partner ${tp.tradingPartnerId} is now Live (Endpoint/${tp.endpointResourceId}).`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Go-live approval failed.', 'error');
    }
  };

  const handleRunEdiTest = () => {
    const result = mmisEdiService.runEdiTestConsole(activeTenant.id, x12Input);
    setLastEdiTest(result);
    setTick((t) => t + 1);
    showToast(
      result.valid ? 'X12 syntax passed — 999 & 277CA generated.' : `X12 validation failed (${result.errors.length} error(s)).`,
      result.valid ? 'success' : 'error',
    );
  };

  const mismatchCount = reconRows.filter((r) => r.mismatches.length > 0).length;

  return (
    <Guard moduleId="m10-mmis-edi" action="view">
      <div className="space-y-6" data-tick={tick}>
        <PageHeader
          kicker="M10 · MMIS & EDI Setup"
          title="MMIS Load & EDI Trading Partner Setup"
          description="Automated Medicaid ID assignment on ProviderApproved, Mock/Gateway MMIS load queue with JSON & fixed-width exports, FHIR reconciliation, EDI partner onboarding, and 999/277CA test console."
        />

        {/* Adapter & Format Controls */}
        <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-3">
          <Input
            label="Medicaid ID Format Prefix"
            value={state.medicaidIdPrefix}
            onChange={(e) => {
              mmisEdiService.setConfig(activeTenant.id, { medicaidIdPrefix: e.target.value });
              setTick((t) => t + 1);
            }}
          />
          <Select
            label="MMIS Adapter Mode"
            value={state.adapterMode}
            onChange={(e) => {
              mmisEdiService.setConfig(activeTenant.id, { adapterMode: e.target.value as 'Mock' | 'Gateway' });
              setTick((t) => t + 1);
            }}
            options={[
              { value: 'Mock', label: 'Mock Adapter (JSON + Fixed-Width, 5% simulated reject)' },
              { value: 'Gateway', label: '.NET Gateway (POST /api/v1/mmis/loads + fallback)' },
            ]}
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Select
                label="Queue Provider for MMIS"
                value={selectedProvId}
                onChange={(e) => setSelectedProvId(e.target.value)}
                options={providers.map((p) => ({ value: p.id, label: `${p.fullName} (${p.status})` }))}
              />
            </div>
            <Button onClick={handleQueueLoad}>Queue</Button>
          </div>
        </div>

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'loads', label: `MMIS Load Queue (${state.loads.length})` },
            { id: 'reconcile', label: `FHIR Reconciliation (${mismatchCount} mismatches)` },
            { id: 'partners', label: `EDI Trading Partners (${state.tradingPartners.length})` },
            { id: 'console', label: 'EDI Test Console (999 / 277CA)' },
          ]}
        />

        {tab === 'loads' && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Medicaid ID</th>
                  <th className="px-4 py-3">Provider / NPI</th>
                  <th className="px-4 py-3">Action / Status</th>
                  <th className="px-4 py-3">MMIS Queue State</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {state.loads.map((rec) => (
                  <tr key={rec.id}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {rec.medicaidId}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{rec.providerName}</div>
                      <div className="font-mono text-xs text-slate-500 dark:text-slate-400">NPI {rec.npi}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      <div>{rec.action}</div>
                      <div className="text-slate-400">Target: {rec.providerStatus}</div>
                    </td>
                    <td className="px-4 py-3">
                      <SemanticStatus tone={loadTone(rec.status)} label={rec.status} />
                      {rec.rejectionReason && (
                        <div className="mt-1 text-xs text-red-600 dark:text-red-400">{rec.rejectionReason}</div>
                      )}
                      {rec.fallbackWarning && (
                        <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">{rec.fallbackWarning}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {(rec.status === 'Queued' || rec.status === 'Rejected') && (
                          <Button size="sm" onClick={() => void handleSendLoad(rec.id)}>
                            <Send className="h-3.5 w-3.5" />
                            Transmit
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setPayloadModal({
                              title: `MMIS Export — ${rec.medicaidId}`,
                              json: rec.jsonPayload,
                              fixed: rec.fixedWidthPayload,
                            })
                          }
                        >
                          JSON / Fixed-Width
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'reconcile' && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">MMIS Record</th>
                  <th className="px-4 py-3">FHIR Record (M3)</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Remediation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {reconRows.map((row) => (
                  <tr key={row.loadId}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{row.providerName}</div>
                      <div className="font-mono text-xs text-slate-500">NPI {row.npi}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-mono">{row.mmisMedicaidId}</div>
                      <div className="text-slate-500">{row.mmisStatus}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-mono">{row.fhirMedicaidId || '—'}</div>
                      <div className="text-slate-500">{row.fhirStatus}</div>
                    </td>
                    <td className="px-4 py-3">
                      {row.mismatches.length === 0 ? (
                        <SemanticStatus tone="success" label="Synchronized" />
                      ) : (
                        <div>
                          <SemanticStatus tone="danger" label={`${row.mismatches.length} Mismatch`} />
                          <ul className="mt-1 text-xs text-red-600 dark:text-red-400">
                            {row.mismatches.map((m) => (
                              <li key={m}>• {m}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.mismatches.length > 0 && (
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => void handleFixInFhir(row.loadId)}>
                            <Database className="h-3.5 w-3.5" />
                            Fix in FHIR
                          </Button>
                          <Button size="sm" onClick={() => handleResend(row)}>
                            <RefreshCw className="h-3.5 w-3.5" />
                            Resend MMIS
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'partners' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Onboard EDI Trading Partner
              </h2>
              <Input label="Trading Partner ID" value={tpId} onChange={(e) => setTpId(e.target.value)} />
              <Input
                label="Organization / Clearinghouse Name"
                value={tpName}
                onChange={(e) => setTpName(e.target.value)}
                placeholder="e.g., Empire Clearinghouse LLC"
              />
              <div className="grid grid-cols-2 gap-3">
                <Input label="ISA/GS Submitter ID" value={submitterId} onChange={(e) => setSubmitterId(e.target.value)} />
                <Input label="ISA/GS Receiver ID" value={receiverId} onChange={(e) => setReceiverId(e.target.value)} />
              </div>
              <Select
                label="Connectivity Transport"
                value={connectivity}
                onChange={(e) => setConnectivity(e.target.value as 'Portal' | 'SFTP' | 'API')}
                options={[
                  { value: 'API', label: 'REST / FHIR API' },
                  { value: 'SFTP', label: 'SFTP Batch Exchange' },
                  { value: 'Portal', label: 'Web EDI Portal' },
                ]}
              />
              <Input
                label="Endpoint URL / SFTP URI"
                value={endpointAddress}
                onChange={(e) => setEndpointAddress(e.target.value)}
              />
              <div>
                <div className="mb-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                  X12 Transactions
                </div>
                <div className="flex flex-wrap gap-2">
                  {ALL_EDI_TX.map((tx) => {
                    const checked = selectedTx.includes(tx);
                    return (
                      <label
                        key={tx}
                        className="flex cursor-pointer items-center gap-1.5 rounded border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedTx((prev) =>
                              checked ? prev.filter((x) => x !== tx) : [...prev, tx],
                            )
                          }
                        />
                        {tx}
                      </label>
                    );
                  })}
                </div>
              </div>
              <Button className="w-full" onClick={handleCreatePartner}>
                Create Trading Partner
              </Button>
            </div>

            <div className="space-y-4 lg:col-span-7">
              {state.tradingPartners.map((tp) => (
                <div
                  key={tp.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {tp.name} <span className="font-mono text-xs text-slate-500">({tp.tradingPartnerId})</span>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {tp.connectivity} · {tp.endpointAddress} · Submitter {tp.submitterId} → {tp.receiverId}
                      </div>
                      <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        Transactions: {tp.transactions.join(', ')}
                      </div>
                    </div>
                    <SemanticStatus tone={tp.status === 'Live' ? 'success' : 'warning'} label={tp.status} />
                  </div>

                  {tp.status === 'Testing' ? (
                    <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {(
                          [
                            ['envelopeTested', 'ISA/GS Envelope Validated'],
                            ['ack999Passed', '999 Implementation Ack Passed'],
                            ['ack277CaPassed', '277CA Claim Ack Passed'],
                            ['securityVerified', 'TLS / Auth Handshake Verified'],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={tp.checklist[key]}
                              onChange={(e) => {
                                mmisEdiService.updatePartnerChecklist(activeTenant.id, tp.id, {
                                  [key]: e.target.checked,
                                });
                                setTick((t) => t + 1);
                              }}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <Button size="sm" className="mt-3" onClick={() => void handleGoLive(tp.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approve Go-Live (Create FHIR Endpoint)
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                      Live since {tp.goLiveAt?.slice(0, 10)} {tp.endpointResourceId ? `· FHIR Endpoint/${tp.endpointResourceId}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'console' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                  <Terminal className="h-4 w-4" />
                  X12 EDI Payload Input
                </h2>
                <Button size="sm" variant="secondary" onClick={() => setX12Input(SAMPLE_X12_837P)}>
                  Load 837P Sample
                </Button>
              </div>
              <TextArea
                label="Raw X12 Interchange"
                rows={12}
                value={x12Input}
                onChange={(e) => setX12Input(e.target.value)}
                className="font-mono text-xs"
              />
              <Button onClick={handleRunEdiTest}>
                <Play className="h-4 w-4" />
                Validate Syntax & Generate 999 / 277CA
              </Button>
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Acknowledgements Output
              </h2>
              {lastEdiTest ? (
                <>
                  <div className="flex items-center gap-2">
                    <SemanticStatus
                      tone={lastEdiTest.valid ? 'success' : 'danger'}
                      label={lastEdiTest.valid ? `X12 ${lastEdiTest.transactionType} Accepted` : 'Syntax Rejected'}
                    />
                  </div>
                  {lastEdiTest.errors.length > 0 && (
                    <ul className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                      {lastEdiTest.errors.map((e) => (
                        <li key={e}>• {e}</li>
                      ))}
                    </ul>
                  )}
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">999 Implementation Acknowledgement</div>
                    <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-3 font-mono text-xs dark:bg-slate-950">
                      {lastEdiTest.ack999}
                    </pre>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">277CA Claim Acknowledgement</div>
                    <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-3 font-mono text-xs dark:bg-slate-950">
                      {lastEdiTest.ack277Ca}
                    </pre>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Run the syntax validator to produce simulated X12 999 and 277CA acknowledgements.
                </p>
              )}
            </div>
          </div>
        )}

        <Modal
          open={Boolean(payloadModal)}
          onClose={() => setPayloadModal(null)}
          title={payloadModal?.title ?? 'MMIS Payload'}
        >
          {payloadModal && (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">JSON Payload</div>
                <pre className="mt-1 max-h-60 overflow-auto rounded bg-slate-50 p-3 font-mono text-xs dark:bg-slate-950">
                  {payloadModal.json}
                </pre>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">Fixed-Width Flat File Record</div>
                <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-3 font-mono text-xs dark:bg-slate-950">
                  {payloadModal.fixed}
                </pre>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </Guard>
  );
}
