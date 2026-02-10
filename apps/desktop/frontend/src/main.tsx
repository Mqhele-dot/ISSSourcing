import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { AppShell } from './layout/AppShell';
import { ThemeProvider } from './theme/ThemeProvider';
import { SettingsPage } from './pages/SettingsPage';
import { ExceptionDetailPage } from './pages/ExceptionDetailPage';
import { InventoryDetailPage } from './pages/InventoryDetailPage';
import { InventoryPage } from './pages/InventoryPage';
import { LogisticsDetailPage } from './pages/LogisticsDetailPage';
import { LogisticsPage } from './pages/LogisticsPage';
import { PurchaseDetailPage } from './pages/PurchaseDetailPage';
import { PurchasePage } from './pages/PurchasePage';
import { ExceptionsView, HomeView, IntegrationsView, LoginView } from './views';
import './styles/theme.css';

type Role = 'Planner' | 'Ops' | 'Admin';

function Guard({ role, children }: { role: Role | null; children: JSX.Element }) {
  const token = sessionStorage.getItem('sct_token');
  if (!token) return <Navigate to="/login" replace />;
  if (token && !role) return <Navigate to="/login?message=session-refresh" replace />;
  return children;
}

function RouteBoundary({ children }: { children: JSX.Element }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

function App() {
  const initialRole = sessionStorage.getItem('sct_role') as Role | null;
  const [role, setRole] = useState<Role | null>(initialRole);

  const withShell = (node: JSX.Element) => <RouteBoundary><Guard role={role}><AppShell>{node}</AppShell></Guard></RouteBoundary>;

  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<RouteBoundary><LoginView onLogin={setRole} /></RouteBoundary>} />
          <Route path="/" element={withShell(<HomeView />)} />
          <Route path="/inventory" element={withShell(<InventoryPage />)} />
          <Route path="/inventory/:sku" element={withShell(<InventoryDetailPage />)} />
          <Route path="/purchase" element={withShell(<PurchasePage />)} />
          <Route path="/purchase/:po_number" element={withShell(<PurchaseDetailPage />)} />
          <Route path="/logistics" element={withShell(<LogisticsPage />)} />
          <Route path="/logistics/:shipment_id" element={withShell(<LogisticsDetailPage />)} />
          <Route path="/integrations" element={withShell(<IntegrationsView />)} />
          <Route path="/exceptions" element={withShell(<ExceptionsView />)} />
          <Route path="/exceptions/:exception_id" element={withShell(<ExceptionDetailPage />)} />
          <Route path="/settings" element={withShell(<SettingsPage />)} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
