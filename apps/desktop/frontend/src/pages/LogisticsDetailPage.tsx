import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchShipment, ShipmentDetail, updateShipmentStatus } from '../api';
import { LoginPrompt } from './common';

export function LogisticsDetailPage() {
  const { shipment_id = '' } = useParams();
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [status, setStatus] = useState('delivered');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = () => fetchShipment(shipment_id).then((d) => { setDetail(d); setStatus(d.status); }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed')).finally(() => setLoading(false));
  useEffect(() => { load(); }, [shipment_id]);
  const onUpdate = async () => { await updateShipmentStatus(shipment_id, status); setLoading(true); await load(); };
  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <p>No shipments found</p>;
  return <div><h3>{detail.shipment_id}</h3><p>Status: {detail.status}</p><select value={status} onChange={(e) => setStatus(e.target.value)}><option>in_transit</option><option>delivered</option></select><button onClick={onUpdate}>Update</button></div>;
}
