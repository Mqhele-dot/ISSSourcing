import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ExceptionsView, HomeView, IntegrationsView, LoginView, Navbar } from './views';
import { InventoryDetailPage } from './pages/InventoryDetailPage';
import { InventoryPage } from './pages/InventoryPage';
import { LogisticsDetailPage } from './pages/LogisticsDetailPage';
import { LogisticsPage } from './pages/LogisticsPage';
import { PurchaseDetailPage } from './pages/PurchaseDetailPage';
import { PurchasePage } from './pages/PurchasePage';
import { ExceptionDetailPage } from './pages/ExceptionDetailPage';

type Role = 'Planner' | 'Ops' | 'Admin';

class ErrorBoundary extends React.Component<{ children: JSX.Element }, { error: string | null }> {
  constructor(props: { children: JSX.Element }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }

  render() {
    if (this.state.error) {
      return <div><h2>UI crashed</h2><p>{this.state.error}</p><p>Open Dev Debug panel for API traces.</p></div>;
    }
    return this.props.children;
  }
}

function PageMountedBanner() {
  return <header><small>Page mounted</small></header>;
}

function Guard({ role, allowed, children }: { role: Role | null; allowed: Role[]; children: JSX.Element }) {
  const token = sessionStorage.getItem('sct_token');
  if (!token) return <Navigate to="/login" replace />;
  if (!role || !allowed.includes(role)) return <div>Forbidden</div>;
  return children;
}

function WithNav({ children }: { children: JSX.Element }) { return <div><Navbar /><PageMountedBanner />{children}</div>; }

function App() {
  const [role, setRole] = useState<Role | null>((sessionStorage.getItem('sct_role') as Role | null) ?? null);

  return (
    <HashRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<LoginView onLogin={setRole} />} />
          <Route path="/" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><HomeView /></Guard>} />
          <Route path="/inventory" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><InventoryPage /></WithNav></Guard>} />
          <Route path="/inventory/:sku" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><InventoryDetailPage /></WithNav></Guard>} />
          <Route path="/purchase" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><PurchasePage /></WithNav></Guard>} />
          <Route path="/purchase/:po_number" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><PurchaseDetailPage /></WithNav></Guard>} />
          <Route path="/logistics" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><LogisticsPage /></WithNav></Guard>} />
          <Route path="/logistics/:shipment_id" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><LogisticsDetailPage /></WithNav></Guard>} />
          <Route path="/integrations" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><IntegrationsView /></Guard>} />
          <Route path="/exceptions" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><ExceptionsView /></Guard>} />
          <Route path="/exceptions/:exception_id" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><WithNav><ExceptionDetailPage /></WithNav></Guard>} />
        </Routes>
      </ErrorBoundary>
    </HashRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
