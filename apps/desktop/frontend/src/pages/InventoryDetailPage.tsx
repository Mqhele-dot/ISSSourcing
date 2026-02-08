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
  const [sourceRef, setSourceRef] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetchInventoryDetail(sku).then(setDetail).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, [sku]);

  const onAdjust = async () => {
    setSaving(true);
    try {
      await adjustInventory({ sku, location, delta, reason, movement_type: 'adjust', source_ref: sourceRef });
      setLoading(true);
      await load();
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Adjustment failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <p>No inventory records found</p>;

  return <div><h3>Inventory Detail: {detail.sku}</h3>
    <h4>Adjust</h4>
    <input value={location} onChange={(e) => setLocation(e.target.value)} />
    <input type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))} />
    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
    <input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} placeholder="Source reference (optional)" />
    <button onClick={onAdjust} disabled={saving}>{saving ? 'Saving…' : 'Adjust'}</button>
    <h4>Positions</h4><table><tbody>{detail.positions.map((p) => <tr key={`${p.sku}-${p.location}`}><td>{p.location}</td><td>{p.on_hand}</td><td>{p.available}</td><td>{p.updated_at}</td></tr>)}</tbody></table>
    <h4>Movements</h4><table><thead><tr><th>Location</th><th>Type</th><th>Delta</th><th>Reason</th><th>Source Ref</th><th>At</th></tr></thead><tbody>{detail.movements.map((m: any) => <tr key={m.id}><td>{m.location}</td><td>{m.movement_type ?? 'adjust'}</td><td>{m.delta}</td><td>{m.reason}</td><td>{m.source_ref ?? ''}</td><td>{m.created_at}</td></tr>)}</tbody></table>
  </div>;
}
