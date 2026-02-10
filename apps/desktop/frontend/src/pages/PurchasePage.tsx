import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPurchaseOrders, PurchaseOrderRow } from '../api';
import { LoadDemoDataButton, LoginPrompt } from './common';
import { Badge, Card, Select, Table, Skeleton } from '../components/ui';

export function PurchasePage() {
  const [rows, setRows] = useState<PurchaseOrderRow[]>([]);
  const [status, setStatus] = useState('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetchPurchaseOrders(status).then(setRows).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, [status]);

  if (loading) return <Skeleton />;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (rows.length === 0) return <Card><p>No purchase orders found</p><LoadDemoDataButton onLoaded={() => { setLoading(true); void load(); }} /></Card>;

  return <div className="panel"><div className="page-header"><h2 style={{ margin: 0 }}>Purchase Orders</h2><p className="muted" style={{ margin: '6px 0 0' }}>Approve/send/receive operational flow.</p></div><Card><h3>Purchase Orders</h3><Select value={status} onChange={(e) => { setLoading(true); setStatus(e.target.value); }}><option value="open">Open</option><option value="approved">Approved</option><option value="sent">Sent</option><option value="received">Received</option></Select>
    <Table><thead><tr><th>PO</th><th>Status</th><th>Supplier</th><th>Lines</th></tr></thead><tbody>{rows.map((r) => <tr key={r.po_number}><td><Link to={`/purchase/${r.po_number}`}>{r.po_number}</Link></td><td><Badge tone={r.status === 'received' ? 'success' : r.status === 'sent' ? 'info' : 'warning'}>{r.status}</Badge></td><td>{r.supplier}</td><td>{r.lines}</td></tr>)}</tbody></Table></Card></div>;
}
