import { useState } from 'react';
import {
  Copy,
  Download,
  GitBranch,
  Layers,
  Server,
  Terminal,
} from 'lucide-react';
import { Guard } from '../../app';
import {
  Button,
  PageHeader,
  SemanticStatus,
  Tabs,
  useToast,
} from '../../components';
import {
  ARCHITECTURE_ADRS,
  CICD_STAGES,
  DEPLOYMENT_ENVIRONMENTS,
  SETUP_GUIDES,
  SOLUTION_NODES,
  docsService,
} from './docsService';

export function DocumentationPage() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<'architecture' | 'catalogues' | 'setup' | 'adrs' | 'deploy' | 'export'>('architecture');

  const layers = docsService.getModulesByLayer();
  const events = docsService.getEventCatalogue();
  const fhirCat = docsService.getFhirResourceCatalogue();
  const { roles } = docsService.getPermissionMatrixSummary();
  const fullMarkdown = docsService.exportFullDocumentationMarkdown();

  const copyText = (text: string, label: string) => {
    void navigator.clipboard?.writeText(text);
    showToast(`Copied ${label} to clipboard.`, 'success');
  };

  return (
    <Guard moduleId="m21-docs" action="view">
      <div className="space-y-6">
        <PageHeader
          kicker="M21 · Architecture, Docs & Deployment"
          title="Documentation, Architecture Viewer & Deployment"
          description="Registry-driven layered and solution architecture diagrams, module/event/FHIR catalogues, copyable local setup guides (HAPI :8081, eCRNow :8080, .NET :5000, Inferno :4567), ADRs, 12-stage CI/CD summary, and unified Markdown export."
          actions={
            <Button
              onClick={() => {
                const blob = new Blob([fullMarkdown], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'ProviderLink-Architecture-Documentation.md';
                a.click();
                URL.revokeObjectURL(url);
                showToast('Exported complete documentation as Markdown.', 'success');
              }}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export All Docs (.md)
            </Button>
          }
        />

        <Tabs
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'architecture', label: 'Architecture Diagrams' },
            { id: 'catalogues', label: 'Events, FHIR & Roles' },
            { id: 'setup', label: 'Local Setup Guides' },
            { id: 'adrs', label: `ADRs (${ARCHITECTURE_ADRS.length})` },
            { id: 'deploy', label: 'Deployment & CI/CD' },
            { id: 'export', label: 'Markdown Export Preview' },
          ]}
        />

        {tab === 'architecture' && (
          <div className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <Server className="h-4 w-4 text-blue-600" aria-hidden="true" />
                Solution Integration Diagram
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {SOLUTION_NODES.map((node) => (
                  <div
                    key={node.id}
                    className="rounded-md border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {node.title}
                      </span>
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                        {node.port}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{node.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <Layers className="h-4 w-4 text-blue-600" aria-hidden="true" />
                Layered Architecture (Generated from MODULE_REGISTRY)
              </h2>
              {layers.map((layerGroup) => (
                <div
                  key={layerGroup.layer}
                  className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {layerGroup.layer}
                    </span>
                    <span className="text-xs text-slate-500">
                      {layerGroup.modules.length} module(s)
                    </span>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    {layerGroup.modules.map((m) => (
                      <div
                        key={m.id}
                        className="rounded border border-slate-200 p-2.5 text-xs dark:border-slate-800"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">
                            {m.code}
                          </span>
                          <SemanticStatus
                            tone={m.status === 'Completed' ? 'success' : 'info'}
                            label={m.status}
                          />
                        </div>
                        <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                          {m.shortName}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500">{m.route}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'catalogues' && (
          <div className="space-y-6">
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                  <tr>
                    <th className="px-4 py-3">Module</th>
                    <th className="px-4 py-3">Layer / Route</th>
                    <th className="px-4 py-3">Dependencies</th>
                    <th className="px-4 py-3">FHIR Resources</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {fhirCat.map((item) => (
                    <tr key={item.code}>
                      <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                        {item.code} · {item.name}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-300">
                        {item.layer} · {item.route}
                      </td>
                      <td className="px-4 py-2.5 font-mono">{item.dependencies.join(', ') || '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-blue-700 dark:text-blue-400">
                        {item.fhirResources.join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Platform Event Bus Catalogue ({events.length} Events)
                </h3>
                <ul className="mt-3 space-y-1.5 text-xs">
                  {events.map((e) => (
                    <li key={e.eventType} className="flex justify-between gap-2 border-b border-slate-100 pb-1 dark:border-slate-800">
                      <span className="font-mono font-semibold">{e.eventType}</span>
                      <span className="text-slate-500">{e.publishers.join(', ') || 'Core'}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  RBAC Role Catalogue ({roles.length} Roles Verified)
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Every module in MODULE_REGISTRY has explicit view/create/edit/approve/delete/export entries across all 11 roles.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {roles.map((r) => (
                    <span
                      key={r}
                      className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'setup' && (
          <div className="space-y-4">
            {SETUP_GUIDES.map((guide) => (
              <div
                key={guide.id}
                className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                    <Terminal className="h-4 w-4 text-blue-600" aria-hidden="true" />
                    {guide.title}
                  </h2>
                  <Button size="sm" variant="secondary" onClick={() => copyText(guide.snippet, guide.title)}>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    Copy Snippet
                  </Button>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">{guide.summary}</p>
                <pre className="overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-100">
                  {guide.snippet}
                </pre>
                <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300">
                  {guide.verificationSteps.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}

        {tab === 'adrs' && (
          <div className="space-y-3">
            {ARCHITECTURE_ADRS.map((adr) => (
              <div
                key={adr.id}
                className="rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {adr.id}: {adr.title}
                  </div>
                  <SemanticStatus tone="success" label={`${adr.status} · ${adr.date}`} />
                </div>
                <div className="mt-2 space-y-1 text-slate-600 dark:text-slate-300">
                  <div><strong>Context:</strong> {adr.context}</div>
                  <div><strong>Decision:</strong> {adr.decision}</div>
                  <div><strong>Consequences:</strong> {adr.consequences}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'deploy' && (
          <div className="space-y-6">
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                  <tr>
                    <th className="px-4 py-3">Environment</th>
                    <th className="px-4 py-3">FHIR Mode</th>
                    <th className="px-4 py-3">Auth Mode</th>
                    <th className="px-4 py-3">Data Policy</th>
                    <th className="px-4 py-3">Promotion Gate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {DEPLOYMENT_ENVIRONMENTS.map((env) => (
                    <tr key={env.name}>
                      <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">{env.name}</td>
                      <td className="px-4 py-2.5">{env.fhirMode}</td>
                      <td className="px-4 py-2.5">{env.authMode}</td>
                      <td className="px-4 py-2.5">{env.dataPolicy}</td>
                      <td className="px-4 py-2.5">{env.promotionGate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                <GitBranch className="h-4 w-4 text-blue-600" aria-hidden="true" />
                12-Stage CI/CD Quality &amp; Security Pipeline
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {CICD_STAGES.map((s) => (
                  <div
                    key={s.order}
                    className="rounded border border-slate-200 p-3 text-xs dark:border-slate-800"
                  >
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {s.order}. {s.name}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-blue-700 dark:text-blue-400">
                      {s.tool}
                    </div>
                    <div className="mt-1 text-slate-600 dark:text-slate-300">{s.gateRule}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'export' && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Unified Markdown Export Preview
              </h2>
              <Button size="sm" variant="secondary" onClick={() => copyText(fullMarkdown, 'Full Markdown Documentation')}>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy All
              </Button>
            </div>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-4 font-mono text-xs text-slate-800 dark:bg-slate-950 dark:text-slate-200">
              {fullMarkdown}
            </pre>
          </div>
        )}
      </div>
    </Guard>
  );
}
