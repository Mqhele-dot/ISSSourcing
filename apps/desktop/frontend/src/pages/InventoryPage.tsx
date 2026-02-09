import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchInventory, InventoryRow } from '../api';
import { LoadDemoDataButton, LoginPrompt } from './common';
import { Card, Input, Select, Table } from '../components/ui';

export function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [filter, setFilter] = useState('');
  const [location, setLocation] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => fetchInventory().then(setRows).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) => `${r.sku} ${r.location}`.toLowerCase().includes(filter.toLowerCase())).filter((r) => location === 'all' || r.location === location);

  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (filtered.length === 0) return <Card><p>No inventory records found</p><LoadDemoDataButton onLoaded={() => { setLoading(true); void load(); }} /></Card>;

  const locations = ['all', ...Array.from(new Set(rows.map((r) => r.location)))];

  return <Card><h3>Inventory</h3><div className="grid-2"><Input placeholder="Search SKU/location" value={filter} onChange={(e) => setFilter(e.target.value)} /><Select value={location} onChange={(e) => setLocation(e.target.value)}>{locations.map((l) => <option key={l} value={l}>{l}</option>)}</Select></div>
    <Table><thead><tr><th>SKU</th><th>Location</th><th>On hand</th><th>Available</th></tr></thead><tbody>
      {filtered.map((row) => <tr key={`${row.sku}-${row.location}`}><td><Link to={`/inventory/${row.sku}`}>{row.sku}</Link></td><td>{row.location}</td><td>{row.on_hand}</td><td>{row.available}</td></tr>)}
    </tbody></Table></Card>;
}
