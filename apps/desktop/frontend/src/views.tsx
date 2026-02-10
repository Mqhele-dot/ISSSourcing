import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ConnectorRun, detectExceptions, ExceptionCase, fetchConnectorRuns, fetchExceptions, fetchHealth, loginDemo, resetDemoData, runConnector } from './api';
import { LoginPrompt } from './pages/common';
import { Badge, Button, Card, EmptyState, Skeleton, StatCard, Table } from './components/ui';

export function LoginView({ onLogin }: { onLogin: (role: 'Planner' | 'Ops' | 'Admin') => void }) {
  const [role, setRole] = useState<'Planner' | 'Ops' | 'Admin'>('Planner');
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();
  const refreshMessage = new URLSearchParams(location.search).get('message');

  const handleLogin = async () => {
    try {
      const token = await loginDemo(role);
      sessionStorage.setItem('sct_token', token);
      setError(null);
      onLogin(role);
      window.location.hash = '#/';
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'login failed');
    }
  };

  return <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 16 }}><Card><h2>SupplyChain Control Tower</h2>{refreshMessage === 'session-refresh' ? <p>Session needs refresh — please login again.</p> : null}<select className="select" value={role} onChange={(e) => setRole(e.target.value as 'Planner' | 'Ops' | 'Admin')}><option>Planner</option><option>Ops</option><option>Admin</option></select><div style={{ marginTop: 12 }}><Button variant="primary" onClick={handleLogin}>Login (Demo)</Button></div>{error ? <p>{error}</p> : null}</Card></div>;
}

export const HomeView = () => {
  const [status, setStatus] = useState('loading');
  const [exceptions, setExceptions] = useState(0);
  const [runs, setRuns] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth().then((h) => setStatus(`${h.status} (${h.service})`)).catch((e: unknown) => setStatus(e instanceof Error ? e.message : 'unreachable'));
    fetchExceptions('open').then((d) => setExceptions(d.length)).catch(() => null);
    fetchConnectorRuns().then((d) => setRuns(d.length)).catch(() => null);
  }, []);

  return <div className="panel">
    <div className="page-header"><h2 style={{ margin: 0 }}>Control Tower Overview</h2><p className="muted" style={{ margin: '6px 0 0' }}>Operational snapshot and quick actions.</p></div>
    <div className="grid-4">
      <StatCard label="Open Exceptions" value={exceptions} />
      <StatCard label="Connector Runs" value={runs} />
      <StatCard label="Inventory Alerts" value={exceptions > 0 ? exceptions : 0} />
      <StatCard label="API" value={status} />
    </div>
    <div className="grid-2" style={{ marginTop: 12 }}>
      <Card><h3>Quick actions</h3><div className="toolbar"><Button onClick={async () => { const r = await detectExceptions(); setMsg(r.message ?? 'done'); }}>Detect exceptions</Button><Button onClick={async () => { const r = await resetDemoData(); setMsg(r.message); }}>Reset demo data</Button><Button onClick={async () => { const h = await fetchHealth(); setMsg(`Ping: ${h.status}`); }}>Ping API</Button></div>{msg ? <p>{msg}</p> : null}</Card>
      <Card><h3>Activity feed</h3><p className="muted">Demo seed loaded</p><p className="muted">Exceptions detected from latest run</p><p className="muted">Connector runtime available</p></Card>
    </div>
  </div>;
};

export const IntegrationsView = () => {
  const [runs, setRuns] = useState<ConnectorRun[]>([]);
  const [selected, setSelected] = useState<ConnectorRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetchConnectorRuns().then((data) => { setRuns(data); setSelected(data[0] ?? null); setError(null); }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  return <div className="panel"><div className="page-header"><h2 style={{ margin: 0 }}>Integrations</h2><p className="muted" style={{ margin: '6px 0 0' }}>Connector runs with operational visibility.</p></div>
    <div className="grid-2">
      <Card><h3>Connector Runs</h3><Button variant="primary" onClick={async () => { await runConnector('csv'); setLoading(true); await load(); }}>Run Demo Connector</Button>
        {loading ? <Skeleton /> : null}
        {error ? (error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>) : null}
        {!loading && !error && runs.length === 0 ? <EmptyState title="No connector runs yet" /> : null}
        {!loading && !error && runs.length > 0 ? <Table><thead><tr><th>ID</th><th>Connector</th><th>Status</th><th>Started</th><th>Finished</th></tr></thead><tbody>{runs.map((r, i) => <tr key={i} onClick={() => setSelected(r)}><td>{r.id ?? '-'}</td><td>{r.connector_name}</td><td>{r.status}</td><td>{r.started_at ?? '-'}</td><td>{r.ended_at ?? '-'}</td></tr>)}</tbody></Table> : null}
      </Card>
      <Card><h3>Run log panel (stub)</h3>{selected ? <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(selected, null, 2)}</pre> : <p className="muted">Select a run to inspect details.</p>}</Card>
    </div>
  </div>;
};

export const ExceptionsView = () => {
  const [cases, setCases] = useState<ExceptionCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetchExceptions('open').then((data) => { setCases(data); setError(null); }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  return <div className="panel"><div className="page-header"><h2 style={{ margin: 0 }}>Exceptions</h2><p className="muted" style={{ margin: '6px 0 0' }}>Lifecycle management with SLA visibility.</p></div>
    <Card><div className="toolbar"><Button onClick={async () => { setDetecting(true); await detectExceptions(); setLoading(true); await load(); setDetecting(false); }}>{detecting ? 'Detecting…' : 'Detect exceptions'}</Button></div>
      {loading ? <Skeleton /> : null}
      {error ? (error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>) : null}
      {!loading && !error && cases.length === 0 ? <EmptyState title="No open exceptions" /> : null}
      {!loading && !error && cases.length > 0 ? <Table><thead><tr><th>ID</th><th>Type</th><th>Severity</th><th>Status</th><th>SLA</th></tr></thead><tbody>{cases.map((c) => <tr key={c.id}><td><Link to={`/exceptions/${c.id}`}>{c.id}</Link></td><td>{c.type}</td><td><Badge tone={c.severity === 'high' ? 'danger' : c.severity === 'medium' ? 'warning' : 'info'}>{c.severity}</Badge></td><td>{c.status}</td><td>{c.sla_due_at ?? '-'}</td></tr>)}</tbody></Table> : null}
    </Card>
  </div>;
};
