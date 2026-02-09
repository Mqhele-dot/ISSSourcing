import React, { useEffect, useState } from 'react';
import { adjustInventory, fetchInventoryDetail, fetchInventoryMovements, InventoryDetail, InventoryMovement } from '../api';
import { useParams } from 'react-router-dom';
import { LoginPrompt } from './common';
import { ChangeSummary } from './ChangeSummary';
import { can, currentRole, requiresText } from '../utils/rbac';
import { Button, Card, Input, Select, Table, Skeleton } from '../components/ui';

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
      setDetail(d); setMovements(m.items); setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally { setLoading(false); }
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
    } finally { setSaving(false); }
  };

  const role = currentRole();
  const allowed = can(role, 'inventory.adjust');

  if (loading) return <Skeleton />;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <Card><p>No inventory records found</p></Card>;

  return <div className="panel">
    <div className="page-header"><h2 style={{ margin: 0 }}>Inventory Detail · {detail.sku}</h2><p className="muted" style={{ margin: '6px 0 0' }}>Position, adjustments, and movement timeline.</p></div>
    <div className="grid-2">
      <Card>
        <h3>Current position</h3>
        <Table><thead><tr><th>Location</th><th>On hand</th><th>Available</th><th>Updated</th></tr></thead><tbody>{detail.positions.map((p) => <tr key={`${p.sku}-${p.location}`}><td>{p.location}</td><td>{p.on_hand}</td><td>{p.available}</td><td>{p.updated_at}</td></tr>)}</tbody></Table>
      </Card>
      <Card>
        <h3>Adjust stock</h3>
        <div className="panel">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" />
          <Input type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))} />
          <Select value={movementType} onChange={(e) => setMovementType(e.target.value)}><option value="adjust">adjust</option><option value="consume">consume</option><option value="reconcile">reconcile</option><option value="receive_po">receive_po</option></Select>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
          <Input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} placeholder="Source reference" />
          <Button variant="primary" onClick={onAdjust} disabled={!allowed || saving} title={!allowed ? requiresText('inventory.adjust') : ''}>{saving ? 'Saving…' : 'Adjust'}</Button>
        </div>
      </Card>
    </div>
    <ChangeSummary changed={changed} message={changed?.exceptions?.length ? 'Exception created from adjustment' : null} />
    <Card>
      <h3>Movement timeline</h3>
      {movements.length === 0 ? <p className="muted">No movements yet</p> : <Table><thead><tr><th>At</th><th>Type</th><th>Delta</th><th>Source</th><th>Actor</th><th>Reason</th></tr></thead><tbody>{movements.map((m) => <tr key={m.id}><td>{m.created_at}</td><td>{m.movement_type}</td><td>{m.delta}</td><td>{m.source_ref}</td><td>{m.actor ?? m.created_by}</td><td>{m.reason}</td></tr>)}</tbody></Table>}
    </Card>
  </div>;
}
