import { pushApiError } from './state/apiErrors';

const envApiBase = (import.meta as any).env?.VITE_API_BASE;
const windowApiBase = (window as any).__SCT_API_BASE__;
const isCodespacesHost = typeof window !== 'undefined' && /(?:\.app\.github\.dev|\.github\.dev)$/.test(window.location.hostname);

export const API_BASE = envApiBase ?? windowApiBase ?? (isCodespacesHost ? '/api' : 'http://127.0.0.1:8000');

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const route = path;
  const url = `${API_BASE}${path}`;
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      const message = `${path} failed: ${response.status}`;
      pushApiError({ route, url, status: response.status, message, time: new Date().toISOString() });
      throw new Error(response.status === 401 ? 'Not logged in' : message);
    }
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Request failed';
    pushApiError({ route, url, status: null, message, time: new Date().toISOString() });
    throw error;
  }
}

export async function fetchHealth(): Promise<{ status: string; service: string }> {
  const res = await apiFetch('/health');
  return res.json();
}

export type InventoryRow = { sku: string; location: string; on_hand: number; available: number; updated_at: string };
export type InventoryMovement = { id: number; sku: string; location: string; movement_type?: string; delta: number; source_ref?: string; reason: string; created_at: string; actor?: string; created_by?: string };
export type InventoryDetail = { sku: string; positions: InventoryRow[]; movements: InventoryMovement[] };

export type PurchaseOrderRow = { po_number: string; supplier: string; status: string; requested_date: string; lines: number };
export type PurchaseLine = { sku: string; qty: number; uom: string };
export type PurchaseOrderDetail = { po_number: string; supplier: string; status: string; requested_date: string; lines: PurchaseLine[]; shipments?: ShipmentRow[] };

export type ShipmentRow = { shipment_id: string; po_number?: string; carrier?: string; status: string; eta?: string; origin?: string; dest?: string };
export type ShipmentDetail = ShipmentRow & { events?: Array<{ status: string; at: string }> };

export type ExceptionCase = { id: number; type: string; severity: string; status: string; source: string; related_refs: { sku: string[]; po: string[]; shipment: string[] }; reason?: string; assignee?: string; created_at?: string; updated_at?: string; sla_due_at?: string };
export type ConnectorRun = { id?: number | null; connector_name?: string | null; status?: string | null; retries?: number | null; started_at?: string | null; ended_at?: string | null; error?: string | null; output_summary?: string | null; input_ref?: string | null };
export type DetectExceptionsResponse = { items: ExceptionCase[]; message?: string; created?: number };
export type ExceptionComment = { id: number; author: string; comment: string; created_at: string };
export type ExceptionDetail = ExceptionCase & { comments: ExceptionComment[] };

export async function loginDemo(role: 'Planner' | 'Ops' | 'Admin'): Promise<string> {
  const username = role.toLowerCase();
  const res = await apiFetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'demo' }) });
  const data = await res.json() as { token: string; role?: string; username?: string };
  if (data.role) sessionStorage.setItem('sct_role', data.role);
  if (data.username) sessionStorage.setItem('sct_username', data.username);
  return data.token;
}

async function authedGet<T>(path: string): Promise<T> {
  const token = sessionStorage.getItem('sct_token');
  if (!token) throw new Error('Not logged in');
  const res = await apiFetch(path, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

export async function authedPost<T>(path: string, body?: unknown): Promise<T> {
  const token = sessionStorage.getItem('sct_token');
  if (!token) throw new Error('Not logged in');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await apiFetch(path, { method: 'POST', headers, body: payload });
  return res.json();
}

export const fetchExceptions = (status = 'open') => authedGet<ExceptionCase[]>(`/exceptions?status=${encodeURIComponent(status)}`);
export const fetchExceptionDetail = (id: number) => authedGet<ExceptionDetail>(`/exceptions/${id}`);
export const detectExceptions = () => authedPost<DetectExceptionsResponse>('/exceptions/detect');
export const addCaseComment = (caseId: number, comment: string) => authedPost<ExceptionDetail>(`/exceptions/${caseId}/comment`, { comment });
export const assignException = (id: number, assignee: string) => authedPost<ExceptionDetail>(`/exceptions/${id}/assign`, { assignee });
export const updateExceptionStatus = (id: number, status: string) => authedPost<ExceptionDetail>(`/exceptions/${id}/status`, { status });
export const snoozeException = (id: number, hours: number) => authedPost<ExceptionDetail>(`/exceptions/${id}/snooze`, { hours });

export const fetchConnectorRuns = (limit = 100) => authedGet<ConnectorRun[]>(`/connectors/runs?limit=${limit}`);
export const runConnector = (name: string) => authedPost<{ status: string; processed: number; errors: number; message: string }>(`/connectors/run/${encodeURIComponent(name)}`);

export async function fetchInventory(): Promise<InventoryRow[]> { return (await authedGet<{ items: InventoryRow[] }>('/inventory')).items; }
export const fetchInventoryDetail = (sku: string) => authedGet<InventoryDetail>(`/inventory/${encodeURIComponent(sku)}`);
export const fetchInventoryMovements = (sku: string, limit = 100) => authedGet<{ items: InventoryMovement[] }>(`/inventory/${encodeURIComponent(sku)}/movements?limit=${limit}`);
export const adjustInventory = (payload: { sku: string; location: string; delta: number; reason: string; movement_type?: string; source_ref?: string }) => authedPost<{ ok: boolean; changed?: { inventory: InventoryRow[]; shipments: ShipmentRow[]; exceptions: ExceptionCase[] } }>(`/inventory/adjust`, payload);

export async function fetchPurchaseOrders(status = 'open'): Promise<PurchaseOrderRow[]> {
  return (await authedGet<{ items: PurchaseOrderRow[] }>(`/purchase/orders?status=${encodeURIComponent(status)}`)).items;
}
export const fetchPurchaseOrder = (po: string) => authedGet<PurchaseOrderDetail>(`/purchase/orders/${encodeURIComponent(po)}`);
export const updatePurchaseStatus = (po: string, status: string) => authedPost<{ ok: boolean }>(`/purchase/orders/${encodeURIComponent(po)}/status`, { status });
export const receivePurchaseOrder = (po: string, lines?: Array<{ sku: string; qty: number }>) => authedPost<{ message: string; changed: { inventory: InventoryRow[]; shipments: ShipmentRow[]; exceptions: ExceptionCase[] } }>(`/purchase/orders/${encodeURIComponent(po)}/receive`, lines ? { lines } : undefined);

export async function fetchShipments(params?: { status?: string; po_number?: string }): Promise<ShipmentRow[]> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.po_number) search.set('po_number', params.po_number);
  const suffix = search.toString();
  return (await authedGet<{ items: ShipmentRow[] }>(`/logistics/shipments${suffix ? `?${suffix}` : ''}`)).items;
}
export const fetchShipment = (id: string) => authedGet<ShipmentDetail>(`/logistics/shipments/${encodeURIComponent(id)}`);
export const updateShipmentStatus = (id: string, status: string) => authedPost<{ ok: boolean }>(`/logistics/shipments/${encodeURIComponent(id)}/status`, { status });
export const deliverShipment = (id: string) => authedPost<{ message: string; changed: { inventory: InventoryRow[]; shipments: ShipmentRow[]; exceptions: ExceptionCase[] } }>(`/logistics/shipments/${encodeURIComponent(id)}/deliver`);

export const resetDemoData = () => authedPost<{ ok: boolean; message: string; seeded: { canonical: number; exceptions: number; movements: number; users: number } }>('/demo/reset');
