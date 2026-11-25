import { Suspense, lazy, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ForbiddenPage } from './ForbiddenPage';
import { ModulePlaceholder } from './ModulePlaceholder';
import { MODULE_REGISTRY } from './moduleRegistry';
import { NotFoundPage } from './NotFoundPage';
import { BuildStatusPage } from '../modules/build-status';

// Lazy-loaded modules for code-splitting and optimal initial bundle performance
const TestReportPage = lazy(() =>
  import('../modules/test-report/TestReportPage').then((m) => ({
    default: m.TestReportPage,
  })),
);
const DesignSystemPage = lazy(() =>
  import('../modules/m1-shell/DesignSystemPage').then((m) => ({
    default: m.DesignSystemPage,
  })),
);
const SettingsAndAuditPage = lazy(() =>
  import('../modules/m1-shell/SettingsAndAuditPage').then((m) => ({
    default: m.SettingsAndAuditPage,
  })),
);
const FhirExplorerPage = lazy(() =>
  import('../modules/m2-fhir/FhirExplorerPage').then((m) => ({
    default: m.FhirExplorerPage,
  })),
);
const ProviderDirectoryPage = lazy(() =>
  import('../modules/m3-directory/ProviderDirectoryPage').then((m) => ({
    default: m.ProviderDirectoryPage,
  })),
);
const PatientExplorerPage = lazy(() =>
  import('../modules/m4-patients/PatientExplorerPage').then((m) => ({
    default: m.PatientExplorerPage,
  })),
);
const EnrollmentWizardPage = lazy(() =>
  import('../modules/m5-enrollment/EnrollmentWizardPage').then((m) => ({
    default: m.EnrollmentWizardPage,
  })),
);
const ValidationEnginePage = lazy(() =>
  import('../modules/m6-validation/ValidationEnginePage').then((m) => ({
    default: m.ValidationEnginePage,
  })),
);
const RiskScreeningPage = lazy(() =>
  import('../modules/m7-screening/RiskScreeningPage').then((m) => ({
    default: m.RiskScreeningPage,
  })),
);
const DeterminationPage = lazy(() =>
  import('../modules/m8-determination/DeterminationPage').then((m) => ({
    default: m.DeterminationPage,
  })),
);
const CredentialingPage = lazy(() =>
  import('../modules/m9-credentialing/CredentialingPage').then((m) => ({
    default: m.CredentialingPage,
  })),
);
const MmisEdiPage = lazy(() =>
  import('../modules/m10-mmis-edi/MmisEdiPage').then((m) => ({
    default: m.MmisEdiPage,
  })),
);
const ClaimsSimulationPage = lazy(() =>
  import('../modules/m11-claims/ClaimsSimulationPage').then((m) => ({
    default: m.ClaimsSimulationPage,
  })),
);
const MonitoringPage = lazy(() =>
  import('../modules/m12-monitoring/MonitoringPage').then((m) => ({
    default: m.MonitoringPage,
  })),
);
const EcrPage = lazy(() =>
  import('../modules/m13-ecr/EcrPage').then((m) => ({ default: m.EcrPage })),
);
const UdsReadinessPage = lazy(() =>
  import('../modules/m14-uds/UdsReadinessPage').then((m) => ({
    default: m.UdsReadinessPage,
  })),
);
const ConformancePage = lazy(() =>
  import('../modules/m15-conformance/ConformancePage').then((m) => ({
    default: m.ConformancePage,
  })),
);
const GatewayConsolePage = lazy(() =>
  import('../modules/m16-gateway/GatewayConsolePage').then((m) => ({
    default: m.GatewayConsolePage,
  })),
);
const SecurityCompliancePage = lazy(() =>
  import('../modules/m17-security/SecurityCompliancePage').then((m) => ({
    default: m.SecurityCompliancePage,
  })),
);
const NotificationsPage = lazy(() =>
  import('../modules/m18-notifications/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  })),
);
const AnalyticsPage = lazy(() =>
  import('../modules/m19-analytics/AnalyticsPage').then((m) => ({
    default: m.AnalyticsPage,
  })),
);
const DiagnosticsPage = lazy(() =>
  import('../modules/m20-diagnostics/DiagnosticsPage').then((m) => ({
    default: m.DiagnosticsPage,
  })),
);
const DocumentationPage = lazy(() =>
  import('../modules/m21-docs/DocumentationPage').then((m) => ({
    default: m.DocumentationPage,
  })),
);
const ProviderOperationsPage = lazy(() =>
  import('../modules/m22-provider-ops/ProviderOperationsPage').then((m) => ({
    default: m.ProviderOperationsPage,
  })),
);
const PlanManagementPage = lazy(() =>
  import('../modules/m23-plans/PlanManagementPage').then((m) => ({
    default: m.PlanManagementPage,
  })),
);
const TenantsPage = lazy(() =>
  import('../modules/m24-tenants/TenantsPage').then((m) => ({
    default: m.TenantsPage,
  })),
);

function RouteLoadingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[240px] items-center justify-center rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
    >
      Loading module workspace…
    </div>
  );
}

export const IMPLEMENTED_MODULE_PAGES: Record<string, ReactNode> = {
  'm24-tenants': <TenantsPage />,
  'm1-shell': <SettingsAndAuditPage />,
  'm2-fhir': <FhirExplorerPage />,
  'm3-directory': <ProviderDirectoryPage />,
  'm22-provider-ops': <ProviderOperationsPage />,
  'm23-plans': <PlanManagementPage />,
  'm4-patients': <PatientExplorerPage />,
  'm5-enrollment': <EnrollmentWizardPage />,
  'm6-validation': <ValidationEnginePage />,
  'm7-screening': <RiskScreeningPage />,
  'm8-determination': <DeterminationPage />,
  'm9-credentialing': <CredentialingPage />,
  'm10-mmis-edi': <MmisEdiPage />,
  'm11-claims': <ClaimsSimulationPage />,
  'm12-monitoring': <MonitoringPage />,
  'm13-ecr': <EcrPage />,
  'm14-uds': <UdsReadinessPage />,
  'm15-conformance': <ConformancePage />,
  'm16-gateway': <GatewayConsolePage />,
  'm17-security': <SecurityCompliancePage />,
  'm18-notifications': <NotificationsPage />,
  'm19-analytics': <AnalyticsPage />,
  'm20-diagnostics': <DiagnosticsPage />,
  'm21-docs': <DocumentationPage />,
};

export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/build-status" replace />} />
            <Route path="/build-status" element={<BuildStatusPage />} />
            <Route path="/test-report" element={<TestReportPage />} />
            <Route path="/design-system" element={<DesignSystemPage />} />
            <Route path="/403" element={<ForbiddenPage />} />
            {MODULE_REGISTRY.map((mod) => (
              <Route
                key={mod.id}
                path={mod.route}
                element={
                  IMPLEMENTED_MODULE_PAGES[mod.id] ?? (
                    <ModulePlaceholder module={mod} />
                  )
                }
              />
            ))}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
