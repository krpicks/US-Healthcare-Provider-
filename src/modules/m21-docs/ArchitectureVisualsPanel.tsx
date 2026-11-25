import { useState } from 'react';
import { Download, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button, SemanticStatus } from '../../components';
import {
  API_BUSINESS_CATALOGUE,
  ARB_RISK_REGISTER,
  ARB_SCORECARD,
  ARD_REQUIREMENTS,
  DB_ENTITY_CATALOGUE,
  STRIDE_THREAT_MODEL,
} from './architectureDiagramsData';

interface ArchitectureVisualsPanelProps {
  onDownloadPdf: () => void;
}

export function ArchitectureVisualsPanel({
  onDownloadPdf,
}: ArchitectureVisualsPanelProps) {
  const [section, setSection] = useState<'diagrams' | 'db-api' | 'ard-arb'>('diagrams');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/30">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Complete User Manual, Diagrams, API, ARD &amp; ARB PDF Pack
          </h2>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
            Includes vector Business Flow Diagrams, Sequence Diagrams, Database / FHIR ER Diagram, API Business Details, Architecture Requirements Document (ARD), Architecture Review Board (ARB) Scorecard, STRIDE Threat Model, Risk Register, RBAC Matrix &amp; QA Evidence.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onDownloadPdf}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download Complete PDF
          </Button>
          <a
            href="/docs/ProviderLink_User_Manual_Diagrams_ARD_ARB.pdf"
            download="ProviderLink_User_Manual_Diagrams_ARD_ARB.pdf"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Static PDF File
          </a>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Manual and ARB sub-sections">
        {[
          { id: 'diagrams', label: 'Vector Business Flow, Sequence & ER Diagrams' },
          { id: 'db-api', label: 'Database Schema & API Business Catalogue' },
          { id: 'ard-arb', label: 'ARD, ARB Scorecard, STRIDE & Risk Register' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            onClick={() => setSection(item.id as typeof section)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              section === item.id
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {section === 'diagrams' && (
        <div className="space-y-6">
          {/* Business Flow SVG */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              1. Business Flow Diagram — Provider Enrollment to Paid Claim &amp; Exclusion Cascade
            </h3>
            <div className="mt-3 overflow-x-auto">
              <svg
                viewBox="0 0 920 210"
                className="w-full min-w-[720px]"
                role="img"
                aria-label="Business flow diagram from M5 Enrollment through M6 Validation, M7 Screening, M8 Determination, M3 Directory, M9 Credentialing, M23 Plans, M10 MMIS, and M11 Claims"
              >
                <defs>
                  <marker id="arrow-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#1d4ed8" />
                  </marker>
                  <marker id="arrow-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#047857" />
                  </marker>
                </defs>
                {/* Row 1 */}
                {[
                  { x: 15, code: '1. M5 Enrollment', sub: '12-step portal + docs', fill: '#eff6ff', stroke: '#1d4ed8' },
                  { x: 245, code: '2. M6 Validation', sub: 'NPI, License, OIG/SAM', fill: '#eff6ff', stroke: '#1d4ed8' },
                  { x: 475, code: '3. M7 Screening', sub: 'Risk tier + site visit', fill: '#fffbeb', stroke: '#b45309' },
                  { x: 705, code: '4. M8 Approval', sub: '2-person Approver gate', fill: '#ecfdf5', stroke: '#047857' },
                ].map((b) => (
                  <g key={b.code}>
                    <rect x={b.x} y={18} width={195} height={62} rx={8} fill={b.fill} stroke={b.stroke} strokeWidth={1.5} />
                    <text x={b.x + 97} y={44} textAnchor="middle" fontSize="13" fontWeight="700" fill={b.stroke}>{b.code}</text>
                    <text x={b.x + 97} y={64} textAnchor="middle" fontSize="11" fill="#334155">{b.sub}</text>
                  </g>
                ))}
                <line x1={210} y1={49} x2={243} y2={49} stroke="#1d4ed8" strokeWidth={2} markerEnd="url(#arrow-blue)" />
                <line x1={440} y1={49} x2={473} y2={49} stroke="#1d4ed8" strokeWidth={2} markerEnd="url(#arrow-blue)" />
                <line x1={670} y1={49} x2={703} y2={49} stroke="#1d4ed8" strokeWidth={2} markerEnd="url(#arrow-blue)" />
                <line x1={802} y1={80} x2={802} y2={122} stroke="#047857" strokeWidth={2} markerEnd="url(#arrow-green)" />

                {/* Row 2 */}
                {[
                  { x: 15, code: '8. M11 Claims Paid', sub: '6-stage adjudication', fill: '#ecfdf5', stroke: '#047857' },
                  { x: 245, code: '7. M10 MMIS / EDI', sub: 'Medicaid ID + X12 999', fill: '#eff6ff', stroke: '#1d4ed8' },
                  { x: 475, code: '6. M9 & M23 Plans', sub: 'PSV + network + rates', fill: '#eff6ff', stroke: '#1d4ed8' },
                  { x: 705, code: '5. M3 Directory', sub: 'Active Practitioner sync', fill: '#ecfdf5', stroke: '#047857' },
                ].map((b) => (
                  <g key={b.code}>
                    <rect x={b.x} y={125} width={195} height={62} rx={8} fill={b.fill} stroke={b.stroke} strokeWidth={1.5} />
                    <text x={b.x + 97} y={151} textAnchor="middle" fontSize="13" fontWeight="700" fill={b.stroke}>{b.code}</text>
                    <text x={b.x + 97} y={171} textAnchor="middle" fontSize="11" fill="#334155">{b.sub}</text>
                  </g>
                ))}
                <line x1={705} y1={156} x2={672} y2={156} stroke="#047857" strokeWidth={2} markerEnd="url(#arrow-green)" />
                <line x1={475} y1={156} x2={442} y2={156} stroke="#1d4ed8" strokeWidth={2} markerEnd="url(#arrow-blue)" />
                <line x1={245} y1={156} x2={212} y2={156} stroke="#047857" strokeWidth={2} markerEnd="url(#arrow-green)" />
              </svg>
            </div>
          </section>

          {/* Sequence Diagram SVG */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              2. Sequence Diagram — Two-Person Approval, FHIR Transaction Sync &amp; Downstream Events
            </h3>
            <div className="mt-3 overflow-x-auto">
              <svg
                viewBox="0 0 920 265"
                className="w-full min-w-[720px]"
                role="img"
                aria-label="Sequence diagram showing Analyst, M8 Determination, AgencyApprover, FHIR R4 Store, and EventBus M10 and M18 notifications"
              >
                {[
                  { x: 90, label: 'EnrollmentAnalyst' },
                  { x: 275, label: 'M8 Determination' },
                  { x: 460, label: 'AgencyApprover' },
                  { x: 645, label: 'M3 / FHIR R4 Store' },
                  { x: 830, label: 'EventBus -> M10/M18' },
                ].map((a) => (
                  <g key={a.label}>
                    <line x1={a.x} y1={42} x2={a.x} y2={252} stroke="#cbd5e1" strokeDasharray="5 4" strokeWidth={1.5} />
                    <rect x={a.x - 74} y={10} width={148} height={32} rx={6} fill="#0f172a" />
                    <text x={a.x} y={30} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="#ffffff">{a.label}</text>
                  </g>
                ))}
                {[
                  { y: 74, x1: 90, x2: 275, txt: '1. submitDecision(Approve, High Risk)', stroke: '#1d4ed8' },
                  { y: 108, x1: 275, x2: 460, txt: '2. Queue PendingTwoPersonDecision', stroke: '#b45309' },
                  { y: 142, x1: 460, x2: 275, txt: '3. signOffPendingDecision(AgencyApprover)', stroke: '#047857' },
                  { y: 176, x1: 275, x2: 645, txt: '4. POST Transaction Bundle (Practitioner + Provenance)', stroke: '#1d4ed8' },
                  { y: 210, x1: 645, x2: 275, txt: '5. 200 OK (Practitioner Active + Provenance ID)', stroke: '#047857', dash: true },
                  { y: 240, x1: 275, x2: 830, txt: '6. publish(ProviderApproved) -> M10 MMIS Queue + M18 Notice', stroke: '#1d4ed8' },
                ].map((m) => (
                  <g key={m.txt}>
                    <line
                      x1={m.x1}
                      y1={m.y}
                      x2={m.x2}
                      y2={m.y}
                      stroke={m.stroke}
                      strokeWidth={1.8}
                      strokeDasharray={m.dash ? '5 3' : undefined}
                      markerEnd={m.stroke === '#047857' ? 'url(#arrow-green)' : 'url(#arrow-blue)'}
                    />
                    <text x={(m.x1 + m.x2) / 2} y={m.y - 6} textAnchor="middle" fontSize="10.5" fill="#1e293b">
                      {m.txt}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </section>

          {/* Database / FHIR ER Diagram SVG */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              3. Database &amp; Multi-Tenant FHIR R4 Entity-Relationship (ER) Diagram
            </h3>
            <div className="mt-3 overflow-x-auto">
              <svg
                viewBox="0 0 920 270"
                className="w-full min-w-[720px]"
                role="img"
                aria-label="Entity relationship diagram showing Tenant Partition root connected to Provider Master, Enrollment Lifecycle, Plans and Claims, Clinical Public Health, and Security Audit FHIR stores"
              >
                {/* Root Tenant */}
                <rect x={310} y={10} width={300} height={68} rx={6} fill="#ffffff" stroke="#1d4ed8" strokeWidth={1.8} />
                <rect x={310} y={10} width={300} height={22} rx={4} fill="#1d4ed8" />
                <text x={460} y={25} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#ffffff">TENANT_PARTITION (Root Key: X-Tenant-Id)</text>
                <text x={322} y={48} fontSize="10.5" fontFamily="monospace" fill="#0f172a">PK tenant_id | code | layered_config (4 scopes)</text>
                <text x={322} y={64} fontSize="10.5" fontFamily="monospace" fill="#475569">legal_hold_active | fhir_partition_prefix</text>

                {/* Connectors */}
                <line x1={390} y1={78} x2={155} y2={106} stroke="#64748b" strokeWidth={1.5} markerEnd="url(#arrow-blue)" />
                <line x1={460} y1={78} x2={460} y2={106} stroke="#64748b" strokeWidth={1.5} markerEnd="url(#arrow-blue)" />
                <line x1={530} y1={78} x2={765} y2={106} stroke="#64748b" strokeWidth={1.5} markerEnd="url(#arrow-blue)" />

                {[
                  { x: 20, y: 108, w: 270, hdr: '#0f172a', title: 'PROVIDER_MASTER (FHIR R4)', l1: 'PK practitioner_id | npi | status', l2: 'Organization, PractitionerRole, Location, Endpoint' },
                  { x: 325, y: 108, w: 270, hdr: '#b45309', title: 'ENROLLMENT_AND_SCREENING', l1: 'PK application_id | FK practitioner_id', l2: 'QuestionnaireResponse, Task, DetectedIssue, Risk' },
                  { x: 630, y: 108, w: 270, hdr: '#047857', title: 'PLANS_AND_CLAIMS (FHIR R4)', l1: 'PK plan_id | claim_id | FK coverage_id', l2: 'InsurancePlan, Claim, ClaimResponse, PaymentRecon' },
                  { x: 80, y: 192, w: 350, hdr: '#1d4ed8', title: 'CLINICAL_AND_PUBLIC_HEALTH (eCR & UDS+)', l1: 'PK patient_id | encounter_id | bundle_id', l2: 'Condition, Observation, Composition (eICR), DocRef (RR), MeasureReport' },
                  { x: 490, y: 192, w: 350, hdr: '#be123c', title: 'SECURITY_PRIVACY_COMMS_AUDIT', l1: 'PK audit_id | consent_id | communication_id', l2: 'Consent (PSY/ETH/HIV/SDV), Provenance, Subscription, AuditEvent (10y)' },
                ].map((e) => (
                  <g key={e.title}>
                    <rect x={e.x} y={e.y} width={e.w} height={64} rx={6} fill="#ffffff" stroke={e.hdr} strokeWidth={1.5} />
                    <rect x={e.x} y={e.y} width={e.w} height={21} rx={4} fill={e.hdr} />
                    <text x={e.x + 10} y={e.y + 14} fontSize="10.5" fontWeight="700" fill="#ffffff">{e.title}</text>
                    <text x={e.x + 10} y={e.y + 38} fontSize="10" fontFamily="monospace" fill="#0f172a">{e.l1}</text>
                    <text x={e.x + 10} y={e.y + 54} fontSize="9.5" fill="#475569">{e.l2}</text>
                  </g>
                ))}
              </svg>
            </div>
          </section>
        </div>
      )}

      {section === 'db-api' && (
        <div className="space-y-6">
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100">
              API Business Details &amp; Integration Contracts ({API_BUSINESS_CATALOGUE.length} Endpoints)
            </div>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-2.5">Surface</th>
                  <th className="px-4 py-2.5">Method / Path</th>
                  <th className="px-4 py-2.5">Business Purpose</th>
                  <th className="px-4 py-2.5">Business Rules &amp; Error Contract</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {API_BUSINESS_CATALOGUE.map((api) => (
                  <tr key={api.id}>
                    <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">{api.surface}</td>
                    <td className="px-4 py-2.5 font-mono text-blue-700 dark:text-blue-400">
                      {api.method} {api.path}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{api.businessPurpose}</td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                      <div>{api.businessRules}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-amber-700 dark:text-amber-400">
                        Errors: {api.errorContract}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100">
              Logical Database &amp; FHIR R4 Data Dictionary ({DB_ENTITY_CATALOGUE.length} Domains)
            </div>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-2.5">Entity / FHIR Resources</th>
                  <th className="px-4 py-2.5">Key &amp; Partition</th>
                  <th className="px-4 py-2.5">Relationships</th>
                  <th className="px-4 py-2.5">Retention &amp; Masking</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {DB_ENTITY_CATALOGUE.map((db) => (
                  <tr key={db.entity}>
                    <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">{db.entity}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-300">
                      {db.primaryKey} · {db.tenantPartition}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{db.relationships}</td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{db.retentionAndMasking}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === 'ard-arb' && (
        <div className="space-y-6">
          {/* ARD Requirements */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100">
              Architecture Requirements Document (ARD) — Functional &amp; NFR Baseline
            </div>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-2.5">ID</th>
                  <th className="px-4 py-2.5">Category</th>
                  <th className="px-4 py-2.5">Requirement</th>
                  <th className="px-4 py-2.5">Target Metric / SLO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ARD_REQUIREMENTS.map((req) => (
                  <tr key={req.id}>
                    <td className="px-4 py-2.5 font-mono font-semibold text-blue-700 dark:text-blue-400">{req.id}</td>
                    <td className="px-4 py-2.5 font-semibold">{req.category}</td>
                    <td className="px-4 py-2.5">{req.requirement}</td>
                    <td className="px-4 py-2.5 text-emerald-700 dark:text-emerald-400">{req.targetMetric}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ARB Scorecard */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Architecture Review Board (ARB) Domain Scorecard
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {ARB_SCORECARD.map((item) => (
                <div
                  key={item.domain}
                  className="rounded-md border border-slate-200 p-3 text-xs dark:border-slate-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{item.domain}</span>
                    <SemanticStatus
                      tone={item.status === 'Approved' ? 'success' : 'warning'}
                      label={item.status}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">Reviewer: {item.reviewer}</div>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">{item.evidence}</p>
                </div>
              ))}
            </div>
          </div>

          {/* STRIDE + Risk Register */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <ShieldAlert className="h-4 w-4 text-rose-600" aria-hidden="true" />
                STRIDE Threat Model
              </h3>
              <ul className="mt-3 space-y-2 text-xs">
                {STRIDE_THREAT_MODEL.map((t) => (
                  <li key={t.category} className="rounded border border-slate-100 p-2.5 dark:border-slate-800">
                    <div className="font-semibold text-rose-700 dark:text-rose-400">
                      {t.category} ({t.moduleRef})
                    </div>
                    <div className="mt-0.5 text-slate-700 dark:text-slate-300">{t.threat}</div>
                    <div className="mt-0.5 text-slate-500">Control: {t.control}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                ARB Enterprise Risk Register ({ARB_RISK_REGISTER.length} Risks)
              </h3>
              <ul className="mt-3 space-y-2 text-xs">
                {ARB_RISK_REGISTER.map((r) => (
                  <li key={r.id} className="rounded border border-slate-100 p-2.5 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{r.id}</span>
                      <SemanticStatus
                        tone={r.severity === 'High' ? 'danger' : r.severity === 'Medium' ? 'warning' : 'info'}
                        label={r.severity}
                      />
                    </div>
                    <div className="mt-0.5 text-slate-700 dark:text-slate-300">{r.risk}</div>
                    <div className="mt-0.5 text-slate-500">Mitigation: {r.mitigation}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
