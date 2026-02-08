import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ConnectorRun,
  ExceptionCase,
  InventoryRow,
  PurchaseOrderRow,
  ShipmentRow,
  addCaseComment,
  detectExceptions,
  fetchConnectorRuns,
  fetchExceptions,
  fetchHealth,
  fetchInventory,
  fetchPurchaseOrders,
  fetchShipments,
  loginDemo,
} from './api';
import { ApiErrorEntry, getApiErrors, subscribeApiErrors } from './state/apiErrors';

function DevDebugPanel({ open }: { open: boolean }) {
  const [errors, setErrors] = useState<ApiErrorEntry[]>(getApiErrors());

  useEffect(() => subscribeApiErrors(() => setErrors(getApiErrors())), []);
  if (!import.meta.env.DEV || !open) return null;

  return (
    <details open>
      <summary>Dev Debug ({errors.length})</summary>
      {errors.length === 0 ? <p>No API errors recorded</p> : null}
      {errors.map((error, idx) => (
        <div key={`${error.time}-${idx}`}>
          <small>{error.time} | {error.route} | {error.status ?? 'network'} | {error.message}</small>
        </div>
      ))}
    </details>
  );
}

function Navbar() {
  const loggedIn = Boolean(sessionStorage.getItem('sct_token'));
  const [debugOpen, setDebugOpen] = useState(false);
  return (
    <>
      <nav>
        <Link to="/">Home</Link> | <Link to="/login">Login</Link>
        {loggedIn ? (
          <>
            {' '}| <Link to="/inventory">Inventory</Link>
            {' '}| <Link to="/purchase">Purchase</Link>
            {' '}| <Link to="/logistics">Logistics</Link>
            {' '}| <Link to="/exceptions">Exceptions</Link>
            {' '}| <Link to="/integrations">Integrations</Link>
          </>
        ) : null}
        {import.meta.env.DEV ? <><span> | </span><button onClick={() => setDebugOpen((v) => !v)}>Dev Debug</button></> : null}
      </nav>
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
  return <div><Navbar /><h3>Home Dashboard</h3><p>KPIs + activity feed</p><p>Backend health: <strong>{status}</strong></p></div>;
};

function LoginPrompt() {
  return <p>Not logged in. <Link to="/login">Go to login</Link></p>;
}

export const InventoryView = () => {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInventory()
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed to load inventory'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Navbar />
      <h3>Inventory</h3>
      {loading ? <p>Loading…</p> : null}
      {error ? <p>Failed to load inventory: {error}</p> : null}
      {error === 'Not logged in' ? <LoginPrompt /> : null}
      {!loading && !error && rows.length === 0 ? <p>No inventory records</p> : null}
      {!loading && !error && rows.length > 0 ? (
        <table><thead><tr><th>sku</th><th>location</th><th>on_hand</th><th>available</th><th>updated_at</th></tr></thead><tbody>
          {rows.map((row, idx) => <tr key={`${row.sku ?? 'unknown'}-${idx}`}><td>{row.sku ?? 'unknown'}</td><td>{row.location ?? 'unknown'}</td><td>{row.on_hand ?? '-'}</td><td>{row.available ?? '-'}</td><td>{row.updated_at ?? '-'}</td></tr>)}
        </tbody></table>
      ) : null}
    </div>
  );
};

