import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchShipments, ShipmentRow } from '../api';
import { LoadDemoDataButton, LoginPrompt } from './common';
import { Badge, Card, Input, Select, Table, Skeleton } from '../components/ui';

export function LogisticsPage() {
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [status, setStatus] = useState('');
  const [po, setPo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetchShipments({ status: status || undefined, po_number: po || undefined }).then(setRows).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, [status, po]);

  if (loading) return <Skeleton />;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (rows.length === 0) return <Card><p>No shipments found</p><LoadDemoDataButton onLoaded={() => { setLoading(true); void load(); }} /></Card>;

  return <div className="panel"><div className="page-header"><h2 style={{ margin: 0 }}>Logistics</h2><p className="muted" style={{ margin: '6px 0 0' }}>Shipment tracking with filters and ETA visibility.</p></div><Card><h3>Logistics</h3><div className="grid-2"><Select value={status} onChange={(e) => { setLoading(true); setStatus(e.target.value); }}><option value="">all</option><option value="in_transit">in_transit</option><option value="delivered">delivered</option></Select><Input value={po} onChange={(e) => { setLoading(true); setPo(e.target.value); }} placeholder="Filter by PO" /></div>
    <Table><thead><tr><th>Shipment</th><th>Status</th><th>PO</th><th>ETA</th></tr></thead><tbody>{rows.map((r) => <tr key={r.shipment_id}><td><Link to={`/logistics/${r.shipment_id}`}>{r.shipment_id}</Link></td><td><Badge tone={r.status === 'delivered' ? 'success' : 'info'}>{r.status}</Badge></td><td>{r.po_number ?? '-'}</td><td>{r.eta ?? '-'}</td></tr>)}</tbody></Table></Card></div>;
}
