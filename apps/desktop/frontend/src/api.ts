export const API_BASE = (window as any).__SCT_API_BASE__ ?? 'http://127.0.0.1:8000';

export async function fetchHealth(): Promise<{ status: string; service: string }> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`health failed: ${res.status}`);
  return res.json();
}

export type ExceptionCase = {
  id: number;
  type: string;
  severity: string;
  status: string;
};

export type ConnectorRun = {
  id: number;
  connector_name: string;
  status: string;
  retries: number;
  started_at: string;
  ended_at: string | null;
};

export async function loginDemo(role: 'Planner' | 'Ops' | 'Admin'): Promise<string> {
  const username = role.toLowerCase();
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'demo' }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const data = await res.json() as { token: string };
  return data.token;
}

async function authedGet<T>(path: string): Promise<T> {
  const token = sessionStorage.getItem('sct_token');
  if (!token) throw new Error('not authenticated');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export function fetchExceptions(): Promise<ExceptionCase[]> {
  return authedGet<ExceptionCase[]>('/exceptions');
}

export function fetchConnectorRuns(): Promise<ConnectorRun[]> {
  return authedGet<ConnectorRun[]>('/connectors/runs');
}
