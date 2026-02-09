import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPurchaseOrders, PurchaseOrderRow } from '../api';
import { LoadDemoDataButton, LoginPrompt } from './common';

export function PurchasePage() {
  const [rows, setRows] = useState<PurchaseOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetchPurchaseOrders().then(setRows).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed')).finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (rows.length === 0) return <div><p>No purchase orders found</p><LoadDemoDataButton onLoaded={() => { setLoading(true); void load(); }} /></div>;

  return <div><h3>Purchase</h3><table><tbody>{rows.map((r) => <tr key={r.po_number}><td><Link to={`/purchase/${r.po_number}`}>{r.po_number}</Link></td><td>{r.status}</td><td>{r.lines}</td></tr>)}</tbody></table></div>;
}
