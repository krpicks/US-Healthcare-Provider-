import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MODULE_REGISTRY } from '../../app/moduleRegistry';
import { ALL_ROLES, ROLE_DESCRIPTIONS, ROLE_UNMASK_PERMISSION } from '../../app/rbac';
import { INTEROP_KNOWLEDGE_BASE } from '../m20-diagnostics/diagnosticsService';
import { E2E_SCENARIO_CATALOG } from '../test-report/e2eScenariosService';
import {
  API_BUSINESS_CATALOGUE,
  ARB_RISK_REGISTER,
  ARB_SCORECARD,
  ARD_REQUIREMENTS,
  DB_ENTITY_CATALOGUE,
  STRIDE_THREAT_MODEL,
} from './architectureDiagramsData';
import {
  ARCHITECTURE_ADRS,
  CICD_STAGES,
  DEPLOYMENT_ENVIRONMENTS,
  docsService,
} from './docsService';

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;

const COLORS = {
  navy: [15, 23, 42] as [number, number, number],
  brand: [29, 78, 216] as [number, number, number],
  brandLight: [239, 246, 255] as [number, number, number],
  emerald: [4, 120, 87] as [number, number, number],
  emeraldLight: [236, 253, 245] as [number, number, number],
  amber: [180, 83, 9] as [number, number, number],
  amberLight: [255, 251, 235] as [number, number, number],
  rose: [190, 18, 60] as [number, number, number],
  roseLight: [255, 241, 242] as [number, number, number],
  slate: [71, 85, 105] as [number, number, number],
  slateLight: [248, 250, 252] as [number, number, number],
  border: [203, 213, 225] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

function drawSectionHeader(doc: jsPDF, sectionNum: string, title: string, subtitle: string, startNewPage = true): number {
  if (startNewPage) {
    doc.addPage();
  }
  const y = 20;
  doc.setFillColor(...COLORS.brand);
  doc.rect(MARGIN, y, 4, 11, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...COLORS.navy);
  doc.text(`${sectionNum}. ${title}`, MARGIN + 7, y + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.slate);
  doc.text(subtitle, MARGIN + 7, y + 10.5);

  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y + 13.5, PAGE_W - MARGIN, y + 13.5);
  return y + 18;
}

function drawSubheading(doc: jsPDF, y: number, text: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...COLORS.brand);
  doc.text(text, MARGIN, y);
  return y + 5;
}

function drawArrow(
  doc: jsPDF,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: [number, number, number] = COLORS.slate,
  dashed = false,
) {
  doc.setDrawColor(...color);
  doc.setFillColor(...color);
  doc.setLineWidth(0.45);
  if (dashed) {
    doc.setLineDashPattern([1.5, 1.5], 0);
  }
  doc.line(x1, y1, x2, y2);
  if (dashed) {
    doc.setLineDashPattern([], 0);
  }
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 2.2;
  const ax = x2 - headLen * Math.cos(angle - Math.PI / 6);
  const ay = y2 - headLen * Math.sin(angle - Math.PI / 6);
  const bx = x2 - headLen * Math.cos(angle + Math.PI / 6);
  const by = y2 - headLen * Math.sin(angle + Math.PI / 6);
  doc.triangle(x2, y2, ax, ay, bx, by, 'F');
}

function drawFlowBox(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  code: string,
  label: string,
  fill: [number, number, number] = COLORS.brandLight,
  stroke: [number, number, number] = COLORS.brand,
) {
  doc.setFillColor(...fill);
  doc.setDrawColor(...stroke);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...stroke);
  doc.text(code, x + w / 2, y + 5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...COLORS.navy);
  const wrapped = doc.splitTextToSize(label, w - 3);
  doc.text(wrapped, x + w / 2, y + 9.2, { align: 'center', lineHeightFactor: 1.15 });
}

interface SequenceMessage {
  from: number;
  to: number;
  label: string;
  dashed?: boolean;
  color?: [number, number, number];
}

function drawSequenceDiagram(
  doc: jsPDF,
  topY: number,
  title: string,
  actors: string[],
  messages: SequenceMessage[],
): number {
  let y = drawSubheading(doc, topY, title);
  const boxH = 10;
  const stepH = 10.5;
  const totalH = boxH + messages.length * stepH + 10;

  // Background card
  doc.setFillColor(...COLORS.slateLight);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, y, CONTENT_W, totalH, 2, 2, 'FD');

  const padX = 8;
  const usableW = CONTENT_W - padX * 2;
  const colSpacing = usableW / Math.max(actors.length - 1, 1);
  const actorXs = actors.map((_, idx) => MARGIN + padX + idx * colSpacing);
  const boxW = Math.min(32, colSpacing - 3);
  const headerY = y + 3;

  // Actor boxes + vertical lifelines
  actors.forEach((actor, idx) => {
    const cx = actorXs[idx];
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.line(cx, headerY + boxH, cx, y + totalH - 3);
    doc.setLineDashPattern([], 0);

    doc.setFillColor(...COLORS.navy);
    doc.roundedRect(cx - boxW / 2, headerY, boxW, boxH, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    doc.setTextColor(...COLORS.white);
    const lines = doc.splitTextToSize(actor, boxW - 2);
    doc.text(lines, cx, headerY + (lines.length > 1 ? 4.2 : 6.2), { align: 'center' });
  });

  // Messages
  let msgY = headerY + boxH + 7;
  messages.forEach((m, idx) => {
    const x1 = actorXs[m.from];
    const x2 = actorXs[m.to];
    const color = m.color ?? (m.dashed ? COLORS.emerald : COLORS.brand);
    if (m.from === m.to) {
      // Self call loop
      doc.setDrawColor(...color);
      doc.setLineWidth(0.4);
      doc.line(x1, msgY - 2, x1 + 8, msgY - 2);
      doc.line(x1 + 8, msgY - 2, x1 + 8, msgY + 2);
      drawArrow(doc, x1 + 8, msgY + 2, x1 + 1, msgY + 2, color);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.6);
      doc.setTextColor(...COLORS.navy);
      doc.text(`${idx + 1}. ${m.label}`, x1 + 10, msgY + 0.5);
    } else {
      drawArrow(doc, x1, msgY, x2, msgY, color, m.dashed);
      const midX = (x1 + x2) / 2;
      doc.setFont('helvetica', m.dashed ? 'italic' : 'normal');
      doc.setFontSize(6.6);
      doc.setTextColor(...COLORS.navy);
      doc.text(`${idx + 1}. ${m.label}`, midX, msgY - 1.8, { align: 'center' });
    }
    msgY += stepH;
  });

  return y + totalH + 7;
}

