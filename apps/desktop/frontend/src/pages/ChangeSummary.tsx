import React from 'react';
import { Link } from 'react-router-dom';

type Changed = {
  inventory?: Array<{ sku?: string }>;
  shipments?: Array<{ shipment_id?: string }>;
  exceptions?: Array<{ id?: number }>;
};

export function ChangeSummary({ changed, message }: { changed: Changed | null; message?: string | null }) {
  if (!changed && !message) return null;
  const inv = changed?.inventory ?? [];
  const shp = changed?.shipments ?? [];
  const exc = changed?.exceptions ?? [];
  return (
    <div>
      <h4>Change Summary</h4>
      {message ? <p>{message}</p> : null}
      <ul>
        <li>Inventory: {inv.length}</li>
        <li>Shipments: {shp.length}</li>
        <li>Exceptions: {exc.length}</li>
      </ul>
      {exc.length > 0 ? <p>{exc.map((e, i) => <span key={i}><Link to={`/exceptions/${e.id}`}>Exception {e.id}</Link>{i < exc.length - 1 ? ', ' : ''}</span>)}</p> : null}
    </div>
  );
}
