import React, { useEffect, useState } from 'react';
import { fetchHealth } from './api';

export function LoginView({ onLogin }: { onLogin: (role: 'Planner' | 'Ops' | 'Admin') => void }) {
  const [role, setRole] = useState<'Planner' | 'Ops' | 'Admin'>('Planner');
  return <div><h2>SupplyChain Control Tower</h2><select value={role} onChange={(e) => setRole(e.target.value as 'Planner' | 'Ops' | 'Admin')}><option>Planner</option><option>Ops</option><option>Admin</option></select><button onClick={() => onLogin(role)}>Login (Demo)</button></div>;
}

export const HomeView = () => {
  const [status, setStatus] = useState('checking...');
  useEffect(() => {
    fetchHealth().then((h) => setStatus(`${h.status} (${h.service})`)).catch(() => setStatus('unreachable'));
  }, []);
  return <div><h3>Home Dashboard</h3><p>KPIs + activity feed</p><p>Backend health: <strong>{status}</strong></p></div>;
};

export const InventoryView = () => <div><h3>Inventory</h3></div>;
export const PurchaseView = () => <div><h3>Purchase</h3></div>;
export const LogisticsView = () => <div><h3>Logistics</h3></div>;
export const IntegrationsView = () => <div><h3>Integrations</h3></div>;
export const ExceptionsView = () => <div><h3>Exceptions / Cases</h3></div>;
