import React, { useEffect, useState } from 'react';
import { deliverShipment, fetchShipment, ShipmentDetail, updateShipmentStatus } from '../api';
import { useParams } from 'react-router-dom';
import { LoginPrompt } from './common';
import { ChangeSummary } from './ChangeSummary';
import { can, currentRole, requiresText } from '../utils/rbac';
import { Badge, Button, Card, Select, Skeleton, Table } from '../components/ui';

export function LogisticsDetailPage() {
  const { shipment_id = '' } = useParams();
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [status, setStatus] = useState('in_transit');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => fetchShipment(shipment_id)
    .then((d) => { setDetail(d); setStatus(d.status); })
    .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed'))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, [shipment_id]);

  const onUpdate = async () => {
    setSaving(true);
    try { await updateShipmentStatus(shipment_id, status); setLoading(true); await load(); setError(null); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Status update failed'); }
    finally { setSaving(false); }
  };

  const onDeliver = async () => {
    setDelivering(true);
    try {
      const result = await deliverShipment(shipment_id);
      setChanged(result.changed); setMessage(result.message);
      setLoading(true); await load(); setError(null);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Deliver failed'); }
    finally { setDelivering(false); }
  };

  const role = currentRole();
  const canUpdate = can(role, 'logistics.update');
  const canDeliver = can(role, 'logistics.deliver');

  if (loading) return <Skeleton />;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <Card><p>No shipment found</p></Card>;

  return <div className="panel">
    <div className="page-header"><h2 style={{ margin: 0 }}>Shipment · {detail.shipment_id}</h2><p className="muted" style={{ margin: '6px 0 0' }}>{detail.carrier ?? '-'} · {detail.origin ?? '-'} → {detail.dest ?? '-'}</p></div>
    <div className="grid-2">
      <Card><h3>Shipment header</h3><p>Status: <Badge tone={detail.status === 'delivered' ? 'success' : 'info'}>{detail.status}</Badge></p><p>PO: {detail.po_number ?? '-'}</p><p>ETA: {detail.eta ?? '-'}</p></Card>
      <Card><h3>Actions</h3><div className="toolbar"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="in_transit">in_transit</option><option value="delivered">delivered</option><option value="delayed">delayed</option></Select><Button onClick={onUpdate} disabled={!canUpdate || saving} title={!canUpdate ? requiresText('logistics.update') : ''}>{saving ? 'Saving…' : 'Update status'}</Button><Button variant="primary" onClick={onDeliver} disabled={!canDeliver || delivering} title={!canDeliver ? requiresText('logistics.deliver') : ''}>{delivering ? 'Delivering…' : 'Mark delivered'}</Button></div></Card>
    </div>
    <ChangeSummary changed={changed} message={message} />
    <Card><h3>Timeline</h3>{(detail.events?.length ?? 0) === 0 ? <p className="muted">No events yet</p> : <Table><thead><tr><th>Status</th><th>At</th></tr></thead><tbody>{(detail.events ?? []).map((ev, idx) => <tr key={idx}><td>{ev.status}</td><td>{ev.at}</td></tr>)}</tbody></Table>}</Card>
  </div>;
}
