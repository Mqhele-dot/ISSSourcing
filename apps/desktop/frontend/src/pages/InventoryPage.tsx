import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchInventory, InventoryRow } from '../api';
import { LoadDemoDataButton, LoginPrompt } from './common';

export function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => fetchInventory().then(setRows).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed')).finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const filtered = rows.filter((r) => `${r.sku} ${r.location}`.toLowerCase().includes(filter.toLowerCase()));
  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (filtered.length === 0) return <div><p>No inventory records found</p><LoadDemoDataButton onLoaded={() => { setLoading(true); void load(); }} /></div>;

  return <div><h3>Inventory</h3><input placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />
    <table><thead><tr><th>SKU</th><th>Location</th><th>On hand</th><th>Available</th></tr></thead><tbody>
      {filtered.map((row) => <tr key={`${row.sku}-${row.location}`}><td><Link to={`/inventory/${row.sku}`}>{row.sku}</Link></td><td>{row.location}</td><td>{row.on_hand}</td><td>{row.available}</td></tr>)}
    </tbody></table></div>;
}
