import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConnectorRun, detectExceptions, ExceptionCase, fetchConnectorRuns, fetchExceptions, fetchHealth, loginDemo } from './api';
import { ApiErrorEntry, getApiErrors, subscribeApiErrors } from './state/apiErrors';
import { LoginPrompt } from './pages/common';

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

export function Navbar() {
  const loggedIn = Boolean(sessionStorage.getItem('sct_token'));
  const [debugOpen, setDebugOpen] = useState(false);
  return <><nav><Link to="/">Home</Link> | <Link to="/login">Login</Link>{loggedIn ? <><span> | </span><Link to="/inventory">Inventory</Link><span> | </span><Link to="/purchase">Purchase</Link><span> | </span><Link to="/logistics">Logistics</Link><span> | </span><Link to="/exceptions">Exceptions</Link><span> | </span><Link to="/integrations">Integrations</Link></> : null}{import.meta.env.DEV ? <><span> | </span><button onClick={() => setDebugOpen((v) => !v)}>Dev Debug</button></> : null}</nav><DevDebugPanel open={debugOpen} /></>;
}

export function LoginView({ onLogin }: { onLogin: (role: 'Planner' | 'Ops' | 'Admin') => void }) {
  const [role, setRole] = useState<'Planner' | 'Ops' | 'Admin'>('Planner');
  const [error, setError] = useState<string | null>(null);
  const handleLogin = async () => { try { const token = await loginDemo(role); sessionStorage.setItem('sct_token', token); setError(null); onLogin(role); } catch (e: unknown) { setError(e instanceof Error ? e.message : 'login failed'); } };
  return <div><Navbar /><h2>SupplyChain Control Tower</h2><select value={role} onChange={(e) => setRole(e.target.value as 'Planner' | 'Ops' | 'Admin')}><option>Planner</option><option>Ops</option><option>Admin</option></select><button onClick={handleLogin}>Login (Demo)</button>{error ? <p>{error}</p> : null}</div>;
}

export const HomeView = () => {
  const [status, setStatus] = useState('loading');
  useEffect(() => { fetchHealth().then((h) => setStatus(`${h.status} (${h.service})`)).catch((e: unknown) => setStatus(e instanceof Error ? e.message : 'unreachable')); }, []);
  return <div><Navbar /><h3>Home Dashboard</h3><p>Backend health: <strong>{status}</strong></p></div>;
};

export const IntegrationsView = () => {
  const [runs, setRuns] = useState<ConnectorRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchConnectorRuns().then((data) => { setRuns(data); setError(null); }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed')).finally(() => setLoading(false));
  }, []);

  return <div><Navbar /><h3>Integrations</h3>{loading ? <p>Loading…</p> : null}{error ? (error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>) : null}{!loading && !error && runs.length === 0 ? <p>No connector runs yet</p> : null}{!loading && !error && runs.length > 0 ? <table><tbody>{runs.map((r, i) => <tr key={i}><td>{r.connector_name}</td><td>{r.status}</td></tr>)}</tbody></table> : null}</div>;
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

  return (
    <div>
      <Navbar />
      <h3>Exceptions / Cases</h3>
      <button onClick={runDetect} disabled={detecting}>{detecting ? 'Detecting…' : 'Detect exceptions'}</button>
      {message ? <p>{message}</p> : null}
      {loading ? <p>Loading…</p> : null}
      {error ? (error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>) : null}
      {!loading && !error && cases.length === 0 ? <p>No open exceptions</p> : null}
      {!loading && !error && cases.length > 0 ? (
        <table><thead><tr><th>ID</th><th>Type</th><th>Severity</th><th>Status</th><th>Source</th></tr></thead><tbody>
          {cases.map((c) => <tr key={c.id}><td><Link to={`/exceptions/${c.id}`}>{c.id}</Link></td><td>{c.type}</td><td>{c.severity}</td><td>{c.status}</td><td>{c.source}</td></tr>)}
        </tbody></table>
      ) : null}
    </div>
  );
};
