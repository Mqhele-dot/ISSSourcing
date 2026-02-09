import React, { useEffect, useState } from 'react';
import { fetchPurchaseOrder, PurchaseOrderDetail, receivePurchaseOrder, updatePurchaseStatus } from '../api';
import { useParams } from 'react-router-dom';
import { LoginPrompt } from './common';
import { ChangeSummary } from './ChangeSummary';
import { can, currentRole, requiresText } from '../utils/rbac';
import { Badge, Button, Card, Input, Select, Skeleton, Table } from '../components/ui';

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
      setDetail(d); setStatus(d.status);
      setReceiveQty(Object.fromEntries((d.lines || []).map((line) => [line.sku, Number(line.qty)])));
    })
    .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed'))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, [po_number]);

  const onUpdate = async () => {
    setSaving(true);
    try { await updatePurchaseStatus(po_number, status); setLoading(true); await load(); setError(null); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Status update failed'); }
    finally { setSaving(false); }
  };

  const onReceive = async () => {
    setReceiving(true);
    try {
      const lines = Object.entries(receiveQty).map(([sku, qty]) => ({ sku, qty: Number(qty) }));
      const result = await receivePurchaseOrder(po_number, lines);
      setChanged(result.changed); setMessage(result.message);
      setLoading(true); await load(); setError(null);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Receive failed'); }
    finally { setReceiving(false); }
  };

  const role = currentRole();
  const canUpdate = can(role, 'purchase.update');
  const canReceive = can(role, 'purchase.receive');

  if (loading) return <Skeleton />;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <Card><p>No purchase orders found</p></Card>;

  return <div className="panel">
    <div className="page-header"><h2 style={{ margin: 0 }}>Purchase · {detail.po_number}</h2><p className="muted" style={{ margin: '6px 0 0' }}>{detail.supplier} · Requested {detail.requested_date}</p></div>
    <div className="grid-2">
      <Card><h3>PO header</h3><p>Status: <Badge tone={detail.status === 'received' ? 'success' : detail.status === 'sent' ? 'info' : 'warning'}>{detail.status}</Badge></p><div className="toolbar"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">open</option><option value="approved">approved</option><option value="sent">sent</option><option value="received">received</option></Select><Button onClick={onUpdate} disabled={!canUpdate || saving} title={!canUpdate ? requiresText('purchase.update') : ''}>{saving ? 'Saving…' : 'Update status'}</Button></div></Card>
      <Card><h3>Actions</h3><Button variant="primary" onClick={onReceive} disabled={!canReceive || receiving} title={!canReceive ? requiresText('purchase.receive') : ''}>{receiving ? 'Receiving…' : 'Receive PO'}</Button><p className="muted">Receive will create inventory movements and potential exceptions for mismatches.</p></Card>
    </div>
    <ChangeSummary changed={changed} message={message} />
    <Card><h3>PO lines</h3><Table><thead><tr><th>SKU</th><th>Ordered</th><th>Receive now</th></tr></thead><tbody>{detail.lines.map((l, i) => <tr key={i}><td>{l.sku}</td><td>{l.qty}</td><td><Input type="number" value={receiveQty[l.sku] ?? Number(l.qty)} onChange={(e) => setReceiveQty((prev) => ({ ...prev, [l.sku]: Number(e.target.value) }))} /></td></tr>)}</tbody></Table></Card>
    <Card><h3>Linked shipments</h3><Table><thead><tr><th>Shipment</th><th>Status</th><th>ETA</th></tr></thead><tbody>{(detail.shipments ?? []).length === 0 ? <tr><td colSpan={3}>No linked shipments</td></tr> : (detail.shipments ?? []).map((s) => <tr key={s.shipment_id}><td>{s.shipment_id}</td><td>{s.status}</td><td>{s.eta ?? '-'}</td></tr>)}</tbody></Table></Card>
  </div>;
}
