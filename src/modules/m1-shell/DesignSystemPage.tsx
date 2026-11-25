import { useState } from 'react';
import {
  Button,
  DataTable,
  DatePicker,
  Drawer,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  SemanticStatus,
  Skeleton,
  Stepper,
  Tabs,
  Timeline,
  useToast,
} from '../../components';

const SAMPLE_ROWS = [
  { id: '1', code: '99213', label: 'Office Visit Low', amount: 92.5, status: 'Active' },
  { id: '2', code: '99214', label: 'Office Visit Moderate', amount: 131.75, status: 'Active' },
  { id: '3', code: '87635', label: 'SARS-CoV-2 PCR Probe', amount: 51.31, status: 'Pending' },
];

export function DesignSystemPage() {
  const { notify } = useToast();
  const [tab, setTab] = useState('controls');
  const [step, setStep] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="M1 · Hidden Catalog Route (/design-system)"
        title="ProviderLink Design System"
        description="Accessible WCAG 2.1 AA component primitives shared across all 24 platform modules with full light and dark mode parity."
      />

      <Tabs
        activeTab={tab}
        onChange={setTab}
        tabs={[
          { id: 'controls', label: 'Buttons & Forms' },
          { id: 'tables', label: 'Tables & Timeline' },
          { id: 'overlays', label: 'Modals, Drawers & Skeletons' },
        ]}
      />

      {tab === 'controls' && (
        <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => notify({ title: 'Primary action fired', variant: 'success' })}>
              Primary Button
            </Button>
            <Button variant="secondary">Secondary Button</Button>
            <Button variant="ghost">Ghost Button</Button>
            <Button variant="danger">Danger Button</Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input label="Text Input" placeholder="Enter synthetic NPI..." hint="10-digit identifier" />
            <Select
              label="Select Control"
              options={[
                { value: 'ffs', label: 'Medicaid FFS' },
                { value: 'mco', label: 'Managed Care' },
              ]}
            />
            <DatePicker label="Effective Date" defaultValue="2026-11-24" />
          </div>

          <div className="flex flex-wrap items-center gap-5 pt-2">
            <SemanticStatus label="Active / Verified" tone="success" />
            <SemanticStatus label="Revalidation Due" tone="warning" />
            <SemanticStatus label="Exclusion Hit" tone="danger" />
            <SemanticStatus label="In Review" tone="info" />
          </div>

          <Stepper
            steps={[
              { id: 's1', label: 'Profile', completed: true },
              { id: 's2', label: 'Validation' },
              { id: 's3', label: 'Determination' },
            ]}
            currentStepIndex={step}
            onStepClick={setStep}
          />
        </div>
      )}

      {tab === 'tables' && (
        <div className="space-y-6">
          <DataTable
            rows={SAMPLE_ROWS}
            getRowKey={(r) => r.id}
            searchText={(r) => `${r.code} ${r.label}`}
            columns={[
              { key: 'code', header: 'CPT Code', sortable: true, sortValue: (r) => r.code, render: (r) => <span className="font-mono text-xs">{r.code}</span> },
              { key: 'label', header: 'Description', sortable: true, sortValue: (r) => r.label, render: (r) => r.label },
              { key: 'amount', header: 'Rate (USD)', align: 'right', sortable: true, sortValue: (r) => r.amount, render: (r) => <span className="font-mono">${r.amount.toFixed(2)}</span> },
              { key: 'status', header: 'Status', render: (r) => <SemanticStatus label={r.status} tone={r.status === 'Active' ? 'success' : 'warning'} /> },
            ]}
          />
          <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 text-sm font-semibold">Timeline</h2>
            <Timeline
              items={[
                { id: 't1', timestamp: '2026-11-24T10:15:00Z', title: 'Application Submitted', subtitle: 'QuestionnaireResponse created' },
                { id: 't2', timestamp: '2026-11-24T10:16:12Z', title: 'Automated Validation Passed', subtitle: 'NPI Luhn + OIG-LEIE clear' },
              ]}
            />
          </div>
        </div>
      )}

      {tab === 'overlays' && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => setModalOpen(true)}>Open Modal</Button>
            <Button onClick={() => setDrawerOpen(true)}>Open Drawer</Button>
            <Button onClick={() => notify({ title: 'Sample Toast', description: 'Accessible live region toast.', variant: 'info' })}>
              Trigger Toast
            </Button>
          </div>
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500">Skeleton loaders</p>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <EmptyState
            title="Empty state example"
            description="Used consistently when filters return zero rows or a new tenant starts cleanly."
            action={<Button variant="primary">Primary Action</Button>}
          />
          <Modal open={modalOpen} title="Example Modal" onClose={() => setModalOpen(false)} footer={<Button variant="primary" onClick={() => setModalOpen(false)}>Close</Button>}>
            <p className="text-sm text-slate-600 dark:text-slate-400">Keyboard Escape closes this dialog cleanly.</p>
          </Modal>
          <Drawer open={drawerOpen} title="Example Drawer" subtitle="Slide-over inspector" onClose={() => setDrawerOpen(false)}>
            <p className="text-sm text-slate-600 dark:text-slate-400">Used for FHIR JSON payloads and AuditEvent inspection.</p>
          </Drawer>
        </div>
      )}
    </div>
  );
}
