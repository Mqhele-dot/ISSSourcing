import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { ExceptionDetailPage } from './pages/ExceptionDetailPage';
import { InventoryDetailPage } from './pages/InventoryDetailPage';
import { InventoryPage } from './pages/InventoryPage';
import { LogisticsDetailPage } from './pages/LogisticsDetailPage';
import { LogisticsPage } from './pages/LogisticsPage';
import { PurchaseDetailPage } from './pages/PurchaseDetailPage';
import { PurchasePage } from './pages/PurchasePage';
import { ExceptionsView, HomeView, IntegrationsView, LoginView, Navbar } from './views';

type Role = 'Planner' | 'Ops' | 'Admin';

function PageMountedBanner() {
  return <header><small>Page mounted</small></header>;
}

function Guard({ role, allowed, children }: { role: Role | null; allowed: Role[]; children: JSX.Element }) {
  const token = sessionStorage.getItem('sct_token');
  if (!token) return <Navigate to="/login" replace />;
  if (token && !role) return <Navigate to="/login?message=session-refresh" replace />;
  if (!allowed.includes(role as Role)) return <div>Forbidden</div>;
  return children;
}

function WithNav({ children }: { children: JSX.Element }) {
  return <div><Navbar /><PageMountedBanner />{children}</div>;
}

function RouteBoundary({ children }: { children: JSX.Element }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

function App() {
  const initialRole = sessionStorage.getItem('sct_role') as Role | null;
  const [role, setRole] = useState<Role | null>(initialRole);

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<RouteBoundary><LoginView onLogin={setRole} /></RouteBoundary>} />
        <Route path="/" element={<RouteBoundary><HomeView /></RouteBoundary>} />
        <Route path="/inventory" element={<RouteBoundary><Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><InventoryPage /></WithNav></Guard></RouteBoundary>} />
        <Route path="/inventory/:sku" element={<RouteBoundary><Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><InventoryDetailPage /></WithNav></Guard></RouteBoundary>} />
        <Route path="/purchase" element={<RouteBoundary><Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><PurchasePage /></WithNav></Guard></RouteBoundary>} />
        <Route path="/purchase/:po_number" element={<RouteBoundary><Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><PurchaseDetailPage /></WithNav></Guard></RouteBoundary>} />
        <Route path="/logistics" element={<RouteBoundary><Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><LogisticsPage /></WithNav></Guard></RouteBoundary>} />
        <Route path="/logistics/:shipment_id" element={<RouteBoundary><Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><LogisticsDetailPage /></WithNav></Guard></RouteBoundary>} />
        <Route path="/integrations" element={<RouteBoundary><Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><IntegrationsView /></Guard></RouteBoundary>} />
        <Route path="/exceptions" element={<RouteBoundary><Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><ExceptionsView /></Guard></RouteBoundary>} />
        <Route path="/exceptions/:exception_id" element={<RouteBoundary><Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><ExceptionDetailPage /></WithNav></Guard></RouteBoundary>} />
      </Routes>
    </HashRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
