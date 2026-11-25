import { Link } from 'react-router-dom';
import { ArrowLeft, Layers } from 'lucide-react';
import type { ModuleDefinition } from '../types';
import {
  ModuleStatusIndicator,
  PageHeader,
  TestStatusIndicator,
} from '../components';

interface ModulePlaceholderProps {
  module: ModuleDefinition;
}

export function ModulePlaceholder({ module }: ModulePlaceholderProps) {
  return (
    <div className="space-y-8">
      <PageHeader
        kicker={`${module.code} · ${module.group} · Phase ${module.phase}`}
        title={module.name}
        description={module.description}
        actions={
          <Link
            to="/build-status"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Build Status</span>
          </Link>
        }
      />

      <section
        aria-labelledby="module-schedule-heading"
        className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Layers
              className="h-4 w-4 text-brand-700 dark:text-brand-400"
              aria-hidden="true"
            />
            <h2
              id="module-schedule-heading"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Scheduled for Phase {module.phase}
            </h2>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
            <ModuleStatusIndicator status={module.status} />
            <span aria-hidden="true">·</span>
            <TestStatusIndicator
              status={module.tests.status}
              passed={module.tests.passed}
              total={module.tests.total}
            />
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          This route is registered and wired in the Phase 0 application shell.
          Full services, UI workflows, tenant rules, FHIR R4 operations, and
          automated unit tests for {module.code} will be implemented in Phase{' '}
          {module.phase}.
        </p>

        <dl className="mt-6 grid grid-cols-1 gap-6 border-t border-slate-200 pt-6 sm:grid-cols-2 lg:grid-cols-4 dark:border-slate-800">
          <div>
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Architecture layer
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
              {module.layer}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Dependencies
            </dt>
            <dd className="mt-1 font-mono text-xs text-slate-800 dark:text-slate-200">
              {module.dependencies.length > 0
                ? module.dependencies.join(', ')
                : 'None'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
              FHIR R4 resources
            </dt>
            <dd className="mt-1 text-xs leading-relaxed text-slate-800 dark:text-slate-200">
              {module.fhirResources.length > 0
                ? module.fhirResources.join(', ')
                : 'None (platform metadata)'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Events published
            </dt>
            <dd className="mt-1 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200">
              {module.eventsPublished.length > 0
                ? module.eventsPublished.join(', ')
                : 'None'}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
