import React, { useEffect, useState } from 'react';
import { adjustInventory, fetchInventoryDetail, fetchInventoryMovements, InventoryDetail, InventoryMovement } from '../api';
import { useParams } from 'react-router-dom';
import { LoginPrompt } from './common';
import { ChangeSummary } from './ChangeSummary';
import { can, currentRole, requiresText } from '../utils/rbac';

export function InventoryDetailPage() {
  const { sku = '' } = useParams();
  const [detail, setDetail] = useState<InventoryDetail | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [location, setLocation] = useState('WH-JHB');
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState('Cycle count');
  const [sourceRef, setSourceRef] = useState('');
  const [movementType, setMovementType] = useState('adjust');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<any>(null);

  const load = async () => {
    try {
      const [d, m] = await Promise.all([fetchInventoryDetail(sku), fetchInventoryMovements(sku)]);
      setDetail(d);
      setMovements(m.items);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [sku]);

  const onAdjust = async () => {
    setSaving(true);
    try {
      const result = await adjustInventory({ sku, location, delta, reason, movement_type: movementType, source_ref: sourceRef });
      setChanged(result.changed ?? null);
      setLoading(true);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Adjustment failed');
    } finally {
      setSaving(false);
    }
  };

  const role = currentRole();
  const allowed = can(role, 'inventory.adjust');

  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <p>No inventory records found</p>;

  return (
    <div>
      <h3>Inventory Detail: {detail.sku}</h3>
      <h4>Current position</h4>
      <table><tbody>{detail.positions.map((p) => <tr key={`${p.sku}-${p.location}`}><td>{p.location}</td><td>{p.on_hand}</td><td>{p.available}</td><td>{p.updated_at}</td></tr>)}</tbody></table>
      <h4>Adjust stock</h4>
      <input value={location} onChange={(e) => setLocation(e.target.value)} />
      <input type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))} />
      <select value={movementType} onChange={(e) => setMovementType(e.target.value)}><option value="adjust">adjust</option><option value="consume">consume</option><option value="reconcile">reconcile</option><option value="receive_po">receive_po</option></select>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
      <input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} placeholder="Source reference" />
      <button onClick={onAdjust} disabled={!allowed || saving} title={!allowed ? requiresText('inventory.adjust') : ''}>{saving ? 'Saving…' : 'Adjust'}</button>
      <ChangeSummary changed={changed} message={changed?.exceptions?.length ? 'Exception created from adjustment' : null} />

      <h4>Movement timeline</h4>
      {movements.length === 0 ? <p>No movements yet</p> : <table><thead><tr><th>At</th><th>Type</th><th>Delta</th><th>Source</th><th>Actor</th><th>Reason</th></tr></thead><tbody>{movements.map((m) => <tr key={m.id}><td>{m.created_at}</td><td>{m.movement_type}</td><td>{m.delta}</td><td>{m.source_ref}</td><td>{m.actor ?? m.created_by}</td><td>{m.reason}</td></tr>)}</tbody></table>}
    </div>
  );
}
