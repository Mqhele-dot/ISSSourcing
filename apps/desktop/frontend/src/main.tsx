import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { HomeView, IntegrationsView, InventoryView, LogisticsView, PurchaseView, ExceptionsView, LoginView } from './views';

type Role = 'Planner' | 'Ops' | 'Admin';

function Guard({ role, allowed, children }: { role: Role | null; allowed: Role[]; children: JSX.Element }) {
  if (!role) return <Navigate to="/login" replace />;
  if (!allowed.includes(role)) return <div>Forbidden</div>;
  return children;
}

function App() {
  const [role, setRole] = useState<Role | null>(null);
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginView onLogin={setRole} />} />
        <Route path="/" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><HomeView /></Guard>} />
        <Route path="/inventory" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><InventoryView /></Guard>} />
        <Route path="/purchase" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><PurchaseView /></Guard>} />
        <Route path="/logistics" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><LogisticsView /></Guard>} />
        <Route path="/integrations" element={<Guard role={role} allowed={['Ops', 'Admin']}><IntegrationsView /></Guard>} />
        <Route path="/exceptions" element={<Guard role={role} allowed={['Planner', 'Ops', 'Admin']}><ExceptionsView /></Guard>} />
      </Routes>
    </HashRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
