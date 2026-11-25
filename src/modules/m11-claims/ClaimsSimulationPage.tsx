import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  LifeBuoy,
  Receipt,
  Send,
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
  patientService,
  type PatientSummaryRow,
} from '../m4-patients/patientService';
import { planService } from '../m23-plans/planService';
import {
  claimsService,
  type ClaimDecision,
  type ClaimRecord,
} from './claimsService';

function decisionTone(dec: ClaimDecision): SemanticTone {
  if (dec === 'Paid') return 'success';
  if (dec === 'Denied') return 'danger';
  return 'warning';
}

export function ClaimsSimulationPage() {
  const { activeTenant, fhirContext } = useTenantContext();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'submit' | 'claims' | 'pa' | 'tickets' | 'dashboard'>('submit');
  const [patients, setPatients] = useState<PatientSummaryRow[]>([]);
  const [providers, setProviders] = useState<ProviderDirectoryRow[]>([]);
  const [tick, setTick] = useState(0);

  const planState = planService.getState(fhirContext);
  const state = claimsService.getState(activeTenant.id);
  const metrics = claimsService.getDashboardMetrics(activeTenant.id);

  // Claim submission inputs
  const [patientId, setPatientId] = useState('');
  const [renderingId, setRenderingId] = useState('');
  const [billingId, setBillingId] = useState('');
  const [planId, setPlanId] = useState(planState.plans[0]?.id ?? '');
  const [cptCode, setCptCode] = useState('99214');
  const [modifier, setModifier] = useState('');
  const [diagnosisCode, setDiagnosisCode] = useState('I10');
  const [units, setUnits] = useState(1);
  const [billedUsd, setBilledUsd] = useState(150);
  const [dos, setDos] = useState('2026-03-10');
  const [priorAuthNumber, setPriorAuthNumber] = useState('');
  const [selectedClaim, setSelectedClaim] = useState<ClaimRecord | null>(null);

  // Prior Auth form
  const [paCode, setPaCode] = useState('70551');
  const [paNotes, setPaNotes] = useState('Documented neurological symptoms > 6 weeks.');

  // Help desk ticket form
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDesc, setTicketDesc] = useState('');
  const [ticketCategory, setTicketCategory] = useState<
    'Claim Denial Inquiry' | 'EDI / ERA Remittance' | 'Prior Auth' | 'Enrollment / Network'
  >('Claim Denial Inquiry');

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      patientService.listPatients(fhirContext),
      providerService.listProviders(fhirContext),
    ]).then(([pats, provs]) => {
      if (!mounted) return;
      setPatients(pats);
      setProviders(provs);
      setPatientId(pats[0]?.id ?? '');
      setRenderingId(provs[0]?.id ?? '');
      setBillingId(provs[0]?.id ?? '');
    });
    const ps = planService.getState(fhirContext);
    setPlanId(ps.plans[0]?.id ?? '');
    return () => {
      mounted = false;
    };
  }, [activeTenant.id, fhirContext]);

  const handleSubmitClaim = async () => {
    const pat = patients.find((p) => p.id === patientId);
    try {
      const result = await claimsService.submitAndAdjudicateClaim(
        fhirContext,
        {
          patientId,
          patientName: pat?.fullName ?? patientId,
          billingProviderId: billingId || renderingId,
          renderingProviderId: renderingId,
          planId,
          priorAuthNumber: priorAuthNumber || undefined,
          lines: [
            {
              code: cptCode,
              modifier,
              diagnosisCode,
              units,
              billedUsd,
              dateOfService: dos,
            },
          ],
        },
        { name: user.name, role: user.role },
      );
      setSelectedClaim(result);
      setTick((t) => t + 1);
      showToast(
        `${result.claimNumber}: ${result.decision}${result.denialCode ? ` (${result.denialCode})` : ` — Paid $${result.totalPaidUsd.toFixed(2)}`}`,
        result.decision === 'Paid' ? 'success' : result.decision === 'Denied' ? 'error' : 'warning',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Claim submission failed.', 'error');
    }
  };

  const handleCreatePa = () => {
    const pat = patients.find((p) => p.id === patientId);
    const prov = providers.find((p) => p.id === renderingId);
    const plan = planState.plans.find((p) => p.id === planId);
    claimsService.submitPriorAuth(activeTenant.id, {
      patientId,
      patientName: pat?.fullName ?? patientId,
      providerId: renderingId,
      providerName: prov?.fullName ?? renderingId,
      planId,
      planName: plan?.name ?? planId,
      procedureCode: paCode,
      clinicalNotes: paNotes,
    });
    setTick((t) => t + 1);
    showToast('Prior Authorization request submitted.', 'success');
  };

  const handleCreateTicket = () => {
    if (!ticketSubject.trim()) return;
    const prov = providers.find((p) => p.id === renderingId);
    claimsService.createHelpDeskTicket(activeTenant.id, {
      providerId: renderingId,
      providerName: prov?.fullName ?? 'Provider',
      category: ticketCategory,
      subject: ticketSubject.trim(),
      description: ticketDesc.trim() || ticketSubject.trim(),
    });
    setTicketSubject('');
    setTicketDesc('');
    setTick((t) => t + 1);
    showToast('Help desk ticket created.', 'success');
  };

  return (
    <Guard moduleId="m11-claims" action="view">
      <div className="space-y-6" data-tick={tick}>
        <PageHeader
          kicker="M11 · Claims Simulation"
          title="Claims & Operations Simulation"
          description="6-stage FHIR Claim adjudication pipeline validating M23 Coverage eligibility, M3 Active provider enrollment, network participation, Prior Authorization, and M23 fee schedules."
        />

        {/* KPI Strip */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Adjudicated Claims</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {metrics.totalClaims}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {metrics.paidCount} Paid · {metrics.deniedCount} Denied · {metrics.pendedCount} Pended
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Paid (ERA 835)</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              ${metrics.totalPaidUsd.toFixed(2)}
            </div>
            <div className="mt-1 text-xs text-slate-500">Billed: ${metrics.totalBilledUsd.toFixed(2)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Avg Days to Pay</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {metrics.averageDaysToPay} d
            </div>
            <div className="mt-1 text-xs text-slate-500">Target &le; 14 days</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Open PA / Help Desk</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {state.priorAuths.filter((p) => p.status === 'Pending').length} /{' '}
              {state.tickets.filter((t) => t.status !== 'Resolved').length}
            </div>
            <div className="mt-1 text-xs text-slate-500">Pending PA · Open Tickets</div>
          </div>
        </div>

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'submit', label: 'Submit & Adjudicate Claim' },
            { id: 'claims', label: `Claims & Remittance (${state.claims.length})` },
            { id: 'pa', label: `Prior Authorization (${state.priorAuths.length})` },
            { id: 'tickets', label: `Provider Help Desk (${state.tickets.length})` },
            { id: 'dashboard', label: 'Operations Dashboard' },
          ]}
        />

        {tab === 'submit' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <Receipt className="h-4 w-4" />
                Submit Professional Claim (FHIR Claim)
              </h2>

              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Member / Patient (M4)"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  options={patients.map((p) => ({ value: p.id, label: `${p.fullName} (${p.mrn})` }))}
                />
                <Select
                  label="Health Plan (M23)"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  options={planState.plans.map((p) => ({ value: p.id, label: `${p.planCode} — ${p.name}` }))}
                />
                <Select
                  label="Rendering Provider (M3)"
                  value={renderingId}
                  onChange={(e) => {
                    setRenderingId(e.target.value);
                    setBillingId(e.target.value);
                  }}
                  options={providers.map((p) => ({
                    value: p.id,
                    label: `${p.fullName} [${p.status}]`,
                  }))}
                />
                <Select
                  label="Billing Provider (M3)"
                  value={billingId}
                  onChange={(e) => setBillingId(e.target.value)}
                  options={providers.map((p) => ({
                    value: p.id,
                    label: `${p.fullName} [${p.status}]`,
                  }))}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Select
                  label="CPT / HCPCS Code"
                  value={cptCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    setCptCode(code);
                    setModifier(code === '70551' ? '26' : '');
                  }}
                  options={[
                    { value: '99213', label: '99213 — Est. Visit Low ($92.50)' },
                    { value: '99214', label: '99214 — Est. Visit Mod ($131.75)' },
                    { value: '99203', label: '99203 — New Patient ($114.00)' },
                    { value: '87635', label: '87635 — SARS-CoV-2 PCR ($51.31)' },
                    { value: '90834', label: '90834 — Psychotherapy ($108.40)' },
                    { value: '70551', label: '70551 — MRI Brain (PA Req, $245)' },
                  ]}
                />
                <Input label="Modifier" value={modifier} onChange={(e) => setModifier(e.target.value)} placeholder="e.g., 26" />
                <Input label="ICD-10 Diagnosis" value={diagnosisCode} onChange={(e) => setDiagnosisCode(e.target.value)} />
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <Input label="Date of Service" type="date" value={dos} onChange={(e) => setDos(e.target.value)} />
                <Input label="Units" type="number" min={1} value={units} onChange={(e) => setUnits(Number(e.target.value))} />
                <Input label="Billed ($)" type="number" min={1} value={billedUsd} onChange={(e) => setBilledUsd(Number(e.target.value))} />
                <Input label="Prior Auth #" value={priorAuthNumber} onChange={(e) => setPriorAuthNumber(e.target.value)} placeholder="Optional" />
              </div>

              <Button className="w-full" onClick={() => void handleSubmitClaim()}>
                <Send className="h-4 w-4" />
                Submit & Run 6-Stage Adjudication Pipeline
              </Button>
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Pipeline Execution Trace & ClaimResponse
              </h2>
              {selectedClaim ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {selectedClaim.claimNumber} · {selectedClaim.patientName}
                      </div>
                      <div className="text-xs text-slate-500">
                        Claim/{selectedClaim.fhirClaimId} · ClaimResponse/{selectedClaim.fhirClaimResponseId}
                      </div>
                    </div>
                    <SemanticStatus
                      tone={decisionTone(selectedClaim.decision)}
                      label={
                        selectedClaim.denialCode
                          ? `${selectedClaim.decision} (${selectedClaim.denialCode})`
                          : `${selectedClaim.decision} $${selectedClaim.totalPaidUsd.toFixed(2)}`
                      }
                    />
                  </div>

                  <ol className="space-y-2 text-xs">
                    {selectedClaim.pipelineTrace.map((step) => (
                      <li
                        key={step.stage}
                        className="rounded border border-slate-200 p-2.5 dark:border-slate-800"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{step.stage}</span>
                          <SemanticStatus
                            tone={step.status === 'Pass' ? 'success' : step.status === 'Fail' ? 'danger' : 'warning'}
                            label={step.code ? `${step.status}: ${step.code}` : step.status}
                          />
                        </div>
                        <p className="mt-1 text-slate-600 dark:text-slate-300">{step.detail}</p>
                      </li>
                    ))}
                  </ol>

                  {selectedClaim.remittanceSummary && (
                    <div className="rounded border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                      <div className="font-semibold">Remittance Advice (PaymentReconciliation)</div>
                      <div className="mt-1 font-mono">{selectedClaim.remittanceSummary}</div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Submit a claim on the left to inspect all 6 adjudication stages, FHIR ClaimResponse, and ERA remittance advice.
                </p>
              )}
            </div>
          </div>
        )}

        {tab === 'claims' && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Claim #</th>
                  <th className="px-4 py-3">Patient / Provider</th>
                  <th className="px-4 py-3">Plan / DOS</th>
                  <th className="px-4 py-3 text-right">Billed / Paid</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {state.claims.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      No claims submitted yet for this tenant.
                    </td>
                  </tr>
                ) : (
                  state.claims.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-3 font-mono text-xs font-semibold">{c.claimNumber}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-medium text-slate-900 dark:text-slate-100">{c.patientName}</div>
                        <div className="text-slate-500">{c.renderingProviderName}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div>{c.planName}</div>
                        <div className="tabular-nums text-slate-500">{c.dateOfService}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        <div>${c.totalBilledUsd.toFixed(2)}</div>
                        <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                          ${c.totalPaidUsd.toFixed(2)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <SemanticStatus
                          tone={decisionTone(c.decision)}
                          label={c.denialCode ? `${c.decision} · ${c.denialCode}` : c.decision}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setSelectedClaim(c);
                            setTab('submit');
                          }}
                        >
                          Trace / ERA
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'pa' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <ClipboardCheck className="h-4 w-4" />
                Request Prior Authorization
              </h2>
              <Input label="Procedure Code (CPT)" value={paCode} onChange={(e) => setPaCode(e.target.value)} />
              <TextArea label="Clinical Justification" rows={3} value={paNotes} onChange={(e) => setPaNotes(e.target.value)} />
              <Button className="w-full" onClick={handleCreatePa}>
                Submit PA Request
              </Button>
            </div>
            <div className="space-y-3 lg:col-span-7">
              {state.priorAuths.map((pa) => (
                <div
                  key={pa.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {pa.authNumber} — CPT {pa.procedureCode} ({pa.patientName})
                    </div>
                    <div className="text-xs text-slate-500">
                      {pa.providerName} · {pa.planName}
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{pa.clinicalNotes}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <SemanticStatus
                      tone={pa.status === 'Approved' ? 'success' : pa.status === 'Denied' ? 'danger' : 'warning'}
                      label={pa.status}
                    />
                    {pa.status === 'Pending' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => {
                            claimsService.decidePriorAuth(activeTenant.id, pa.id, 'Approved', `${user.name} (${user.role})`);
                            setTick((t) => t + 1);
                            showToast(`Prior Auth ${pa.authNumber} approved.`, 'success');
                          }}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            claimsService.decidePriorAuth(activeTenant.id, pa.id, 'Denied', `${user.name} (${user.role})`);
                            setTick((t) => t + 1);
                          }}
                        >
                          Deny
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'tickets' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <LifeBuoy className="h-4 w-4" />
                Log Provider Help Desk Ticket
              </h2>
              <Select
                label="Category"
                value={ticketCategory}
                onChange={(e) => setTicketCategory(e.target.value as typeof ticketCategory)}
                options={[
                  { value: 'Claim Denial Inquiry', label: 'Claim Denial Inquiry' },
                  { value: 'EDI / ERA Remittance', label: 'EDI / ERA Remittance' },
                  { value: 'Prior Auth', label: 'Prior Auth' },
                  { value: 'Enrollment / Network', label: 'Enrollment / Network' },
                ]}
              />
              <Input label="Subject" value={ticketSubject} onChange={(e) => setTicketSubject(e.target.value)} />
              <TextArea label="Description" rows={3} value={ticketDesc} onChange={(e) => setTicketDesc(e.target.value)} />
              <Button className="w-full" onClick={handleCreateTicket}>
                Open Ticket
              </Button>
            </div>
            <div className="space-y-3 lg:col-span-7">
              {state.tickets.map((tkt) => (
                <div
                  key={tkt.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {tkt.ticketNumber}: {tkt.subject}
                    </div>
                    <div className="text-xs text-slate-500">
                      {tkt.providerName} · {tkt.category}
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{tkt.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <SemanticStatus tone={tkt.status === 'Resolved' ? 'success' : 'warning'} label={tkt.status} />
                    {tkt.status !== 'Resolved' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          claimsService.resolveHelpDeskTicket(activeTenant.id, tkt.id, `Resolved by ${user.name}.`);
                          setTick((t) => t + 1);
                        }}
                      >
                        Resolve
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'dashboard' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <DollarSign className="h-4 w-4" />
                Denial & Pend Pareto Analysis
              </h2>
              {metrics.denialPareto.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No denials or pends recorded yet.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {metrics.denialPareto.map((row) => (
                    <div key={row.code}>
                      <div className="flex justify-between text-xs font-medium">
                        <span className="font-mono text-slate-800 dark:text-slate-200">{row.code}</span>
                        <span className="tabular-nums text-slate-600 dark:text-slate-400">
                          {row.count} ({row.pct}%)
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-full rounded-full bg-rose-600" style={{ width: `${row.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Claims Outcomes Summary
              </h2>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between border-b border-slate-100 py-2 dark:border-slate-800">
                  <span>Paid Claims</span>
                  <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {metrics.paidCount}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-100 py-2 dark:border-slate-800">
                  <span>Denied Claims</span>
                  <span className="font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                    {metrics.deniedCount}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-100 py-2 dark:border-slate-800">
                  <span>Pended Claims</span>
                  <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                    {metrics.pendedCount}
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span>Average Days to Pay</span>
                  <span className="font-semibold tabular-nums">{metrics.averageDaysToPay} days</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <Modal open={false} onClose={() => undefined} title="Detail">
          <div />
        </Modal>
      </div>
    </Guard>
  );
}