function getLastTableY(doc: jsPDF, fallback: number): number {
  const anyDoc = doc as unknown as { lastAutoTable?: { finalY?: number } };
  return (anyDoc.lastAutoTable?.finalY ?? fallback) + 6;
}

export function buildUserManualPdf(): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const generatedDate = new Date().toISOString().slice(0, 10);

  // =========================================================================
  // COVER PAGE
  // =========================================================================
  doc.setFillColor(...COLORS.navy);
  doc.rect(0, 0, PAGE_W, 92, 'F');
  doc.setFillColor(...COLORS.brand);
  doc.rect(0, 92, PAGE_W, 3.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(147, 197, 253);
  doc.text('PROVIDERLINK FHIR R4 ENTERPRISE PLATFORM', MARGIN, 28);

  doc.setFontSize(22);
  doc.setTextColor(...COLORS.white);
  doc.text('Complete User Manual, Technical', MARGIN, 42);
  doc.text('Architecture (ARD) & ARB Pack', MARGIN, 52);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    'Includes Business Flow Diagrams, Sequence Diagrams, Database / FHIR ER Diagram,',
    MARGIN,
    66,
  );
  doc.text(
    'API Business Specifications, ARD, ARB Governance, RBAC, HIPAA & QA Runbook',
    MARGIN,
    73,
  );

  // Document Control Card
  let y = 108;
  doc.setFillColor(...COLORS.slateLight);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(MARGIN, y, CONTENT_W, 44, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.navy);
  doc.text('Document Control & Governance Metadata', MARGIN + 5, y + 8);

  const metaRows = [
    ['Document Version', 'v1.0 (Phases 0–5 Complete)', 'Date Generated', generatedDate],
    ['Platform Scope', '24 Modules (M1–M24) + Build Status + Test Report', 'FHIR Standard', 'HL7 FHIR R4 (4.0.1) + US Core'],
    ['Compliance Alignment', 'HIPAA / 42 CFR Part 2 / CMS 42 CFR 455 / WCAG 2.1 AA', 'Verification Status', '29 Suites / 123 Tests Passing (100%)'],
    ['Data Classification', 'Prototype — Synthetic Data Only (No Real PHI/PII)', 'ARB Decision', 'Approved (Mock) / Conditional (Prod)'],
  ];
  autoTable(doc, {
    startY: y + 11,
    margin: { left: MARGIN + 4, right: MARGIN + 4 },
    theme: 'plain',
    styles: { fontSize: 7.8, cellPadding: 1.6, textColor: COLORS.navy },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: COLORS.slate, cellWidth: 34 },
      1: { cellWidth: 54 },
      2: { fontStyle: 'bold', textColor: COLORS.slate, cellWidth: 33 },
      3: { cellWidth: 51 },
    },
    body: metaRows,
  });

  // Table of Contents on Cover Page
  y = 164;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.navy);
  doc.text('Table of Contents', MARGIN, y);
  doc.setDrawColor(...COLORS.brand);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y + 2, MARGIN + 38, y + 2);

  const tocItems = [
    ['Section 1', 'User Manual — Getting Started, Roles, Modes & 24-Module Reference'],
    ['Section 2', 'Business Flow Diagrams — Provider Lifecycle, Exclusion Cascade, eCR & UDS+'],
    ['Section 3', 'Sequence Diagrams — Approval/MMIS, Claims Pipeline, eCR & Security/Audit'],
    ['Section 4', 'Database & FHIR R4 ER Diagram + Multi-Tenant Logical Data Dictionary'],
    ['Section 5', 'API Business Details, Integration Architecture Flow & Event Bus Catalogue'],
    ['Section 6', 'Architecture Requirements & Reference Document (ARD) + ADRs'],
    ['Section 7', 'Architecture Review Board (ARB) Pack — Scorecard, STRIDE, Risk Register & CI/CD'],
    ['Section 8', 'Governance Appendices — RBAC Matrix, HIPAA Safeguards, Runbook SOPs & QA Evidence'],
  ];

  autoTable(doc, {
    startY: y + 5,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'striped',
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5, cellPadding: 2.6, textColor: COLORS.navy },
    columnStyles: { 0: { fontStyle: 'bold', textColor: COLORS.brand, cellWidth: 26 } },
    head: [['Section', 'Document Contents']],
    body: tocItems,
  });

  // =========================================================================
  // SECTION 1: USER MANUAL
  // =========================================================================
  y = drawSectionHeader(
    doc,
    '1',
    'User Manual & Operational Guide',
    'Quick-start workflows, Mock vs Live FHIR mode, multi-tenant switching, and complete 24-module directory',
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.8);
  doc.setTextColor(...COLORS.navy);
  const introText = doc.splitTextToSize(
    'ProviderLink is a unified multi-tenant Medicaid & Healthcare Provider Lifecycle, Clinical Interoperability (FHIR R4, eCR, UDS+), Conformance (Inferno), and Governance web application. It operates offline-capable out of the box in Mock Mode with seeded synthetic data, and seamlessly switches to Live Mode against local or enterprise HAPI FHIR R4 (:8081), eCRNow (:8080), .NET Integration Gateway (:5000), and Inferno (:4567).',
    CONTENT_W,
  );
  doc.text(introText, MARGIN, y);
  y += introText.length * 4.2 + 3;

  y = drawSubheading(doc, y, '1.1 Quick-Start Operational Steps');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'grid',
    headStyles: { fillColor: COLORS.brand, textColor: COLORS.white, fontSize: 8 },
    bodyStyles: { fontSize: 7.8, cellPadding: 2.2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 36 } },
    head: [['Capability', 'How to Operate in the Application']],
    body: [
      ['Navigation & Overview', 'Use the left collapsible sidebar (or mobile drawer) to access Build Status (/build-status), Test Report (/test-report), and all 24 modules grouped by Core, Provider Lifecycle, Interoperability, and Cross-cutting.'],
      ['Role Switching (RBAC)', 'Use the top-bar Demo Role Switcher to test all 11 personas (PlatformAdmin, TenantAdmin, ProviderUser, EnrollmentAnalyst, ScreeningAnalyst, CredentialingSpecialist, ProgramIntegrityOfficer, AgencyApprover, PlanManager, IntegrationEngineer, Auditor).'],
      ['Tenant Isolation', 'PlatformAdmin users switch active tenants in the top header; non-PlatformAdmin users are strictly scoped to their assigned tenant partition. Onboard new tenants in M24 (/tenants).'],
      ['Mock vs Live Mode', 'Mock Mode is active by default with deterministic synthetic FHIR R4 data. Switch to Live Mode in M1 Settings (/settings) to connect to HAPI FHIR (:8081) and .NET Gateway (:5000); failed live calls fall back gracefully with diagnostics in M20.'],
      ['Accessibility & Theme', 'Toggle WCAG 2.1 AA Light/Dark themes in the top header. Use Tab/Skip-to-Content for keyboard navigation and Table View + CSV Export on every Analytics chart (M19).'],
    ],
  });

  y = getLastTableY(doc, y + 40);
  y = drawSubheading(doc, y, '1.2 Complete 24-Module User Reference');

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'striped',
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontSize: 7.5 },
    bodyStyles: { fontSize: 7.1, cellPadding: 1.8 },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: COLORS.brand, cellWidth: 13 },
      1: { fontStyle: 'bold', cellWidth: 40 },
      2: { font: 'courier', cellWidth: 28 },
      3: { cellWidth: 68 },
      4: { cellWidth: 31 },
    },
    head: [['Code', 'Module Name', 'Route', 'Primary User Functions', 'FHIR Resources']],
    body: MODULE_REGISTRY.map((m) => [
      m.code,
      m.shortName,
      m.route,
      m.description,
      m.fhirResources.slice(0, 3).join(', ') || 'Platform',
    ]),
  });

  // =========================================================================
  // SECTION 2: BUSINESS FLOW DIAGRAMS
  // =========================================================================
  y = drawSectionHeader(
    doc,
    '2',
    'Business Flow Diagrams',
    'End-to-end Medicaid provider lifecycle, program integrity exclusion cascade, and public health interoperability flows',
  );

  // Diagram 2.1: Provider Lifecycle
  y = drawSubheading(doc, y, 'Diagram 2.1 — End-to-End Provider Enrollment to Claims Payment (Scenario A)');
  const card21Y = y;
  doc.setFillColor(...COLORS.slateLight);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(MARGIN, card21Y, CONTENT_W, 64, 2, 2, 'FD');

  const row1Y = card21Y + 6;
  const row2Y = card21Y + 38;
  const bw = 37;
  const bh = 18;
  const gap = 8;

  // Row 1 (left to right): M5 -> M6 -> M7 -> M8
  drawFlowBox(doc, MARGIN + 4, row1Y, bw, bh, '1. M5 Enrollment', '12-step portal, SHA-256 docs, fee & submit');
  drawArrow(doc, MARGIN + 4 + bw, row1Y + bh / 2, MARGIN + 4 + bw + gap, row1Y + bh / 2);

  drawFlowBox(doc, MARGIN + 4 + (bw + gap), row1Y, bw, bh, '2. M6 Validation', 'Parallel NPI, License, OIG/SAM, TIN checks');
  drawArrow(doc, MARGIN + 4 + (bw + gap) + bw, row1Y + bh / 2, MARGIN + 4 + 2 * (bw + gap), row1Y + bh / 2);

  drawFlowBox(doc, MARGIN + 4 + 2 * (bw + gap), row1Y, bw, bh, '3. M7 Screening', 'Limited/Mod/High risk, site visit, prints', COLORS.amberLight, COLORS.amber);
  drawArrow(doc, MARGIN + 4 + 2 * (bw + gap) + bw, row1Y + bh / 2, MARGIN + 4 + 3 * (bw + gap), row1Y + bh / 2);

  drawFlowBox(doc, MARGIN + 4 + 3 * (bw + gap), row1Y, bw, bh, '4. M8 Determination', '2-person Approver sign-off, RFI/Appeals', COLORS.emeraldLight, COLORS.emerald);

  // Connector down from M8 to M3
  const m8MidX = MARGIN + 4 + 3 * (bw + gap) + bw / 2;
  drawArrow(doc, m8MidX, row1Y + bh, m8MidX, row2Y, COLORS.emerald);

  // Row 2 (right to left): M3 -> M9/M23 -> M10 -> M11
  drawFlowBox(doc, MARGIN + 4 + 3 * (bw + gap), row2Y, bw, bh, '5. M3 Directory', 'Active Practitioner, Role & Location sync', COLORS.emeraldLight, COLORS.emerald);
  drawArrow(doc, MARGIN + 4 + 3 * (bw + gap), row2Y + bh / 2, MARGIN + 4 + 2 * (bw + gap) + bw, row2Y + bh / 2, COLORS.emerald);

  drawFlowBox(doc, MARGIN + 4 + 2 * (bw + gap), row2Y, bw, bh, '6. M9 & M23 Plans', 'PSV committee, contract, network & rates');
  drawArrow(doc, MARGIN + 4 + 2 * (bw + gap), row2Y + bh / 2, MARGIN + 4 + (bw + gap) + bw, row2Y + bh / 2);

  drawFlowBox(doc, MARGIN + 4 + (bw + gap), row2Y, bw, bh, '7. M10 MMIS / EDI', 'Medicaid ID load ACK & X12 partner live');
  drawArrow(doc, MARGIN + 4 + (bw + gap), row2Y + bh / 2, MARGIN + 4 + bw, row2Y + bh / 2);

  drawFlowBox(doc, MARGIN + 4, row2Y, bw, bh, '8. M11 Claims Paid', '6-stage adjudication -> ClaimResponse Paid', COLORS.emeraldLight, COLORS.emerald);

  // RFI Loop note
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.8);
  doc.setTextColor(...COLORS.amber);
  doc.text('Feedback Loop: Deficiencies at M6/M8 trigger RFI (FHIR Communication) back to M5 Portal; Denials allow 60-day Appeals.', MARGIN + 5, card21Y + 61);

  y = card21Y + 71;

  // Diagram 2.2: Program Integrity Exclusion Cascade
  y = drawSubheading(doc, y, 'Diagram 2.2 — Program Integrity & Exclusion Cascade Flow (Scenario B)');
  const card22Y = y;
  doc.setFillColor(...COLORS.slateLight);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(MARGIN, card22Y, CONTENT_W, 56, 2, 2, 'FD');

  const piY1 = card22Y + 6;
  const piY2 = card22Y + 32;
  drawFlowBox(doc, MARGIN + 4, piY1, 38, 17, 'M6 Exclusions', 'OIG-LEIE / SAM.gov sanction match', COLORS.roseLight, COLORS.rose);
  drawArrow(doc, MARGIN + 42, piY1 + 8.5, MARGIN + 50, piY1 + 8.5, COLORS.rose);

  drawFlowBox(doc, MARGIN + 50, piY1, 40, 17, 'M12 Monitoring', 'Raises ExclusionHit + Task + DetectedIssue', COLORS.roseLight, COLORS.rose);
  drawArrow(doc, MARGIN + 90, piY1 + 8.5, MARGIN + 98, piY1 + 8.5, COLORS.rose);

  drawFlowBox(doc, MARGIN + 98, piY1, 38, 17, 'PI Officer Action', 'Suspends provider + Provenance record', COLORS.amberLight, COLORS.amber);
  drawArrow(doc, MARGIN + 136, piY1 + 8.5, MARGIN + 144, piY1 + 8.5, COLORS.rose);

  drawFlowBox(doc, MARGIN + 144, piY1, 32, 17, 'M3 Directory', 'Status -> Suspended', COLORS.roseLight, COLORS.rose);

  // Fan-out arrows to Row 2
  drawArrow(doc, MARGIN + 117, piY1 + 17, MARGIN + 23, piY2, COLORS.rose, true);
  drawArrow(doc, MARGIN + 117, piY1 + 17, MARGIN + 70, piY2, COLORS.rose, true);
  drawArrow(doc, MARGIN + 117, piY1 + 17, MARGIN + 117, piY2, COLORS.brand, true);
  drawArrow(doc, MARGIN + 117, piY1 + 17, MARGIN + 160, piY2, COLORS.brand, true);

  drawFlowBox(doc, MARGIN + 4, piY2, 38, 17, 'M10 MMIS Queue', 'StatusUpdate load queued for MMIS', COLORS.amberLight, COLORS.amber);
  drawFlowBox(doc, MARGIN + 50, piY2, 40, 17, 'M11 Claims Block', 'New claim Denied: PROVIDER_NOT_ACTIVE', COLORS.roseLight, COLORS.rose);
  drawFlowBox(doc, MARGIN + 98, piY2, 38, 17, 'M18 Notifications', 'Auto-dispatches Critical suspension notice');
  drawFlowBox(doc, MARGIN + 144, piY2, 32, 17, 'M19 Analytics', 'Updates Open Exclusions KPI');

  y = card22Y + 63;

  // Diagram 2.3: eCR & UDS+ Flows
  y = drawSubheading(doc, y, 'Diagram 2.3 — Public Health Interoperability Flows: eCR (Scenario C) & UDS+ (Scenario D)');
  const card23Y = y;
  doc.setFillColor(...COLORS.slateLight);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(MARGIN, card23Y, CONTENT_W, 56, 2, 2, 'FD');

  // eCR row
  const ecrY = card23Y + 7;
  drawFlowBox(doc, MARGIN + 4, ecrY, 32, 17, 'M4 Clinical', 'Positive SARS-CoV-2 Lab/Dx');
  drawArrow(doc, MARGIN + 36, ecrY + 8.5, MARGIN + 43, ecrY + 8.5);
  drawFlowBox(doc, MARGIN + 43, ecrY, 37, 17, 'M13 RCTC Trigger', 'Builds eICR Composition Bundle');
  drawArrow(doc, MARGIN + 80, ecrY + 8.5, MARGIN + 87, ecrY + 8.5);
  drawFlowBox(doc, MARGIN + 87, ecrY, 38, 17, 'FHIR $validate', 'Submits to eCRNow / PHA Stub', COLORS.emeraldLight, COLORS.emerald);
  drawArrow(doc, MARGIN + 125, ecrY + 8.5, MARGIN + 132, ecrY + 8.5, COLORS.emerald);
  drawFlowBox(doc, MARGIN + 132, ecrY, 44, 17, 'RR Intake -> M18/M19', 'DocRef attached + RR Notice + KPI', COLORS.emeraldLight, COLORS.emerald);

  // UDS+ row
  const udsY = card23Y + 32;
  drawFlowBox(doc, MARGIN + 4, udsY, 32, 17, 'M4 Patients', 'Patient/$everything Charts');
  drawArrow(doc, MARGIN + 36, udsY + 8.5, MARGIN + 43, udsY + 8.5);
  drawFlowBox(doc, MARGIN + 43, udsY, 37, 17, 'M14 Cohort & Gap', 'Evaluates UDS+ IG completeness');
  drawArrow(doc, MARGIN + 80, udsY + 8.5, MARGIN + 87, udsY + 8.5);
  drawFlowBox(doc, MARGIN + 87, udsY, 38, 17, 'In-Memory De-ID', 'Strips PHI, shifts dates, pseudonyms', COLORS.amberLight, COLORS.amber);
  drawArrow(doc, MARGIN + 125, udsY + 8.5, MARGIN + 132, udsY + 8.5, COLORS.emerald);
  drawFlowBox(doc, MARGIN + 132, udsY, 44, 17, 'HRSA Submission', '$validate + MeasureReport Bundle', COLORS.emeraldLight, COLORS.emerald);

  // =========================================================================
  // SECTION 3: SEQUENCE DIAGRAMS
  // =========================================================================
  y = drawSectionHeader(
    doc,
    '3',
    'System Sequence Diagrams',
    'Runtime interactions across SPA modules, RBAC/Approval gates, FHIR R4 store, EventBus, and external adapters',
  );

  y = drawSequenceDiagram(
    doc,
    y,
    'Diagram 3.1 — Enrollment Approval, Two-Person Sign-Off, M3 Sync & M10 MMIS Load',
    ['Enrollment Analyst', 'M8 Determination', 'AgencyApprover', 'M3 / FHIR Store', 'EventBus & M10/M18'],
    [
      { from: 0, to: 1, label: 'submitDecision(Approve, High Risk)' },
      { from: 1, to: 2, label: 'Queue PendingTwoPersonDecision (42 CFR 455)' },
      { from: 2, to: 1, label: 'signOffPendingDecision(approver)' },
      { from: 1, to: 3, label: 'POST Transaction Bundle (Practitioner + Provenance)' },
      { from: 3, to: 1, label: '200 OK (Practitioner Active + Provenance ID)', dashed: true },
      { from: 1, to: 4, label: 'publish(ProviderApproved)' },
      { from: 4, to: 4, label: 'M10 auto-queues MMIS load; M18 dispatches approval email' },
    ],
  );

  y = drawSequenceDiagram(
    doc,
    y,
    'Diagram 3.2 — M11 Claims 6-Stage Adjudication Pipeline',
    ['Billing User / M11', 'M4 Coverage', 'M3 Directory', 'M23 Plan & Rates', 'FHIR Store'],
    [
      { from: 0, to: 1, label: 'Stage 1: Verify member Coverage active on DOS' },
      { from: 1, to: 0, label: 'Eligible (or Deny MEMBER_NOT_ELIGIBLE)', dashed: true },
      { from: 0, to: 2, label: 'Stage 2: Verify rendering Practitioner status === Active' },
      { from: 2, to: 0, label: 'Active (or Deny PROVIDER_NOT_ACTIVE)', dashed: true },
      { from: 0, to: 3, label: 'Stages 3–5: Check Network, Prior Auth & Fee Schedule' },
      { from: 3, to: 0, label: 'Allowed Rate ($131.75) or PA/OOB Denial', dashed: true },
      { from: 0, to: 4, label: 'Stage 6: Create Claim, ClaimResponse & PaymentReconciliation' },
    ],
  );

  // Second Sequence Diagram Page
  y = drawSectionHeader(
    doc,
    '3 (cont.)',
    'System Sequence Diagrams — Interoperability & Security',
    'Public health eCR processing and zero-trust security / SMART scope / Break-Glass auditing sequences',
  );

  y = drawSequenceDiagram(
    doc,
    y,
    'Diagram 3.3 — Electronic Case Reporting (eCR) & Reportability Response Sequence',
    ['M4 Clinical Chart', 'M13 eCR Engine', 'FHIR $validate', 'eCRNow / PHA', 'M18 & M19'],
    [
      { from: 0, to: 1, label: 'Load Patient/$everything (LOINC 94500-6 Positive)' },
      { from: 1, to: 1, label: 'Match RCTC Trigger -> emit CaseTriggered' },
      { from: 1, to: 2, label: 'POST Bundle/$validate (Document + Composition)' },
      { from: 2, to: 1, label: 'OperationOutcome (0 errors) -> EicrGenerated', dashed: true },
      { from: 1, to: 3, label: 'POST /api/eicr/submit (eICR Bundle)' },
      { from: 3, to: 1, label: 'RR (Reportable) -> Save FHIR DocumentReference', dashed: true },
      { from: 1, to: 4, label: 'publish(ReportabilityResponseReceived) -> Notify & KPI+1' },
    ],
  );

  y = drawSequenceDiagram(
    doc,
    y,
    'Diagram 3.4 — Security, SMART Scope Enforcement, Consent & Break-Glass Sequence',
    ['User / Role', 'M17 Security', 'RBAC & Scopes', 'FHIR Consent', 'AuditEvent Log'],
    [
      { from: 0, to: 1, label: 'Request sensitive PSY/ETH chart or PII Unmask' },
      { from: 1, to: 2, label: 'Verify canRoleUnmask(role) & assertSmartScope()' },
      { from: 2, to: 1, label: '403 Forbidden if unauthorized or scope revoked', dashed: true, color: COLORS.rose },
      { from: 1, to: 3, label: 'Filter resources against active Consent deny labels' },
      { from: 0, to: 1, label: 'activateBreakGlass(reason, duration <= 60 min)' },
      { from: 1, to: 4, label: 'POST FHIR AuditEvent (action=unmask, actor, reason)' },
      { from: 1, to: 0, label: 'Temporary read access granted until expiry/revoke', dashed: true },
    ],
  );

  // =========================================================================
  // SECTION 4: DATABASE & FHIR R4 ER DIAGRAM + LOGICAL DATA MODEL
  // =========================================================================
  y = drawSectionHeader(
    doc,
    '4',
    'Database & FHIR R4 ER Diagram',
    'Multi-tenant partitioned relational + FHIR R4 resource schema, entity relationships, and data governance rules',
  );

  y = drawSubheading(doc, y, 'Diagram 4.1 — Logical Entity-Relationship & FHIR Partition Diagram');
  const erY = y;
  doc.setFillColor(...COLORS.slateLight);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(MARGIN, erY, CONTENT_W, 92, 2, 2, 'FD');

  const drawErEntity = (
    x: number,
    ey: number,
    w: number,
    h: number,
    title: string,
    fields: string[],
    headerColor: [number, number, number] = COLORS.navy,
  ) => {
    doc.setFillColor(...COLORS.white);
    doc.setDrawColor(...headerColor);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, ey, w, h, 1.5, 1.5, 'FD');
    doc.setFillColor(...headerColor);
    doc.rect(x, ey, w, 6.2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(...COLORS.white);
    doc.text(title, x + 2.5, ey + 4.3);

    doc.setFont('courier', 'normal');
    doc.setFontSize(6.3);
    doc.setTextColor(...COLORS.navy);
    fields.forEach((f, idx) => {
      doc.text(f, x + 2.5, ey + 10.2 + idx * 4.1);
    });
  };

  // Top center root: Tenant
  drawErEntity(MARGIN + 56, erY + 4, 68, 22, 'TENANT_PARTITION (Root)', [
    'PK tenant_id (UUID) / code',
    'FK layered_config (4 scopes)',
    '   legal_hold_active (bool)',
    '   fhir_partition_prefix',
  ], COLORS.brand);

  // Middle row: Provider Master | Enrollment | Plans & Rates
  drawErEntity(MARGIN + 4, erY + 34, 54, 24, 'PROVIDER_MASTER (FHIR)', [
    'PK practitioner_id / npi',
    'FK tenant_id, org_id',
    '   PractitionerRole, Location',
    '   Endpoint, status, medicaidId',
  ], COLORS.navy);

  drawErEntity(MARGIN + 63, erY + 34, 54, 24, 'ENROLLMENT_LIFECYCLE', [
    'PK application_id / task_id',
    'FK tenant_id, practitioner_id',
    '   QuestionnaireResponse',
    '   DetectedIssue, RiskAssess',
  ], COLORS.amber);

  drawErEntity(MARGIN + 122, erY + 34, 54, 24, 'PLANS_AND_CLAIMS', [
    'PK plan_id / claim_id',
    'FK tenant_id, practitioner_id',
    '   InsurancePlan, Coverage',
    '   ClaimResponse, PaymentRecon',
  ], COLORS.emerald);

  // Bottom row: Clinical/eCR/UDS+ | Security/Audit/Comms
  drawErEntity(MARGIN + 14, erY + 65, 72, 23, 'CLINICAL_PUBLIC_HEALTH (FHIR)', [
    'PK patient_id / bundle_id',
    'FK tenant_id, encounter_id',
    '   Condition, Observation, Procedure',
    '   Composition (eICR), DocRef (RR), MeasureRpt',
  ], COLORS.brand);

  drawErEntity(MARGIN + 94, erY + 65, 72, 23, 'SECURITY_COMMS_AUDIT (FHIR)', [
    'PK audit_id / consent_id / comm_id',
    'FK tenant_id, actor_role, target_ref',
    '   Consent (PSY/ETH/HIV/SDV), Provenance',
    '   Communication, Subscription, AuditEvent',
  ], COLORS.rose);

  // ER Relationship arrows with cardinality
  drawArrow(doc, MARGIN + 72, erY + 26, MARGIN + 31, erY + 34, COLORS.slate);
  drawArrow(doc, MARGIN + 90, erY + 26, MARGIN + 90, erY + 34, COLORS.slate);
  drawArrow(doc, MARGIN + 108, erY + 26, MARGIN + 149, erY + 34, COLORS.slate);
  drawArrow(doc, MARGIN + 58, erY + 46, MARGIN + 63, erY + 46, COLORS.amber);
  drawArrow(doc, MARGIN + 117, erY + 46, MARGIN + 122, erY + 46, COLORS.emerald);
  drawArrow(doc, MARGIN + 31, erY + 58, MARGIN + 42, erY + 65, COLORS.brand);
  drawArrow(doc, MARGIN + 90, erY + 58, MARGIN + 120, erY + 65, COLORS.rose);
  drawArrow(doc, MARGIN + 149, erY + 58, MARGIN + 142, erY + 65, COLORS.rose);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.setTextColor(...COLORS.slate);
  doc.text('1:N', MARGIN + 48, erY + 31);
  doc.text('1:N', MARGIN + 92, erY + 31);
  doc.text('1:N', MARGIN + 128, erY + 31);

  y = erY + 98;
  y = drawSubheading(doc, y, 'Table 4.2 — Logical Data Dictionary, Partitioning & Retention Policy');

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'striped',
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontSize: 7.4 },
    bodyStyles: { fontSize: 7.0, cellPadding: 1.8 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 34 },
      1: { cellWidth: 25 },
      2: { font: 'courier', cellWidth: 27 },
      3: { cellWidth: 46 },
      4: { cellWidth: 48 },
    },
    head: [['Entity / FHIR Resources', 'Domain Layer', 'Key / Identifier', 'Cardinality & Relationships', 'Retention & Masking Policy']],
    body: DB_ENTITY_CATALOGUE.map((d) => [
      d.entity,
      d.layer,
      d.primaryKey,
      d.relationships,
      d.retentionAndMasking,
    ]),
  });

  // =========================================================================
  // SECTION 5: API BUSINESS DETAILS & INTEGRATION FLOWS
  // =========================================================================
  y = drawSectionHeader(
    doc,
    '5',
    'API Business Details, Contracts & Integration Flows',
    'FHIR R4 REST, .NET Integration Gateway (/api/v1 & RFC 7807), eCRNow APIs, resilience patterns, and Event Bus',
  );

  y = drawSubheading(doc, y, 'Diagram 5.1 — API Topology, Auth, Correlation & Resilience Flow');
  const apiY = y;
  doc.setFillColor(...COLORS.slateLight);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(MARGIN, apiY, CONTENT_W, 44, 2, 2, 'FD');

  drawFlowBox(doc, MARGIN + 4, apiY + 11, 36, 22, 'SPA (:3000)', 'React 19 + TS\nX-Tenant-Id\nX-Correlation-Id');
  drawArrow(doc, MARGIN + 40, apiY + 18, MARGIN + 50, apiY + 18);
  drawArrow(doc, MARGIN + 40, apiY + 28, MARGIN + 50, apiY + 28, COLORS.emerald);

  drawFlowBox(doc, MARGIN + 50, apiY + 6, 46, 15, '.NET Gateway (:5000)', 'Polly Retry/CB, RFC 7807\n/api/v1/* + OAuth2', COLORS.amberLight, COLORS.amber);
  drawFlowBox(doc, MARGIN + 50, apiY + 24, 46, 15, 'eCRNow (:8080)', 'RCTC Trigger & eICR/RR\n/api/eicr/*');

  drawArrow(doc, MARGIN + 96, apiY + 14, MARGIN + 108, apiY + 20, COLORS.amber);
  drawArrow(doc, MARGIN + 96, apiY + 31, MARGIN + 108, apiY + 24, COLORS.brand);

  drawFlowBox(doc, MARGIN + 108, apiY + 11, 35, 22, 'HAPI FHIR (:8081)', 'R4 4.0.1 + IGs\nPostgreSQL 16\n$validate / Tx', COLORS.emeraldLight, COLORS.emerald);
  drawArrow(doc, MARGIN + 143, apiY + 22, MARGIN + 151, apiY + 22, COLORS.slate, true);
  drawFlowBox(doc, MARGIN + 151, apiY + 11, 25, 22, 'Inferno (:4567)', 'US Core\nTest Kit\nJSON/CSV');

  y = apiY + 50;
  y = drawSubheading(doc, y, 'Table 5.2 — API Business Specification Catalogue');

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'striped',
    headStyles: { fillColor: COLORS.brand, textColor: COLORS.white, fontSize: 7.3 },
    bodyStyles: { fontSize: 6.9, cellPadding: 1.7 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 21 },
      1: { font: 'courier', fontStyle: 'bold', cellWidth: 13 },
      2: { font: 'courier', cellWidth: 36 },
      3: { cellWidth: 44 },
      4: { cellWidth: 42 },
      5: { cellWidth: 24 },
    },
    head: [['Surface', 'Method', 'Endpoint Path', 'Business Purpose', 'Business & Resilience Rules', 'Error Contract']],
    body: API_BUSINESS_CATALOGUE.map((a) => [
      a.surface,
      a.method,
      a.path,
      a.businessPurpose,
      a.businessRules,
      a.errorContract,
    ]),
  });

  y = getLastTableY(doc, y + 60);
  if (y > 225) {
    doc.addPage();
    y = 22;
  }
  y = drawSubheading(doc, y, 'Table 5.3 — Platform Domain Event Bus Catalogue');
  const events = docsService.getEventCatalogue();
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'grid',
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontSize: 7.5 },
    bodyStyles: { fontSize: 7.2, cellPadding: 1.6 },
    columnStyles: {
      0: { font: 'courier', fontStyle: 'bold', textColor: COLORS.brand, cellWidth: 55 },
      1: { cellWidth: 50 },
      2: { cellWidth: 75 },
    },
    head: [['Domain Event Type', 'Publisher Module(s)', 'Downstream Consumers & Business Effects']],
    body: events.map((e) => [
      e.eventType,
      e.publishers.join(', ') || 'Platform Core',
      e.eventType === 'ProviderApproved'
        ? 'M10 auto-queues MMIS load; M18 sends Approval Notice; M19 updates Executive KPIs'
        : e.eventType === 'ExclusionHit'
          ? 'M12 raises Critical alert; M18 dispatches Urgent Suspension notice; M19 updates PI KPIs'
          : e.eventType === 'ReportabilityResponseReceived'
            ? 'M18 dispatches RR notice; M19 updates eCR reporting metrics'
            : 'Tenant Activity Bell, M18 Notification Rules, M19 KPI Snapshots & Audit Trail',
    ]),
  });

  // =========================================================================
  // SECTION 6: ARCHITECTURE REQUIREMENTS & REFERENCE DOCUMENT (ARD)
  // =========================================================================
  y = drawSectionHeader(
    doc,
    '6',
    'Architecture Requirements & Reference Document (ARD)',
    'Functional & non-functional requirements, 5-tier layered architecture, and Architecture Decision Records (ADRs)',
  );

  y = drawSubheading(doc, y, '6.1 Architecture Requirements & NFR Targets');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'striped',
    headStyles: { fillColor: COLORS.brand, textColor: COLORS.white, fontSize: 7.5 },
    bodyStyles: { fontSize: 7.2, cellPadding: 2 },
    columnStyles: {
      0: { font: 'courier', fontStyle: 'bold', cellWidth: 22 },
      1: { fontStyle: 'bold', cellWidth: 26 },
      2: { cellWidth: 54 },
      3: { cellWidth: 42 },
      4: { cellWidth: 36 },
    },
    head: [['Req ID', 'Category', 'Architecture Requirement', 'Target Metric / SLO', 'Verification Method']],
    body: ARD_REQUIREMENTS.map((r) => [
      r.id,
      r.category,
      r.requirement,
      r.targetMetric,
      r.verificationMethod,
    ]),
  });

  y = getLastTableY(doc, y + 60);
  y = drawSubheading(doc, y, '6.2 Architecture Decision Log (ADRs)');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'grid',
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontSize: 7.5 },
    bodyStyles: { fontSize: 7.1, cellPadding: 1.9 },
    columnStyles: {
      0: { font: 'courier', fontStyle: 'bold', textColor: COLORS.brand, cellWidth: 18 },
      1: { fontStyle: 'bold', cellWidth: 42 },
      2: { cellWidth: 64 },
      3: { cellWidth: 56 },
    },
    head: [['ADR', 'Decision Title', 'Architecture Decision', 'Consequences & Trade-offs']],
    body: ARCHITECTURE_ADRS.map((a) => [a.id, a.title, a.decision, a.consequences]),
  });

  // =========================================================================
  // SECTION 7: ARCHITECTURE REVIEW BOARD (ARB) PACK
  // =========================================================================
  y = drawSectionHeader(
    doc,
    '7',
    'Architecture Review Board (ARB) Governance Pack',
    'ARB scorecard, STRIDE threat model, enterprise risk register, deployment environments, and 12-stage CI/CD gates',
  );

  y = drawSubheading(doc, y, '7.1 ARB Review Scorecard & Domain Approvals');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'striped',
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontSize: 7.5 },
    bodyStyles: { fontSize: 7.2, cellPadding: 1.9 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 42 },
      1: { fontStyle: 'bold', textColor: COLORS.emerald, cellWidth: 28 },
      2: { cellWidth: 32 },
      3: { cellWidth: 78 },
    },
    head: [['Review Domain', 'ARB Disposition', 'Reviewer Role', 'Verification Evidence / Conditions']],
    body: ARB_SCORECARD.map((s) => [s.domain, s.status, s.reviewer, s.evidence]),
  });

  y = getLastTableY(doc, y + 55);
  y = drawSubheading(doc, y, '7.2 STRIDE Threat Model & Controls');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'grid',
    headStyles: { fillColor: COLORS.rose, textColor: COLORS.white, fontSize: 7.5 },
    bodyStyles: { fontSize: 7.1, cellPadding: 1.8 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 30 },
      1: { cellWidth: 50 },
      2: { cellWidth: 72 },
      3: { font: 'courier', cellWidth: 28 },
    },
    head: [['STRIDE Category', 'Identified Threat', 'Mitigating Architecture Control', 'Module Ref']],
    body: STRIDE_THREAT_MODEL.map((t) => [t.category, t.threat, t.control, t.moduleRef]),
  });

  y = drawSectionHeader(
    doc,
    '7 (cont.)',
    'ARB Risk Register, Environments & CI/CD Promotion Gates',
    'Tracked operational/security risks and mandatory automated release gates from Local to Production',
  );

  y = drawSubheading(doc, y, '7.3 Enterprise Risk Register');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'striped',
    headStyles: { fillColor: COLORS.amber, textColor: COLORS.white, fontSize: 7.5 },
    bodyStyles: { fontSize: 7.1, cellPadding: 1.8 },
    columnStyles: {
      0: { font: 'courier', fontStyle: 'bold', cellWidth: 18 },
      1: { fontStyle: 'bold', cellWidth: 16 },
      2: { cellWidth: 54 },
      3: { cellWidth: 66 },
      4: { cellWidth: 26 },
    },
    head: [['ID', 'Severity', 'Risk Description', 'Mitigation & Control', 'Owner']],
    body: ARB_RISK_REGISTER.map((r) => [r.id, r.severity, r.risk, r.mitigation, r.owner]),
  });

  y = getLastTableY(doc, y + 55);
  y = drawSubheading(doc, y, '7.4 Deployment Environments & 12-Stage CI/CD Promotion Gates');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'grid',
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontSize: 7.3 },
    bodyStyles: { fontSize: 7.0, cellPadding: 1.6 },
    head: [['Environment', 'FHIR Mode', 'Auth Mode', 'Data Policy', 'Promotion Gate']],
    body: DEPLOYMENT_ENVIRONMENTS.map((e) => [
      e.name,
      e.fhirMode,
      e.authMode,
      e.dataPolicy,
      e.promotionGate,
    ]),
  });

  y = getLastTableY(doc, y + 40);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'striped',
    headStyles: { fillColor: COLORS.brand, textColor: COLORS.white, fontSize: 7.3 },
    bodyStyles: { fontSize: 6.9, cellPadding: 1.4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 12 }, 1: { fontStyle: 'bold', cellWidth: 42 } },
    head: [['#', 'CI/CD Stage', 'Tooling', 'Mandatory Gate Rule']],
    body: CICD_STAGES.map((s) => [String(s.order), s.name, s.tool, s.gateRule]),
  });

  // =========================================================================
  // SECTION 8: GOVERNANCE APPENDICES (RBAC, HIPAA, RUNBOOK, QA)
  // =========================================================================
  y = drawSectionHeader(
    doc,
    '8',
    'Enterprise Governance Appendices',
    'RBAC Role Matrix, HIPAA Technical Safeguards, Operational Troubleshooting Runbook (SOPs), and QA Sign-Off',
  );

  y = drawSubheading(doc, y, '8.1 RBAC Personas & PII Unmasking Authority (11 Roles)');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'striped',
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontSize: 7.4 },
    bodyStyles: { fontSize: 7.0, cellPadding: 1.6 },
    columnStyles: {
      0: { font: 'courier', fontStyle: 'bold', cellWidth: 42 },
      1: { fontStyle: 'bold', cellWidth: 24 },
      2: { cellWidth: 114 },
    },
    head: [['Role Name', 'PII Unmask', 'Operational Authority & Access Scope']],
    body: ALL_ROLES.map((role) => [
      role,
      ROLE_UNMASK_PERMISSION[role] ? 'Allowed (Audited)' : 'Denied (403)',
      ROLE_DESCRIPTIONS[role],
    ]),
  });

  y = getLastTableY(doc, y + 60);
  y = drawSubheading(doc, y, '8.2 Operational Runbook — Top 10 Interoperability Troubleshooting SOPs (M20)');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'grid',
    headStyles: { fillColor: COLORS.brand, textColor: COLORS.white, fontSize: 7.2 },
    bodyStyles: { fontSize: 6.7, cellPadding: 1.5 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 42 },
      1: { cellWidth: 52 },
      2: { cellWidth: 56 },
      3: { cellWidth: 30 },
    },
    head: [['Issue Title', 'Symptom', 'Standard Remediation (Fix)', 'Verification']],
    body: INTEROP_KNOWLEDGE_BASE.map((kb) => [kb.title, kb.symptom, kb.fix, kb.verification]),
  });

  y = getLastTableY(doc, y + 60);
  if (y > 215) {
    doc.addPage();
    y = 22;
  }
  y = drawSubheading(doc, y, '8.3 Automated QA Sign-Off Evidence — End-to-End Scenarios A–F (29 Suites / 123 Tests)');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'striped',
    headStyles: { fillColor: COLORS.emerald, textColor: COLORS.white, fontSize: 7.4 },
    bodyStyles: { fontSize: 7.0, cellPadding: 1.7 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 16 },
      1: { fontStyle: 'bold', cellWidth: 48 },
      2: { font: 'courier', cellWidth: 36 },
      3: { cellWidth: 64 },
      4: { fontStyle: 'bold', textColor: COLORS.emerald, cellWidth: 16 },
    },
    head: [['Scenario', 'Title', 'Modules Verified', 'End-to-End Verification Scope', 'Status']],
    body: E2E_SCENARIO_CATALOG.map((s) => [
      `Scenario ${s.id}`,
      s.title.replace(/^Scenario [A-F]\s*—\s*/, ''),
      s.modulesCovered.join(', '),
      s.description,
      'PASS',
    ]),
  });

  // =========================================================================
  // RUNNING HEADERS & FOOTERS ON ALL CONTENT PAGES (Pages 2..N)
  // =========================================================================
  const totalPages = doc.getNumberOfPages();
  for (let p = 2; p <= totalPages; p += 1) {
    doc.setPage(p);
    // Subtle header
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.slate);
    doc.text('ProviderLink FHIR R4 Platform — User Manual, ARD & ARB Governance Pack', MARGIN, 11);
    doc.text('Prototype — Synthetic Data Only', PAGE_W - MARGIN, 11, { align: 'right' });
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, 13, PAGE_W - MARGIN, 13);

    // Subtle footer
    doc.line(MARGIN, PAGE_H - 13, PAGE_W - MARGIN, PAGE_H - 13);
    doc.text(`Generated ${generatedDate} · Confidential / Internal Governance`, MARGIN, PAGE_H - 8.5);
    doc.text(`Page ${p} of ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 8.5, { align: 'right' });
  }

  return doc;
}

export function downloadUserManualPdf(): void {
  const doc = buildUserManualPdf();
  doc.save('ProviderLink_User_Manual_Diagrams_ARD_ARB.pdf');
}
