/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppRouter, AuthProvider, ErrorBoundary, ThemeProvider } from './app';
import { ToastProvider } from './components';
import { TenantProvider } from './tenancy';

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <TenantProvider>
          <AuthProvider>
            <ToastProvider>
              <AppRouter />
            </ToastProvider>
          </AuthProvider>
        </TenantProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
