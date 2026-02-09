import React, { useEffect, useState } from 'react';
import { fetchPurchaseOrder, PurchaseOrderDetail, receivePurchaseOrder, updatePurchaseStatus } from '../api';
import { useParams } from 'react-router-dom';
import { LoginPrompt } from './common';
import { ChangeSummary } from './ChangeSummary';
import { can, currentRole, requiresText } from '../utils/rbac';

export function PurchaseDetailPage() {
  const { po_number = '' } = useParams();
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [status, setStatus] = useState('approved');
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<{ inventory: any[]; shipments: any[]; exceptions: any[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => fetchPurchaseOrder(po_number)
    .then((d) => {
      setDetail(d);
      setStatus(d.status);
      setReceiveQty(Object.fromEntries((d.lines || []).map((line) => [line.sku, Number(line.qty)])));
    })
    .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed'))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, [po_number]);

  const onUpdate = async () => {
    setSaving(true);
    try {
      await updatePurchaseStatus(po_number, status);
      setLoading(true);
      await load();
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Status update failed');
    } finally {
      setSaving(false);
    }
  };

  const onReceive = async () => {
    setReceiving(true);
    try {
      const lines = Object.entries(receiveQty).map(([sku, qty]) => ({ sku, qty: Number(qty) }));
      const result = await receivePurchaseOrder(po_number, lines);
      setChanged(result.changed);
      setMessage(result.message);
      setLoading(true);
      await load();
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Receive failed');
    } finally {
      setReceiving(false);
    }
  };

  const role = currentRole();
  const canUpdate = can(role, 'purchase.update');
  const canReceive = can(role, 'purchase.receive');

  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <p>No purchase orders found</p>;

  return <div><h3>{detail.po_number}</h3><p>Status: {detail.status}</p>
    <select value={status} onChange={(e) => setStatus(e.target.value)}><option>approved</option><option>sent</option><option>received</option></select>
    <button onClick={onUpdate} disabled={!canUpdate || saving} title={!canUpdate ? requiresText('purchase.update') : ''}>{saving ? 'Saving…' : 'Update'}</button>
    <button onClick={onReceive} disabled={!canReceive || receiving} title={!canReceive ? requiresText('purchase.receive') : ''}>{receiving ? 'Receiving…' : 'Receive PO'}</button>
    <ChangeSummary changed={changed} message={message} />
    <h4>Lines (receive quantities)</h4>
    <table><thead><tr><th>SKU</th><th>Ordered</th><th>Receive now</th></tr></thead><tbody>{detail.lines.map((l, i) => <tr key={i}><td>{l.sku}</td><td>{l.qty}</td><td><input type="number" value={receiveQty[l.sku] ?? Number(l.qty)} onChange={(e) => setReceiveQty((prev) => ({ ...prev, [l.sku]: Number(e.target.value) }))} /></td></tr>)}</tbody></table>
    <h4>Linked shipments</h4>
    <table><tbody>{(detail.shipments ?? []).length === 0 ? <tr><td colSpan={2}>No linked shipments</td></tr> : (detail.shipments ?? []).map((s, i) => <tr key={i}><td>{s.shipment_id}</td><td>{s.status}</td></tr>)}</tbody></table>
  </div>;
}
