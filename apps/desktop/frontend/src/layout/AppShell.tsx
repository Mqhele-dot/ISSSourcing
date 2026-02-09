import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { API_BASE, fetchHealth } from '../api';
import { getApiErrors, subscribeApiErrors, ApiErrorEntry } from '../state/apiErrors';
import { Select, Button, Badge } from '../components/ui';
import { useTheme } from '../theme/ThemeProvider';

export function AppShell({ children }: { children: JSX.Element }) {
  const [apiStatus, setApiStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [lastError, setLastError] = useState<ApiErrorEntry | null>(getApiErrors()[0] ?? null);
  const [debugOpen, setDebugOpen] = useState(false);
  const { theme, accent, setTheme, setAccent } = useTheme();
  const location = useLocation();
  const pageTitle = useMemo(() => location.pathname.split('/')[1] || 'home', [location.pathname]);

  useEffect(() => {
    const ping = async () => {
      try { await fetchHealth(); setApiStatus('connected'); } catch { setApiStatus('disconnected'); }
    };
    void ping();
    const id = window.setInterval(ping, 5000);
    const unsub = subscribeApiErrors(() => setLastError(getApiErrors()[0] ?? null));
    return () => { window.clearInterval(id); unsub(); };
  }, []);

  const onLogout = () => {
    sessionStorage.removeItem('sct_token');
    sessionStorage.removeItem('sct_role');
    sessionStorage.removeItem('sct_username');
    window.location.hash = '#/login';
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">SupplyChain Control Tower</div>
        {[
          ['/', 'Overview'], ['/inventory', 'Inventory'], ['/purchase', 'Purchase'], ['/logistics', 'Logistics'],
          ['/exceptions', 'Exceptions'], ['/integrations', 'Integrations'], ['/settings', 'Settings'],
        ].map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>{label}</NavLink>)}
        <div style={{ marginTop: 16 }}><Badge tone={apiStatus === 'connected' ? 'success' : 'danger'}>API {apiStatus}</Badge></div>
      </aside>

      <main className="main-wrap">
        <header className="topbar">
          <div>
            <div className="muted">Page</div>
            <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{pageTitle}</h2>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" placeholder="Search" style={{ width: 180 }} />
            <Select value={theme} onChange={(e) => setTheme(e.target.value as any)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></Select>
            <Select value={accent} onChange={(e) => setAccent(e.target.value as any)}><option value="ocean">Ocean</option><option value="mango">Mango</option><option value="violet">Violet</option><option value="emerald">Emerald</option><option value="crimson">Crimson</option></Select>
            <Button onClick={() => setDebugOpen((v) => !v)}>{debugOpen ? 'Hide Debug' : 'Show Debug'}</Button>
            <Button variant="danger" onClick={onLogout}>Logout</Button>
          </div>
        </header>

        <section style={{ marginTop: 12 }}>
          <div className="card" style={{ marginBottom: 12 }}>
            <strong>API_BASE</strong>: {API_BASE} | <strong>Status</strong>: {apiStatus}
            {lastError ? <div><strong>Last fetch</strong>: {lastError.url ?? lastError.route} ({lastError.status ?? 'network'})</div> : null}
          </div>
          {debugOpen ? <div className="card"><h4>Dev Debug</h4>{getApiErrors().slice(0, 10).map((e, i) => <div key={i}><small>{e.time} | {e.url ?? e.route} | {e.status ?? 'network'} | {e.message}</small></div>)}</div> : null}
          {children}
        </section>
      </main>
    </div>
  );
}
