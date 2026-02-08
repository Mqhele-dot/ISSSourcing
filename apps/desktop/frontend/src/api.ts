export const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ??
  (window as any).__SCT_API_BASE__ ??
  'http://127.0.0.1:8000';

export async function fetchHealth(): Promise<{ status: string; service: string }> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`health failed: ${res.status}`);
  return res.json();
}

export type ExceptionCase = {
  id?: number | null;
  type?: string | null;
  severity?: string | null;
  status?: string | null;
};

export type ConnectorRun = {
  id?: number | null;
  connector_name?: string | null;
  status?: string | null;
  retries?: number | null;
  started_at?: string | null;
  ended_at?: string | null;
  error?: string | null;
};

export async function loginDemo(role: 'Planner' | 'Ops' | 'Admin'): Promise<string> {
  const username = role.toLowerCase();
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'demo' }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const data = await res.json() as { token: string; role?: string; username?: string };
  if (data.role) sessionStorage.setItem('sct_role', data.role);
  if (data.username) sessionStorage.setItem('sct_username', data.username);
  return data.token;
}

async function authedGet<T>(path: string): Promise<T> {
  const token = sessionStorage.getItem('sct_token');
  if (!token) throw new Error('Not logged in');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export async function authedPost<T>(path: string, body?: unknown): Promise<T> {
  const token = sessionStorage.getItem('sct_token');
  if (!token) throw new Error('Not logged in');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: payload,
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export function fetchExceptions(status = 'open'): Promise<ExceptionCase[]> {
  return authedGet<ExceptionCase[]>(`/exceptions?status=${encodeURIComponent(status)}`);
}

export function detectExceptions(): Promise<{ created: number }> {
  return authedPost<{ created: number }>('/exceptions/detect');
}

export function addCaseComment(caseId: number, comment: string): Promise<{ ok: boolean }> {
  return authedPost<{ ok: boolean }>(`/cases/${caseId}/comment`, { comment });
}

export function fetchConnectorRuns(limit = 100): Promise<ConnectorRun[]> {
  return authedGet<ConnectorRun[]>(`/connectors/runs?limit=${limit}`);
}
