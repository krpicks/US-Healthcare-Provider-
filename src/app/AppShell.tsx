import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  Bell,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Database,
  Menu,
  Moon,
  Sun,
  UserCheck,
  X,
} from 'lucide-react';
import { OfflineBanner, PrototypeBanner, SkipLink } from '../components';
import { eventBus, type PlatformEvent } from '../events';
import { settingsService } from '../services';
import { useTenantContext } from '../tenancy';
import type { RoleName } from '../types';
import { useAuth } from './AuthContext';
import { ALL_ROLES } from './rbac';
import { useTheme } from './ThemeContext';
import {
  MODULE_GROUPS,
  getModuleByRoute,
  getModulesByGroup,
} from './moduleRegistry';

export function AppShell() {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { activeTenant, availableTenants, setActiveTenantById } =
    useTenantContext();
  const { user, setRole } = useAuth();

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    settingsService.load().sidebarCollapsed,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [fhirMode, setFhirMode] = useState<'mock' | 'live'>(
    () => settingsService.load().fhirMode,
  );
  const [notifOpen, setNotifOpen] = useState(false);
  const [events, setEvents] = useState<PlatformEvent[]>(() =>
    eventBus.getHistory(activeTenant.id).slice(0, 20),
  );
  const [unreadCount, setUnreadCount] = useState(0);
  const notifContainerRef = useRef<HTMLDivElement | null>(null);

  const currentModule = getModuleByRoute(location.pathname);
  const isPlatformAdmin = user.role === 'PlatformAdmin';

  useEffect(() => {
    setMobileNavOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    return settingsService.subscribe(() => {
      setFhirMode(settingsService.load().fhirMode);
    });
  }, []);

  useEffect(() => {
    setEvents(eventBus.getHistory(activeTenant.id).slice(0, 20));
    setUnreadCount(0);
    return eventBus.subscribe('*', (evt) => {
      if (evt.tenantId !== activeTenant.id) {
        return;
      }
      setEvents((prev) => [evt, ...prev].slice(0, 20));
      setUnreadCount((c) => c + 1);
    });
  }, [activeTenant.id]);

  useEffect(() => {
    if (!mobileNavOpen && !notifOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
        setNotifOpen(false);
      }
    };
    const handleClickOutside = (event: MouseEvent) => {
      if (
        notifOpen &&
        notifContainerRef.current &&
        !notifContainerRef.current.contains(event.target as Node)
      ) {
        setNotifOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [mobileNavOpen, notifOpen]);

  const handleToggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      settingsService.save({ sidebarCollapsed: next });
      return next;
    });
  };

  const handleToggleNotifications = () => {
    setNotifOpen((prev) => {
      const next = !prev;
      if (next) {
        setUnreadCount(0);
      }
      return next;
    });
  };

  const renderNavSections = (compact: boolean) => (
    <nav
      aria-label="Primary module navigation"
      className="flex-1 overflow-y-auto px-3 py-4"
    >
      <div className="mb-5">
        {!compact && (
          <p className="px-2.5 pb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
            Overview
          </p>
        )}
        <div className="space-y-0.5">
          <NavLink
            to="/build-status"
            title="Build Status"
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
              }`
            }
          >
            <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!compact && <span className="truncate">Build Status</span>}
          </NavLink>
          <NavLink
            to="/test-report"
            title="Test Report (Scenarios A–F)"
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
              }`
            }
          >
            <ClipboardCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!compact && <span className="truncate">Test Report</span>}
          </NavLink>
        </div>
      </div>

      {MODULE_GROUPS.map((group) => {
        const items = getModulesByGroup(group);
        return (
          <div key={group} className="mb-5 last:mb-0">
            {!compact && (
              <p className="px-2.5 pb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                {group}
              </p>
            )}
            <ul className="space-y-0.5">
              {items.map((mod) => (
                <li key={mod.id}>
                  <NavLink
                    to={mod.route}
                    title={`${mod.code} ${mod.name}`}
                    className={({ isActive }) =>
                      `flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                        isActive
                          ? 'bg-brand-50 font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
                      }`
                    }
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-8 shrink-0 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {mod.code}
                      </span>
                      {!compact && (
                        <span className="truncate">{mod.shortName}</span>
                      )}
                    </span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <SkipLink />
      <PrototypeBanner />
      <OfflineBanner />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Navigated to{' '}
        {currentModule
          ? currentModule.name
          : location.pathname === '/test-report'
            ? 'Automated Test Report'
            : location.pathname === '/design-system'
              ? 'Design System'
              : 'ProviderLink Workspace'}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Desktop collapsible sidebar */}
        <aside
          aria-label="Workspace sidebar"
          className={`hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-all duration-150 lg:flex dark:border-slate-800 dark:bg-slate-900 ${
            sidebarCollapsed ? 'w-16' : 'w-64'
          }`}
        >
          <div className="flex h-14 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-800">
            {!sidebarCollapsed ? (
              <Link
                to="/build-status"
                className="truncate font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100"
              >
                ProviderLink
              </Link>
            ) : (
              <Link
                to="/build-status"
                aria-label="ProviderLink Home"
                className="mx-auto font-display text-base font-bold text-brand-700 dark:text-brand-400"
              >
                PL
              </Link>
            )}
            <button
              type="button"
              onClick={handleToggleSidebar}
              aria-label={
                sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
              }
              aria-expanded={!sidebarCollapsed}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          {renderNavSections(sidebarCollapsed)}
        </aside>

        {/* Mobile slide-over navigation drawer */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-40 flex lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
          >
            <div
              className="fixed inset-0 bg-slate-950/50"
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />
            <aside className="relative z-10 flex w-72 max-w-[85vw] flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
                <Link
                  to="/build-status"
                  className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100"
                >
                  ProviderLink
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation menu"
                  className="flex h-10 w-10 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              {renderNavSections(false)}
            </aside>
          </div>
        )}

        {/* Main workspace column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation menu"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </button>

              <nav
                aria-label="Breadcrumb"
                className="flex min-w-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-400"
              >
                <span className="hidden truncate font-medium text-slate-900 xl:inline dark:text-slate-100">
                  ProviderLink
                </span>
                <span className="hidden xl:inline" aria-hidden="true">
                  /
                </span>
                <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                  {currentModule
                    ? currentModule.shortName
                    : location.pathname === '/test-report'
                      ? 'Test Report'
                      : location.pathname === '/design-system'
                        ? 'Design System'
                        : 'Workspace'}
                </span>
              </nav>
            </div>

            <div className="flex shrink-0 items-center gap-2.5">
              {/* Environment indicator */}
              <div
                className="hidden items-center gap-1.5 text-xs text-slate-600 md:flex dark:text-slate-400"
                title={`FHIR Mode: ${fhirMode === 'mock' ? 'Mock' : 'Live'}`}
              >
                <Database
                  className="h-3.5 w-3.5 text-brand-700 dark:text-brand-400"
                  aria-hidden="true"
                />
                <span className="whitespace-nowrap font-medium">
                  {fhirMode === 'mock' ? 'Mock' : 'Live'}
                </span>
              </div>

              {/* Tenant switcher (PlatformAdmin only) or read-only tenant label */}
              {isPlatformAdmin ? (
                <div className="flex items-center gap-1.5">
                  <Building2
                    className="hidden h-3.5 w-3.5 text-slate-500 sm:block dark:text-slate-400"
                    aria-hidden="true"
                  />
                  <label htmlFor="header-tenant-switcher" className="sr-only">
                    Active tenant
                  </label>
                  <select
                    id="header-tenant-switcher"
                    value={activeTenant.id}
                    onChange={(e) => setActiveTenantById(e.target.value)}
                    className="h-9 max-w-[160px] rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {availableTenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.code} ({tenant.dataRegion})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="hidden items-center gap-1.5 text-xs text-slate-600 sm:flex dark:text-slate-400">
                  <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="font-mono whitespace-nowrap">
                    {activeTenant.code}
                  </span>
                </div>
              )}

              {/* Demo role switcher */}
              <div className="flex items-center gap-1.5">
                <UserCheck
                  className="hidden h-3.5 w-3.5 text-slate-500 sm:block dark:text-slate-400"
                  aria-hidden="true"
                />
                <label htmlFor="header-role-switcher" className="sr-only">
                  Demo user role
                </label>
                <select
                  id="header-role-switcher"
                  value={user.role}
                  onChange={(e) => setRole(e.target.value as RoleName)}
                  className="h-9 max-w-[165px] rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {/* Event-bus notification bell */}
              <div className="relative" ref={notifContainerRef}>
                <button
                  type="button"
                  onClick={handleToggleNotifications}
                  aria-label={
                    unreadCount > 0
                      ? `Tenant notifications, ${unreadCount} unread`
                      : 'Tenant notifications'
                  }
                  aria-expanded={notifOpen}
                  className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Bell className="h-4 w-4" aria-hidden="true" />
                  {unreadCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-700 px-1 font-mono text-[10px] font-semibold tabular-nums text-white dark:bg-brand-500"
                    >
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div
                    role="region"
                    aria-label="Recent tenant events"
                    className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2.5 dark:border-slate-800">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        Tenant Activity · {activeTenant.code}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                        {events.length} events
                      </span>
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                      {events.length === 0 ? (
                        <p className="px-3.5 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                          No domain events published for this tenant yet.
                        </p>
                      ) : (
                        events.map((evt) => (
                          <div key={evt.id} className="px-3.5 py-2.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                                {evt.type}
                              </span>
                              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                {evt.sourceModule}
                              </span>
                            </div>
                            <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {new Date(evt.timestamp).toLocaleTimeString()} ·{' '}
                              {evt.correlationId.slice(0, 14)}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Light / Dark mode toggle */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={
                  theme === 'dark'
                    ? 'Switch to light mode'
                    : 'Switch to dark mode'
                }
                aria-pressed={theme === 'dark'}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden xl:inline">Light</span>
                  </>
                ) : (
                  <>
                    <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden xl:inline">Dark</span>
                  </>
                )}
              </button>
            </div>
          </header>

          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8"
          >
            <div className="mx-auto max-w-7xl">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
