import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchShipments, ShipmentRow } from '../api';
import { LoginPrompt } from './common';

export function LogisticsPage() {
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = () => fetchShipments(status ? { status } : undefined).then(setRows).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, [status]);
  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (rows.length === 0) return <p>No shipments found</p>;
  return <div><h3>Logistics</h3><select value={status} onChange={(e) => { setLoading(true); setStatus(e.target.value); }}><option value="">all</option><option value="in_transit">in_transit</option><option value="delivered">delivered</option></select>
  <table><tbody>{rows.map((r) => <tr key={r.shipment_id}><td><Link to={`/logistics/${r.shipment_id}`}>{r.shipment_id}</Link></td><td>{r.status}</td><td>{r.eta}</td></tr>)}</tbody></table></div>;
}
