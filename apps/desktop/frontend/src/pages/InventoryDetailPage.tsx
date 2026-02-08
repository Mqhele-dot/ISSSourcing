import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adjustInventory, fetchInventoryDetail, InventoryDetail } from '../api';
import { LoginPrompt } from './common';

export function InventoryDetailPage() {
  const { sku = '' } = useParams();
  const [detail, setDetail] = useState<InventoryDetail | null>(null);
  const [location, setLocation] = useState('WH-JHB');
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState('Cycle count');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetchInventoryDetail(sku).then(setDetail).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, [sku]);

  const onAdjust = async () => {
    await adjustInventory({ sku, location, delta, reason });
    setLoading(true);
    await load();
  };

  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <p>No inventory records found</p>;

  return <div><h3>Inventory Detail: {detail.sku}</h3>
    <h4>Adjust</h4>
    <input value={location} onChange={(e) => setLocation(e.target.value)} />
    <input type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))} />
    <input value={reason} onChange={(e) => setReason(e.target.value)} />
    <button onClick={onAdjust}>Adjust</button>
    <h4>Positions</h4><table><tbody>{detail.positions.map((p) => <tr key={`${p.sku}-${p.location}`}><td>{p.location}</td><td>{p.on_hand}</td><td>{p.available}</td></tr>)}</tbody></table>
    <h4>Movements</h4><table><tbody>{detail.movements.map((m) => <tr key={m.id}><td>{m.location}</td><td>{m.delta}</td><td>{m.reason}</td></tr>)}</tbody></table>
  </div>;
}
