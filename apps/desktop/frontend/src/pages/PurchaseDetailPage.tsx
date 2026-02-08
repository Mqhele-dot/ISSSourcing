import React, { useEffect, useState } from 'react';
import { fetchPurchaseOrder, PurchaseOrderDetail, receivePurchaseOrder, updatePurchaseStatus } from '../api';
import { useParams } from 'react-router-dom';
import { LoginPrompt } from './common';

export function PurchaseDetailPage() {
  const { po_number = '' } = useParams();
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [status, setStatus] = useState('approved');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<{ inventory: number; shipments: number; exceptions: number } | null>(null);

  const load = () => fetchPurchaseOrder(po_number).then((d) => { setDetail(d); setStatus(d.status); }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed')).finally(() => setLoading(false));
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
      const result = await receivePurchaseOrder(po_number);
      setChanges({ inventory: result.inventory_updates.length, shipments: result.shipments_updated.length, exceptions: result.exceptions_created });
      setLoading(true);
      await load();
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Receive failed');
    } finally {
      setReceiving(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <p>No purchase orders found</p>;

  return <div><h3>{detail.po_number}</h3><p>Status: {detail.status}</p>
    <select value={status} onChange={(e) => setStatus(e.target.value)}><option>approved</option><option>sent</option><option>received</option></select>
    <button onClick={onUpdate} disabled={saving}>{saving ? 'Saving…' : 'Update'}</button>
    <button onClick={onReceive} disabled={receiving}>{receiving ? 'Receiving…' : 'Receive PO'}</button>
    {changes ? <p>What changed: inventory updates={changes.inventory}, shipments updated={changes.shipments}, exceptions created={changes.exceptions}</p> : null}
    <h4>Lines</h4>
    <table><tbody>{detail.lines.map((l, i) => <tr key={i}><td>{l.sku}</td><td>{l.qty}</td></tr>)}</tbody></table>
    <h4>Linked shipments</h4>
    <table><tbody>{(detail as any).shipments?.map((s: any, i: number) => <tr key={i}><td>{s.shipment_id}</td><td>{s.status}</td></tr>) ?? <tr><td colSpan={2}>No linked shipments</td></tr>}</tbody></table>
  </div>;
}
