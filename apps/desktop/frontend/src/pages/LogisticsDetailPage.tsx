import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { deliverShipment, fetchShipment, ShipmentDetail, updateShipmentStatus } from '../api';
import { LoginPrompt } from './common';
import { ChangeSummary } from './ChangeSummary';
import { can, currentRole, requiresText } from '../utils/rbac';

export function LogisticsDetailPage() {
  const { shipment_id = '' } = useParams();
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [status, setStatus] = useState('delivered');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<any>(null);

  const load = () => fetchShipment(shipment_id).then((d) => { setDetail(d); setStatus(d.status); setError(null); }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, [shipment_id]);

  const onUpdate = async () => {
    setSaving(true);
    try {
      await updateShipmentStatus(shipment_id, status);
      setLoading(true);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const onDeliver = async () => {
    setDelivering(true);
    try {
      const result = await deliverShipment(shipment_id);
      setChanged(result.changed);
      setLoading(true);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Deliver failed');
    } finally {
      setDelivering(false);
    }
  };

  const role = currentRole();
  const allowed = can(role, 'logistics.deliver');

  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <p>No shipments found</p>;
  return (
    <div>
      <h3>{detail.shipment_id}</h3>
      <p>Status: {detail.status}</p>
      {detail.po_number ? <p>Linked PO: <Link to={`/purchase/${detail.po_number}`}>{detail.po_number}</Link></p> : <p>Linked PO: none</p>}
      <select value={status} onChange={(e) => setStatus(e.target.value)}><option>in_transit</option><option>delivered</option></select>
      <button onClick={onUpdate} disabled={saving}>{saving ? 'Saving…' : 'Update'}</button>
      <button onClick={onDeliver} disabled={!allowed || delivering} title={!allowed ? requiresText('logistics.deliver') : ''}>{delivering ? 'Saving…' : 'Deliver shipment'}</button>
      <ChangeSummary changed={changed} message="Delivery action completed" />
      <h4>Events timeline</h4>
      {(detail.events ?? []).length === 0 ? <p>No events</p> : <table><tbody>{(detail.events ?? []).map((e, i) => <tr key={i}><td>{e.at}</td><td>{e.status}</td></tr>)}</tbody></table>}
    </div>
  );
}