export const PurchaseView = () => {
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPurchaseOrders('open')
      .then((data) => {
        setOrders(data);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed to load purchase orders'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Navbar />
      <h3>Purchase</h3>
      {loading ? <p>Loading…</p> : null}
      {error ? <p>Failed to load purchase orders: {error}</p> : null}
      {error === 'Not logged in' ? <LoginPrompt /> : null}
      {!loading && !error && orders.length === 0 ? <p>No purchase orders</p> : null}
      {!loading && !error && orders.length > 0 ? (
        <table><thead><tr><th>po_number</th><th>supplier</th><th>status</th><th>requested_date</th><th>lines</th></tr></thead><tbody>
          {orders.map((order, idx) => <tr key={`${order.po_number ?? 'unknown'}-${idx}`}><td>{order.po_number ?? '-'}</td><td>{order.supplier ?? 'unknown'}</td><td>{order.status ?? 'unknown'}</td><td>{order.requested_date ?? '-'}</td><td>{order.lines ?? '-'}</td></tr>)}
        </tbody></table>
      ) : null}
    </div>
  );
};

export const LogisticsView = () => {
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchShipments()
      .then((data) => {
        setShipments(data);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed to load shipments'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Navbar />
      <h3>Logistics</h3>
      {loading ? <p>Loading…</p> : null}
      {error ? <p>Failed to load shipments: {error}</p> : null}
      {error === 'Not logged in' ? <LoginPrompt /> : null}
      {!loading && !error && shipments.length === 0 ? <p>No shipments</p> : null}
      {!loading && !error && shipments.length > 0 ? (
        <table><thead><tr><th>shipment_id</th><th>carrier</th><th>status</th><th>eta</th><th>eta_drift_hours</th></tr></thead><tbody>
          {shipments.map((shipment, idx) => <tr key={`${shipment.shipment_id ?? 'unknown'}-${idx}`}><td>{shipment.shipment_id ?? '-'}</td><td>{shipment.carrier ?? 'unknown'}</td><td>{shipment.status ?? 'unknown'}</td><td>{shipment.eta ?? '-'}</td><td>{shipment.eta_drift_hours ?? '-'}</td></tr>)}
        </tbody></table>
      ) : null}
    </div>
  );
};

export const IntegrationsView = () => {
  const [runs, setRuns] = useState<ConnectorRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchConnectorRuns()
      .then((data) => {
        setRuns(data);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed to load connector runs'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Navbar />
      <h3>Integrations</h3>
      <h4>Connector Runs</h4>
      {loading ? <p>Loading…</p> : null}
      {error ? <p>Failed to load connector runs: {error}</p> : null}
      {error === 'Not logged in' ? <LoginPrompt /> : null}
      {!loading && !error && runs.length === 0 ? <p>No connector runs yet</p> : null}
      {!loading && !error && runs.length > 0 ? (
        <table><thead><tr><th>connector_name</th><th>status</th><th>retries</th><th>started_at</th><th>ended_at</th></tr></thead><tbody>
          {runs.map((run, idx) => {
            const status = run.status ?? 'unknown';
            const isFailed = status.toLowerCase() === 'failed';
            const statusText = isFailed ? `FAILED - ${status}` : status;
            const errorText = run.error ? ` (${run.error})` : '';
            return <tr key={run.id ?? idx}><td>{run.connector_name ?? 'unknown'}</td><td>{statusText}{errorText}</td><td>{run.retries ?? '-'}</td><td>{run.started_at ?? '-'}</td><td>{run.ended_at ?? '-'}</td></tr>;
          })}
        </tbody></table>
      ) : null}
    </div>
  );
};

export const ExceptionsView = () => {
  const [cases, setCases] = useState<ExceptionCase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectMessage, setDetectMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [commentStatus, setCommentStatus] = useState<Record<number, string>>({});

  const loadExceptions = () => {
    setLoading(true);
    fetchExceptions('open')
      .then((data) => {
        setCases(data);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed to load exceptions'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadExceptions();
  }, []);

  const runDetection = async () => {
    setDetecting(true);
    setError(null);
    setDetectMessage(null);
    try {
      const result = await detectExceptions();
      if (result.message) setDetectMessage(result.message);
      if (result.created !== undefined) setDetectMessage((msg) => msg ?? `${result.created} exceptions created`);
      loadExceptions();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to detect exceptions');
    } finally {
      setDetecting(false);
    }
  };

  const submitComment = async (caseId: number) => {
    const comment = (commentDrafts[caseId] ?? '').trim();
    if (!comment) {
      setCommentStatus((prev) => ({ ...prev, [caseId]: 'Comment cannot be empty' }));
      return;
    }

    try {
      await addCaseComment(caseId, comment);
      setCommentDrafts((prev) => ({ ...prev, [caseId]: '' }));
      setCommentStatus((prev) => ({ ...prev, [caseId]: 'Comment added' }));
    } catch (e: unknown) {
      setCommentStatus((prev) => ({ ...prev, [caseId]: e instanceof Error ? e.message : 'Failed to add comment' }));
    }
  };

  return (
    <div>
      <Navbar />
      <h3>Exceptions / Cases</h3>
      <button onClick={runDetection} disabled={detecting}>{detecting ? 'Detecting...' : 'Detect exceptions'}</button>
      {detectMessage ? <p>{detectMessage}</p> : null}
      {loading ? <p>Loading…</p> : null}
      {error ? <p>Failed to load exceptions: {error}</p> : null}
      {error === 'Not logged in' ? <LoginPrompt /> : null}
      {!loading && !error && cases.length === 0 ? <p>No open exceptions</p> : null}
      {!loading && !error && cases.length > 0 ? (
        <table>
          <thead><tr><th>id</th><th>type</th><th>severity</th><th>status</th><th>comment</th></tr></thead>
          <tbody>
            {cases.map((item, idx) => {
              const caseId = item.id ?? -1;
              return (
                <tr key={item.id ?? idx}>
                  <td>{item.id ?? '-'}</td><td>{item.type ?? 'unknown'}</td><td>{item.severity ?? 'unknown'}</td><td>{item.status ?? 'unknown'}</td>
                  <td>
                    <input
                      type="text"
                      value={caseId > 0 ? (commentDrafts[caseId] ?? '') : ''}
                      onChange={(e) => caseId > 0 && setCommentDrafts((prev) => ({ ...prev, [caseId]: e.target.value }))}
                      placeholder="Add comment"
                      disabled={caseId <= 0}
                    />
                    <button onClick={() => caseId > 0 && submitComment(caseId)} disabled={caseId <= 0}>Add comment</button>
                    {caseId > 0 && commentStatus[caseId] ? <small> {commentStatus[caseId]}</small> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
};
