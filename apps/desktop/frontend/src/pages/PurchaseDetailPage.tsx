import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchPurchaseOrder, PurchaseOrderDetail, updatePurchaseStatus } from '../api';
import { LoginPrompt } from './common';

export function PurchaseDetailPage() {
  const { po_number = '' } = useParams();
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [status, setStatus] = useState('approved');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = () => fetchPurchaseOrder(po_number).then((d) => { setDetail(d); setStatus(d.status); }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, [po_number]);
  const onUpdate = async () => { await updatePurchaseStatus(po_number, status); setLoading(true); await load(); };
  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <p>No purchase orders found</p>;
  return <div><h3>{detail.po_number}</h3><p>Status: {detail.status}</p><select value={status} onChange={(e) => setStatus(e.target.value)}><option>approved</option><option>sent</option><option>received</option></select><button onClick={onUpdate}>Update</button>
  <table><tbody>{detail.lines.map((l, i) => <tr key={i}><td>{l.sku}</td><td>{l.qty}</td></tr>)}</tbody></table></div>;
}
