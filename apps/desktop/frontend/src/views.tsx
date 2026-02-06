import React, { useEffect, useState } from 'react';
import { ConnectorRun, ExceptionCase, fetchConnectorRuns, fetchExceptions, fetchHealth, loginDemo } from './api';

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

  return <div><h2>SupplyChain Control Tower</h2><select value={role} onChange={(e) => setRole(e.target.value as 'Planner' | 'Ops' | 'Admin')}><option>Planner</option><option>Ops</option><option>Admin</option></select><button onClick={handleLogin}>Login (Demo)</button>{error ? <p>{error}</p> : null}</div>;
}

export const HomeView = () => {
  const [status, setStatus] = useState('checking...');
  useEffect(() => {
    fetchHealth().then((h) => setStatus(`${h.status} (${h.service})`)).catch((e: unknown) => setStatus(e instanceof Error ? e.message : 'unreachable'));
  }, []);
  return <div><h3>Home Dashboard</h3><p>KPIs + activity feed</p><p>Backend health: <strong>{status}</strong></p></div>;
};

export const InventoryView = () => <div><h3>Inventory</h3></div>;
export const PurchaseView = () => <div><h3>Purchase</h3></div>;
export const LogisticsView = () => <div><h3>Logistics</h3></div>;

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
      <h3>Integrations</h3>
      <h4>Connector Runs</h4>
      {error ? <p>Failed to load connector runs: {error}</p> : null}
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
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{run.connector_name}</td>
                <td>{run.status === 'failed' ? `FAILED (${run.status})` : run.status}</td>
                <td>{run.retries}</td>
                <td>{run.started_at}</td>
                <td>{run.ended_at ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
};

export const ExceptionsView = () => {
  const [cases, setCases] = useState<ExceptionCase[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchExceptions()
      .then((data) => {
        setCases(data);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed to load exceptions'));
  }, []);

  return (
    <div>
      <h3>Exceptions / Cases</h3>
      {error ? <p>Failed to load exceptions: {error}</p> : null}
      {!error && cases.length === 0 ? <p>No open exceptions</p> : null}
      {cases.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>id</th>
              <th>type</th>
              <th>severity</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.type}</td>
                <td>{item.severity}</td>
                <td>{item.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
};
