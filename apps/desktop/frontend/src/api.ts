import { pushApiError } from './state/apiErrors';

const envApiBase = (import.meta as any).env?.VITE_API_BASE;
const windowApiBase = (window as any).__SCT_API_BASE__;
const isCodespacesHost = typeof window !== 'undefined' && /(?:\.app\.github\.dev|\.github\.dev)$/.test(window.location.hostname);

export const API_BASE = envApiBase ?? windowApiBase ?? (isCodespacesHost ? '/api' : 'http://127.0.0.1:8000');

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const route = path;
  try {
    const response = await fetch(`${API_BASE}${path}`, init);
    if (!response.ok) {
      const message = `${path} failed: ${response.status}`;
      pushApiError({ route, status: response.status, message, time: new Date().toISOString() });
      throw new Error(message);
    }
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Request failed';
    pushApiError({ route, status: null, message, time: new Date().toISOString() });
    throw error;
  }
}

export async function fetchHealth(): Promise<{ status: string; service: string }> {
  const res = await apiFetch('/health');
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

export type InventoryRow = {
  sku?: string | null;
  location?: string | null;
  on_hand?: number | null;
  available?: number | null;
  updated_at?: string | null;
};

export type PurchaseOrderRow = {
  po_number?: string | null;
  supplier?: string | null;
  status?: string | null;
  requested_date?: string | null;
  lines?: number | null;
};

export type ShipmentRow = {
  shipment_id?: string | null;
  carrier?: string | null;
  status?: string | null;
  eta?: string | null;
  eta_drift_hours?: number | null;
};

export type DetectExceptionsResponse = {
  items: Array<{ type: string; severity: string; reason: string; linked_entity_id: string }>;
  message?: string;
  created?: number;
};

export async function loginDemo(role: 'Planner' | 'Ops' | 'Admin'): Promise<string> {
  const username = role.toLowerCase();
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'demo' }),
  });
  const data = await res.json() as { token: string; role?: string; username?: string };
  if (data.role) sessionStorage.setItem('sct_role', data.role);
  if (data.username) sessionStorage.setItem('sct_username', data.username);
  return data.token;
}

async function authedGet<T>(path: string): Promise<T> {
  const token = sessionStorage.getItem('sct_token');
  if (!token) throw new Error('Not logged in');
  const res = await apiFetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
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

  const res = await apiFetch(path, {
    method: 'POST',
    headers,
    body: payload,
  });
  return res.json();
}

export function fetchExceptions(status = 'open'): Promise<ExceptionCase[]> {
  return authedGet<ExceptionCase[]>(`/exceptions?status=${encodeURIComponent(status)}`);
}

export function detectExceptions(): Promise<DetectExceptionsResponse> {
  return authedPost<DetectExceptionsResponse>('/exceptions/detect');
}

export function addCaseComment(caseId: number, comment: string): Promise<{ ok: boolean }> {
  return authedPost<{ ok: boolean }>(`/cases/${caseId}/comment`, { comment });
}

export function fetchConnectorRuns(limit = 100): Promise<ConnectorRun[]> {
  return authedGet<ConnectorRun[]>(`/connectors/runs?limit=${limit}`);
}

export function fetchInventory(limit = 100): Promise<InventoryRow[]> {
  return authedGet<InventoryRow[]>(`/inventory?limit=${limit}`);
}

export function fetchPurchaseOrders(status = 'open', limit = 100): Promise<PurchaseOrderRow[]> {
  return authedGet<PurchaseOrderRow[]>(`/purchase/orders?status=${encodeURIComponent(status)}&limit=${limit}`);
}

export function fetchShipments(status?: string, limit = 100): Promise<ShipmentRow[]> {
  const statusQuery = status ? `&status=${encodeURIComponent(status)}` : '';
  return authedGet<ShipmentRow[]>(`/logistics/shipments?limit=${limit}${statusQuery}`);
}
