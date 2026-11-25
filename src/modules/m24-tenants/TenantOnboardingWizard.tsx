import { useState } from 'react';
import { CheckCircle2, Play, RotateCcw, ShieldAlert } from 'lucide-react';
import {
  Button,
  Input,
  Select,
  SemanticStatus,
  Stepper,
  TextArea,
  useToast,
} from '../../components';
import { useAuth } from '../../app/AuthContext';
import { ALL_ROLES } from '../../app/rbac';
import { settingsService } from '../../services';
import {
  buildDefaultTenantDraft,
  tenantService,
  type ProgramTemplate,
  type ProvisioningStepLog,
  type TenantRecord,
  type TenantType,
} from '../../tenancy';

const WIZARD_STEPS = [
  { id: 'profile', label: 'Profile' },
  { id: 'program', label: 'Program' },
  { id: 'branding', label: 'Branding' },
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'identity', label: 'Identity' },
  { id: 'roles', label: 'Roles' },
  { id: 'rules', label: 'Rules' },
  { id: 'validators', label: 'Validators' },
  { id: 'codesets', label: 'Code Sets' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'flags', label: 'Flags' },
  { id: 'review', label: 'Review & Provision' },
];

interface TenantOnboardingWizardProps {
  onProvisioned: (tenant: TenantRecord) => void;
  onCancel: () => void;
}

