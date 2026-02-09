import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConnectorRun, detectExceptions, ExceptionCase, fetchConnectorRuns, fetchExceptions, fetchHealth, loginDemo, runConnector } from './api';
import { ApiErrorEntry, getApiErrors, subscribeApiErrors } from './state/apiErrors';
import { LoginPrompt } from './pages/common';
import { can, currentRole, requiresText } from './utils/rbac';

function DevDebugPanel({ open }: { open: boolean }) {
  const [errors, setErrors] = useState<ApiErrorEntry[]>(getApiErrors());
  useEffect(() => subscribeApiErrors(() => setErrors(getApiErrors())), []);
  if (!import.meta.env.DEV || !open) return null;

  return (
    <details open>
      <summary>Dev Debug ({errors.length})</summary>
      {errors.length === 0 ? <p>No API errors recorded</p> : null}
      {errors.map((e, i) => <div key={i}><small>{e.time} | {e.route} | {e.status ?? 'network'} | {e.message}</small></div>)}
    </details>
  );
}

function HeaderStatusStrip() {
  const [apiStatus, setApiStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [lastError, setLastError] = useState<ApiErrorEntry | null>(getApiErrors()[0] ?? null);
  const loggedIn = Boolean(sessionStorage.getItem('sct_token'));

  useEffect(() => {
    const poll = async () => {
      try {
        await fetchHealth();
        setApiStatus('connected');
      } catch {
        setApiStatus('disconnected');
      }
    };
    void poll();
    const id = window.setInterval(poll, 5000);
    const unsub = subscribeApiErrors(() => setLastError(getApiErrors()[0] ?? null));
    return () => {
      window.clearInterval(id);
      unsub();
    };
  }, []);

  return (
    <div style={{ padding: '6px 10px', border: '1px solid #d1d5db', marginBottom: 8, background: '#f8fafc' }}>
      <strong>API:</strong> {apiStatus} | <strong>Auth:</strong> {loggedIn ? 'logged in' : 'not logged in'}
      {lastError ? <span> | <strong>Last API error:</strong> {lastError.route} ({lastError.status ?? 'network'}) {lastError.message}</span> : null}
    </div>
  );
}

export function Navbar() {
  const loggedIn = Boolean(sessionStorage.getItem('sct_token'));
  const [debugOpen, setDebugOpen] = useState(false);

  const onLogout = () => {
    sessionStorage.removeItem('sct_token');
    sessionStorage.removeItem('sct_role');
    sessionStorage.removeItem('sct_username');
    window.location.hash = '#/login';
  };

  return (
    <>
      <nav>
        <Link to="/">Home</Link> | <Link to="/login">Login</Link>
        {loggedIn ? (
          <>
            <span> | </span><Link to="/inventory">Inventory</Link>
            <span> | </span><Link to="/purchase">Purchase</Link>
            <span> | </span><Link to="/logistics">Logistics</Link>
            <span> | </span><Link to="/exceptions">Exceptions</Link>
            <span> | </span><Link to="/integrations">Integrations</Link>
            <span> | </span><button onClick={onLogout}>Logout</button>
          </>
        ) : null}
        {import.meta.env.DEV ? <><span> | </span><button onClick={() => setDebugOpen((v) => !v)}>Dev Debug</button></> : null}
      </nav>
      <HeaderStatusStrip />
      <DevDebugPanel open={debugOpen} />
    </>
  );
}

export function LoginView({ onLogin }: { onLogin: (role: 'Planner' | 'Ops' | 'Admin') => void }) {
  const [role, setRole] = useState<'Planner' | 'Ops' | 'Admin'>('Planner');
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    try {
      const token = await loginDemo(role);
      sessionStorage.setItem('sct_token', token);
      setError(null);
      onLogin(role);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'login failed');
    }
  };

  return <div><Navbar /><h2>SupplyChain Control Tower</h2><select value={role} onChange={(e) => setRole(e.target.value as 'Planner' | 'Ops' | 'Admin')}><option>Planner</option><option>Ops</option><option>Admin</option></select><button onClick={handleLogin}>Login (Demo)</button>{error ? <p>{error}</p> : null}</div>;
}

export const HomeView = () => {
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    fetchHealth().then((h) => setStatus(`${h.status} (${h.service})`)).catch((e: unknown) => setStatus(e instanceof Error ? e.message : 'unreachable'));
  }, []);

  return (
    <div>
      <Navbar />
      <h3>Home Dashboard</h3>
      <p>Backend health: <strong>{status}</strong></p>
      <section style={{ border: '1px solid #d1d5db', padding: 10 }}>
        <h4>Demo instructions</h4>
        <p>Go to <Link to="/login">Login</Link> → choose role → open Inventory / Exceptions.</p>
      </section>
    </div>
  );
};

export const IntegrationsView = () => {
  const [runs, setRuns] = useState<ConnectorRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = () => fetchConnectorRuns().then((data) => { setRuns(data); setError(null); }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const run = async (name: string) => {
    setRunning(true);
    try {
      await runConnector(name);
      setLoading(true);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'run failed');
    } finally {
      setRunning(false);
    }
  };

  const role = currentRole();
  const canRun = can(role, 'connector.run');

  return <div><Navbar /><h3>Integrations</h3>
    <button onClick={() => run('csv')} disabled={!canRun || running} title={!canRun ? requiresText('connector.run') : ''}>{running ? 'Running…' : 'Run connector now (CSV)'}</button>
    {loading ? <p>Loading…</p> : null}
    {error ? (error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>) : null}
    {!loading && !error && runs.length === 0 ? <p>No connector runs yet</p> : null}
    {!loading && !error && runs.length > 0 ? <table><thead><tr><th>Connector</th><th>Status</th><th>Output</th><th>Error</th></tr></thead><tbody>{runs.map((r, i) => <tr key={i}><td>{r.connector_name}</td><td>{r.status}</td><td>{r.output_summary ?? '-'}</td><td>{r.error ?? '-'}</td></tr>)}</tbody></table> : null}
  </div>;
};

export const ExceptionsView = () => {
  const [cases, setCases] = useState<ExceptionCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => fetchExceptions('open').then((data) => { setCases(data); setError(null); }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const runDetect = async () => {
    setDetecting(true);
    setMessage(null);
    try {
      const result = await detectExceptions();
      setMessage(result.message ?? `${result.created ?? 0} exceptions created`);
      setLoading(true);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Detection failed');
    } finally {
      setDetecting(false);
    }
  };

  return <div><Navbar /><h3>Exceptions / Cases</h3><button onClick={runDetect} disabled={detecting}>{detecting ? 'Detecting…' : 'Detect exceptions'}</button>{message ? <p>{message}</p> : null}{loading ? <p>Loading…</p> : null}{error ? (error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>) : null}{!loading && !error && cases.length === 0 ? <p>No open exceptions</p> : null}{!loading && !error && cases.length > 0 ? <table><thead><tr><th>ID</th><th>Type</th><th>Severity</th><th>Status</th><th>Source</th><th>SLA</th></tr></thead><tbody>{cases.map((c) => <tr key={c.id}><td><Link to={`/exceptions/${c.id}`}>{c.id}</Link></td><td>{c.type}</td><td>{c.severity}</td><td>{c.status}</td><td>{c.source}</td><td>{c.sla_due_at ?? '-'}</td></tr>)}</tbody></table> : null}</div>;
};
