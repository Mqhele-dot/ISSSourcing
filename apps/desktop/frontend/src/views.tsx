import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConnectorRun, ExceptionCase, addCaseComment, detectExceptions, fetchConnectorRuns, fetchExceptions, fetchHealth, loginDemo } from './api';

function Navbar() {
  const loggedIn = Boolean(sessionStorage.getItem('sct_token'));
  return (
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
    </nav>
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
  const [status, setStatus] = useState('checking...');
  useEffect(() => {
    fetchHealth().then((h) => setStatus(`${h.status} (${h.service})`)).catch((e: unknown) => setStatus(e instanceof Error ? e.message : 'unreachable'));
  }, []);
  return <div><Navbar /><h3>Home Dashboard</h3><p>KPIs + activity feed</p><p>Backend health: <strong>{status}</strong></p></div>;
};

export const InventoryView = () => <div><Navbar /><h3>Inventory</h3></div>;
export const PurchaseView = () => <div><Navbar /><h3>Purchase</h3></div>;
export const LogisticsView = () => <div><Navbar /><h3>Logistics</h3></div>;

function LoginPrompt() {
  return <p>Not logged in. <Link to="/login">Go to login</Link></p>;
}

export const IntegrationsView = () => {
  const [runs, setRuns] = useState<ConnectorRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchConnectorRuns()
      .then((data) => {
        setRuns(data);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed to load connector runs'));
  }, []);

  return (
    <div>
      <Navbar />
      <h3>Integrations</h3>
      <h4>Connector Runs</h4>
      {error ? <p>Failed to load connector runs: {error}</p> : null}
      {error === 'Not logged in' ? <LoginPrompt /> : null}
      {!error && runs.length === 0 ? <p>No connector runs yet</p> : null}
      {runs.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>connector_name</th>
              <th>status</th>
              <th>retries</th>
              <th>started_at</th>
              <th>ended_at</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run, idx) => {
              const status = run.status ?? 'unknown';
              const isFailed = status.toLowerCase() === 'failed';
              const statusText = isFailed ? `FAILED - ${status}` : status;
              const errorText = run.error ? ` (${run.error})` : '';
              return (
                <tr key={run.id ?? idx}>
                  <td>{run.connector_name ?? 'unknown'}</td>
                  <td>{statusText}{errorText}</td>
                  <td>{run.retries ?? '-'}</td>
                  <td>{run.started_at ?? '-'}</td>
                  <td>{run.ended_at ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
};

export const ExceptionsView = () => {
  const [cases, setCases] = useState<ExceptionCase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [commentStatus, setCommentStatus] = useState<Record<number, string>>({});

  const loadExceptions = () => {
    fetchExceptions('open')
      .then((data) => {
        setCases(data);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed to load exceptions'));
  };

  useEffect(() => {
    loadExceptions();
  }, []);

  const runDetection = async () => {
    setDetecting(true);
    setError(null);
    try {
      await detectExceptions();
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
      {error ? <p>Failed to load exceptions: {error}</p> : null}
      {error === 'Not logged in' ? <LoginPrompt /> : null}
      {!error && cases.length === 0 ? <p>No open exceptions</p> : null}
      {cases.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>id</th>
              <th>type</th>
              <th>severity</th>
              <th>status</th>
              <th>comment</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((item, idx) => {
              const caseId = item.id ?? -1;
              return (
                <tr key={item.id ?? idx}>
                  <td>{item.id ?? '-'}</td>
                  <td>{item.type ?? 'unknown'}</td>
                  <td>{item.severity ?? 'unknown'}</td>
                  <td>{item.status ?? 'unknown'}</td>
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