export function TenantOnboardingWizard({
  onProvisioned,
  onCancel,
}: TenantOnboardingWizardProps) {
  const { user } = useAuth();
  const { notify } = useToast();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<
    Omit<TenantRecord, 'id' | 'createdAt' | 'updatedAt'>
  >(() =>
    buildDefaultTenantDraft('Medicaid FFS', {
      code: '',
      legalName: '',
    }),
  );
  const [endpointTests, setEndpointTests] = useState<
    Record<string, { ok: boolean; latencyMs: number; message: string }>
  >({});
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [stepLogs, setStepLogs] = useState<ProvisioningStepLog[]>([]);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [simulateFailure, setSimulateFailure] = useState(false);

  const validation = tenantService.validateWizardDraft(draft);
  const dryRun = tenantService.buildDryRun(draft);

  const handleProgramChange = (program: ProgramTemplate) => {
    const template = buildDefaultTenantDraft(program, {
      code: draft.code,
      legalName: draft.legalName,
      timezone: draft.timezone,
      locale: draft.locale,
      dataRegion: draft.dataRegion,
      contacts: draft.contacts,
    });
    setDraft(template);
  };

  const handleTestEndpoint = async (key: string, label: string, url: string) => {
    setTestingEndpoint(key);
    const mode = settingsService.load().fhirMode;
    const res = await tenantService.testEndpointConnection(label, url, mode);
    setEndpointTests((prev) => ({ ...prev, [key]: res }));
    setTestingEndpoint(null);
  };

  const handleProvision = async () => {
    setProvisioning(true);
    setProvisionError(null);
    try {
      const res = await tenantService.provisionTenant(
        draft,
        { name: user.name, role: user.role },
        simulateFailure ? { simulateFailureAtStep: 2 } : undefined,
      );
      setStepLogs(res.steps);
      notify({
        title: `Tenant ${res.tenant.code} provisioned`,
        description: 'Partition initialized, reference data seeded, and AuditEvent recorded.',
        variant: 'success',
      });
      onProvisioned(res.tenant);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Provisioning failed.';
      setProvisionError(message);
      if (err && typeof err === 'object' && 'rawOutcome' in err && Array.isArray((err as { rawOutcome?: unknown }).rawOutcome)) {
        setStepLogs((err as { rawOutcome: ProvisioningStepLog[] }).rawOutcome);
      }
      notify({
        title: 'Provisioning failed & rolled back',
        description: message,
        variant: 'error',
      });
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            12-Step Tenant Onboarding Wizard
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Step {step + 1} of 12 · {WIZARD_STEPS[step].label}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel wizard
        </Button>
      </div>

      <Stepper
        steps={WIZARD_STEPS}
        currentStepIndex={step}
        onStepClick={(idx) => setStep(idx)}
      />

      {/* Step 1: Profile */}
      {step === 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label="Legal Name"
            required
            value={draft.legalName}
            placeholder="e.g. Pacific Coast Medicaid Authority"
            error={draft.legalName ? validation.errors.legalName : undefined}
            onChange={(e) => setDraft({ ...draft, legalName: e.target.value })}
          />
          <Input
            label="Tenant Code (URL slug)"
            required
            value={draft.code}
            placeholder="e.g. pacific-medicaid-c"
            hint="Lowercase alphanumeric and hyphens only"
            error={draft.code ? validation.errors.code : undefined}
            onChange={(e) =>
              setDraft({ ...draft, code: e.target.value.toLowerCase().trim() })
            }
          />
          <Select
            label="Tenant Type"
            value={draft.type}
            options={[
              { value: 'State Medicaid agency', label: 'State Medicaid agency' },
              { value: 'Health plan', label: 'Health plan' },
              { value: 'Health center', label: 'Health center' },
              { value: 'Vendor', label: 'Vendor' },
            ]}
            onChange={(e) =>
              setDraft({ ...draft, type: e.target.value as TenantType })
            }
          />
          <Select
            label="Timezone"
            value={draft.timezone}
            options={[
              { value: 'America/New_York', label: 'America/New_York (ET)' },
              { value: 'America/Chicago', label: 'America/Chicago (CT)' },
              { value: 'America/Denver', label: 'America/Denver (MT)' },
              { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PT)' },
            ]}
            onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
          />
          <Input
            label="Data Region"
            value={draft.dataRegion}
            onChange={(e) => setDraft({ ...draft, dataRegion: e.target.value })}
          />
          <Input
            label="Primary Admin Contact Email"
            required
            value={draft.contacts[0]?.email ?? ''}
            error={validation.errors.contactEmail}
            onChange={(e) =>
              setDraft({
                ...draft,
                contacts: [
                  { ...(draft.contacts[0] ?? { name: 'Admin', role: 'TenantAdmin', phone: '' }), email: e.target.value },
                ],
              })
            }
          />
        </div>
      )}

      {/* Step 2: Program Template */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Select a baseline program template. This pre-populates program-layer
            SLA days, revalidation cycles, fee rules, provider types, and code sets.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {(['Medicaid FFS', 'Managed Care', 'Health Center UDS+'] as ProgramTemplate[]).map(
              (tpl) => {
                const selected = draft.programTemplate === tpl;
                return (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => handleProgramChange(tpl)}
                    className={`rounded-lg border p-4 text-left transition-colors ${
                      selected
                        ? 'border-brand-600 bg-brand-50/60 dark:border-brand-400 dark:bg-brand-900/30'
                        : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      {tpl}
                    </p>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      {tpl === 'Medicaid FFS'
                        ? 'State Medicaid agency rules, 30-day SLA, 60-month revalidation, $709 institutional fee.'
                        : tpl === 'Managed Care'
                          ? 'MCO network & credentialing focus, 21-day SLA, 36-month cycles, $0 fee.'
                          : 'FQHC clinical & UDS+ readiness defaults, 15-day SLA, HRSA checklists.'}
                    </p>
                  </button>
                );
              },
            )}
          </div>
        </div>
      )}

      {/* Step 3: Branding */}
      {step === 2 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label="Brand / Portal Wordmark"
            value={draft.branding.logoText}
            onChange={(e) =>
              setDraft({ ...draft, branding: { ...draft.branding, logoText: e.target.value } })
            }
          />
          <Input
            label="Primary Accent Hex Color"
            value={draft.branding.primaryColor}
            onChange={(e) =>
              setDraft({ ...draft, branding: { ...draft.branding, primaryColor: e.target.value } })
            }
          />
          <Input
            label="Support Email"
            value={draft.branding.supportEmail}
            onChange={(e) =>
              setDraft({ ...draft, branding: { ...draft.branding, supportEmail: e.target.value } })
            }
          />
          <Input
            label="Support Phone"
            value={draft.branding.supportPhone}
            onChange={(e) =>
              setDraft({ ...draft, branding: { ...draft.branding, supportPhone: e.target.value } })
            }
          />
          <Input
            label="Correspondence Template Header"
            value={draft.branding.templateHeader}
            onChange={(e) =>
              setDraft({ ...draft, branding: { ...draft.branding, templateHeader: e.target.value } })
            }
          />
          <Input
            label="Correspondence Template Footer"
            value={draft.branding.templateFooter}
            onChange={(e) =>
              setDraft({ ...draft, branding: { ...draft.branding, templateFooter: e.target.value } })
            }
          />
        </div>
      )}

      {/* Step 4: Endpoints with Test Connection */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Store vault references only (never raw client secrets). Click Test on
            each integration endpoint to verify reachability.
          </p>
          {(
            [
              ['fhirBase', 'FHIR Base', draft.endpoints.fhirBase],
              ['gatewayUrl', '.NET Integration Gateway', draft.endpoints.gatewayUrl],
              ['ecrNowUrl', 'eCRNow Service', draft.endpoints.ecrNowUrl],
              ['mmisUrl', 'MMIS Load Endpoint', draft.endpoints.mmisUrl],
              ['clearinghouseUrl', 'EDI Clearinghouse', draft.endpoints.clearinghouseUrl],
              ['publicHealthUrl', 'Public Health Agency (PHA)', draft.endpoints.publicHealthUrl],
            ] as const
          ).map(([fieldKey, label, val]) => {
            const testResult = endpointTests[fieldKey];
            return (
              <div
                key={fieldKey}
                className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-end dark:border-slate-800"
              >
                <div className="flex-1">
                  <Input
                    label={label}
                    value={val}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        endpoints: { ...draft.endpoints, [fieldKey]: e.target.value },
                      })
                    }
                  />
                  {testResult && (
                    <div className="mt-1.5 flex items-center gap-2 text-xs">
                      <SemanticStatus
                        label={testResult.ok ? `OK (${testResult.latencyMs}ms)` : 'Failed'}
                        tone={testResult.ok ? 'success' : 'danger'}
                      />
                      <span className="text-slate-600 dark:text-slate-400">
                        {testResult.message}
                      </span>
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  disabled={testingEndpoint === fieldKey}
                  onClick={() => handleTestEndpoint(fieldKey, label, val)}
                >
                  {testingEndpoint === fieldKey ? 'Testing...' : 'Test connection'}
                </Button>
              </div>
            );
          })}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select
              label="FHIR Auth Mode"
              value={draft.endpoints.authMode}
              options={[
                { value: 'none', label: 'None (Local / Mock)' },
                { value: 'bearer', label: 'Bearer Token (Session Memory)' },
                { value: 'smart-oauth2', label: 'SMART on FHIR / OAuth2' },
              ]}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  endpoints: {
                    ...draft.endpoints,
                    authMode: e.target.value as TenantRecord['endpoints']['authMode'],
                  },
                })
              }
            />
            <Input
              label="Vault Secret Reference"
              value={draft.endpoints.vaultSecretRef}
              hint="Vault URI only — never paste raw secrets here"
              onChange={(e) =>
                setDraft({
                  ...draft,
                  endpoints: { ...draft.endpoints, vaultSecretRef: e.target.value },
                })
              }
            />
          </div>
        </div>
      )}

      {/* Step 5: Identity */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="OIDC Issuer URL"
              value={draft.identity.oidcIssuer}
              onChange={(e) =>
                setDraft({ ...draft, identity: { ...draft.identity, oidcIssuer: e.target.value } })
              }
            />
            <Input
              label="OIDC Client ID"
              value={draft.identity.clientId}
              onChange={(e) =>
                setDraft({ ...draft, identity: { ...draft.identity, clientId: e.target.value } })
              }
            />
          </div>
          <Input
            label="Redirect URIs (comma-separated)"
            value={draft.identity.redirectUris.join(', ')}
            onChange={(e) =>
              setDraft({
                ...draft,
                identity: {
                  ...draft.identity,
                  redirectUris: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                },
              })
            }
          />
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              OIDC Group-to-Role Mappings
            </p>
            {draft.identity.groupToRoleMapping.map((m, idx) => (
              <div key={idx} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  aria-label={`OIDC group ${idx + 1}`}
                  value={m.group}
                  onChange={(e) => {
                    const next = [...draft.identity.groupToRoleMapping];
                    next[idx] = { ...m, group: e.target.value };
                    setDraft({ ...draft, identity: { ...draft.identity, groupToRoleMapping: next } });
                  }}
                />
                <Select
                  aria-label={`Mapped role ${idx + 1}`}
                  value={m.role}
                  options={ALL_ROLES.map((r) => ({ value: r, label: r }))}
                  onChange={(e) => {
                    const next = [...draft.identity.groupToRoleMapping];
                    next[idx] = { ...m, role: e.target.value as TenantRecord['identity']['groupToRoleMapping'][number]['role'] };
                    setDraft({ ...draft, identity: { ...draft.identity, groupToRoleMapping: next } });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 6: Roles & Permissions */}
      {step === 5 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Default 11-role RBAC permission matrix will be attached. Toggle optional
            tenant overrides below:
          </p>
          <div className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {(
              [
                ['ProviderUser', 'm3-directory', 'export', 'Allow ProviderUser to export Provider Directory CSV'],
                ['EnrollmentAnalyst', 'm8-determination', 'approve', 'Allow EnrollmentAnalyst to approve low-risk cases'],
                ['PlanManager', 'm22-provider-ops', 'delete', 'Allow PlanManager to remove stale roster links'],
              ] as const
            ).map(([role, modId, act, desc]) => {
              const checked = Boolean(draft.roleOverrides[role]?.[modId]?.[act]);
              return (
                <label
                  key={`${role}-${modId}-${act}`}
                  className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 text-sm"
                >
                  <div>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {role}
                    </span>
                    <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">
                      {desc}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        roleOverrides: {
                          ...draft.roleOverrides,
                          [role]: {
                            ...(draft.roleOverrides[role] ?? {}),
                            [modId]: {
                              ...(draft.roleOverrides[role]?.[modId] ?? {}),
                              [act]: e.target.checked,
                            },
                          },
                        },
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-brand-700"
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 7: Business Rules */}
      {step === 6 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label="Determination SLA (Days)"
            type="number"
            value={String(draft.businessRules.slaDays)}
            error={validation.errors.slaDays}
            onChange={(e) =>
              setDraft({
                ...draft,
                businessRules: {
                  ...draft.businessRules,
                  slaDays: Number(e.target.value),
                },
              })
            }
          />
          <Input
            label="Revalidation Cycle (Months)"
            type="number"
            value={String(draft.businessRules.revalidationMonths)}
            onChange={(e) =>
              setDraft({
                ...draft,
                businessRules: {
                  ...draft.businessRules,
                  revalidationMonths: Number(e.target.value),
                },
              })
            }
          />
          <Input
            label="Recredentialing Cycle (Months)"
            type="number"
            value={String(draft.businessRules.recredentialingMonths)}
            onChange={(e) =>
              setDraft({
                ...draft,
                businessRules: {
                  ...draft.businessRules,
                  recredentialingMonths: Number(e.target.value),
                },
              })
            }
          />
          <Input
            label="Institutional Application Fee (USD)"
            type="number"
            value={String(draft.businessRules.applicationFeeUsd)}
            onChange={(e) =>
              setDraft({
                ...draft,
                businessRules: {
                  ...draft.businessRules,
                  applicationFeeUsd: Number(e.target.value),
                },
              })
            }
          />
          <div className="md:col-span-2">
            <TextArea
              label="Configured Provider Types (comma-separated)"
              rows={2}
              value={draft.businessRules.providerTypes.join(', ')}
              error={validation.errors.providerTypes}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  businessRules: {
                    ...draft.businessRules,
                    providerTypes: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </div>
        </div>
      )}

      {/* Step 8: Validators & Monitors */}
      {step === 7 && (
        <div className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {draft.validators.map((val, idx) => (
            <div
              key={val.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={val.enabled}
                  onChange={(e) => {
                    const next = [...draft.validators];
                    next[idx] = { ...val, enabled: e.target.checked };
                    setDraft({ ...draft, validators: next });
                  }}
                />
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {val.name}
                </span>
              </label>
              <select
                aria-label={`${val.name} execution mode`}
                value={val.mode}
                onChange={(e) => {
                  const next = [...draft.validators];
                  next[idx] = { ...val, mode: e.target.value as 'Mock' | 'Gateway' };
                  setDraft({ ...draft, validators: next });
                }}
                className="h-8 rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="Mock">Mock</option>
                <option value="Gateway">Gateway</option>
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Step 9: Code Sets & Value Sets */}
      {step === 8 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-md border border-slate-200 p-4 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Taxonomy Codes ({draft.codeSets.taxonomies.length})
            </h3>
            <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
              {draft.codeSets.taxonomies.map((t) => (
                <li key={t.code} className="font-mono">
                  {t.code} — {t.display}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-slate-200 p-4 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              eCR Trigger Codes ({draft.codeSets.triggerCodes.length})
            </h3>
            <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
              {draft.codeSets.triggerCodes.map((c) => (
                <li key={c.code} className="font-mono">
                  {c.code} — {c.display}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Step 10: Notification Templates */}
      {step === 9 && (
        <div className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {draft.notificationTemplates.map((tpl, idx) => (
            <div
              key={tpl.eventType}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div>
                <p className="font-mono text-xs font-medium text-slate-900 dark:text-slate-100">
                  {tpl.eventType}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {tpl.subject} · Channel: {tpl.channel}
                </p>
              </div>
              <input
                type="checkbox"
                aria-label={`Enable ${tpl.eventType} template`}
                checked={tpl.enabled}
                onChange={(e) => {
                  const next = [...draft.notificationTemplates];
                  next[idx] = { ...tpl, enabled: e.target.checked };
                  setDraft({ ...draft, notificationTemplates: next });
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Step 11: Feature Flags */}
      {step === 10 && (
        <div className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {draft.featureFlags.map((flag, idx) => (
            <div
              key={flag.key}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {flag.label}
                </p>
                <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  {flag.key} · env: {flag.environment} · rollout: {flag.rolloutPercentage}%
                </p>
              </div>
              <input
                type="checkbox"
                aria-label={`Toggle ${flag.label}`}
                checked={flag.enabled}
                onChange={(e) => {
                  const next = [...draft.featureFlags];
                  next[idx] = { ...flag, enabled: e.target.checked };
                  setDraft({ ...draft, featureFlags: next });
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Step 12: Dry Run Review & Provision */}
      {step === 11 && (
        <div className="space-y-4">
          {!validation.valid && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-4 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
            >
              <p className="font-semibold">Fix validation issues before provisioning:</p>
              <ul className="mt-1 list-disc pl-5">
                {Object.values(validation.errors).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Dry Run Provisioning Plan
            </h3>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">FHIR Partition</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">
                  {dryRun.fhirPartition}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Initial Admin</dt>
                <dd className="text-slate-900 dark:text-slate-100">{dryRun.adminUser}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500 dark:text-slate-400">Resources to be created</dt>
                <dd className="mt-1 text-slate-800 dark:text-slate-200">
                  {dryRun.resourcesToSeed.join(' · ')}
                </dd>
              </div>
            </dl>
            {dryRun.warnings.length > 0 && (
              <div className="mt-3 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{dryRun.warnings.join(' ')}</span>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={simulateFailure}
              onChange={(e) => setSimulateFailure(e.target.checked)}
            />
            <span>Simulate step-2 failure to test automatic provisioning rollback</span>
          </label>

          {provisionError && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <span>{provisionError}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setSimulateFailure(false);
                  void handleProvision();
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Retry without failure</span>
              </Button>
            </div>
          )}

          {stepLogs.length > 0 && (
            <div className="rounded-md border border-slate-200 p-4 dark:border-slate-800">
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Provisioning Step Log
              </h4>
              <ul className="mt-2 space-y-2 text-xs">
                {stepLogs.map((log, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="text-slate-800 dark:text-slate-200">
                      {log.step}: {log.message}
                    </span>
                    <SemanticStatus
                      label={log.status}
                      tone={log.status === 'Completed' ? 'success' : 'danger'}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
        <Button
          variant="secondary"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          Previous
        </Button>
        {step < WIZARD_STEPS.length - 1 ? (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
            Next step
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!validation.valid || provisioning}
            onClick={() => void handleProvision()}
          >
            {provisioning ? (
              <span>Provisioning...</span>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Provision Tenant</span>
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
