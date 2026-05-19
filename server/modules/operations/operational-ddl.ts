import { pool } from "../../db";

/** Raw DDL for operational tables (idempotent ALTER/CREATE). */
export const OPERATIONAL_TABLE_DDLS = [
  `
  ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS default_location text
  `,
  `
  ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS uom text
  `,
  `
  CREATE TABLE IF NOT EXISTS inventory_positions (
    id serial PRIMARY KEY,
    sku text NOT NULL,
    location text NOT NULL,
    on_hand integer NOT NULL DEFAULT 0,
    allocated integer NOT NULL DEFAULT 0,
    updated_at timestamp NOT NULL DEFAULT now(),
    UNIQUE (sku, location)
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS inventory_movements (
    id serial PRIMARY KEY,
    sku text NOT NULL,
    location text NOT NULL,
    delta integer NOT NULL,
    reason text NOT NULL,
    ref text,
    created_by text,
    created_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS operational_exceptions (
    id serial PRIMARY KEY,
    type text NOT NULL,
    severity text NOT NULL DEFAULT 'medium',
    status text NOT NULL DEFAULT 'open',
    title text NOT NULL,
    description text,
    related_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
    assignee text,
    sla_hours integer NOT NULL DEFAULT 24,
    comments jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS ops_activity_feed (
    id serial PRIMARY KEY,
    event_type text NOT NULL,
    title text NOT NULL,
    details text,
    related_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS ops_activity (
    id serial PRIMARY KEY,
    created_at timestamp NOT NULL DEFAULT now(),
    actor text NOT NULL DEFAULT 'system',
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    summary_json jsonb NOT NULL DEFAULT '{}'::jsonb
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_ops_activity_entity_created
  ON ops_activity (entity_type, entity_id, created_at DESC)
  `,
  `
  CREATE TABLE IF NOT EXISTS shipments (
    id serial PRIMARY KEY,
    po_number text NOT NULL,
    carrier text,
    status text NOT NULL DEFAULT 'created',
    eta timestamp,
    drift_minutes integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tracking_number text
  `,
  `
  CREATE TABLE IF NOT EXISTS shipment_events (
    id serial PRIMARY KEY,
    shipment_id integer NOT NULL,
    status text NOT NULL,
    note text,
    event_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS integration_runs (
    id serial PRIMARY KEY,
    connector text NOT NULL,
    status text NOT NULL,
    started_at timestamp NOT NULL DEFAULT now(),
    finished_at timestamp,
    message text
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS purchase_order_events (
    id serial PRIMARY KEY,
    po_number text NOT NULL,
    event_type text NOT NULL,
    note text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS purchase_order_id integer REFERENCES purchase_orders(id)
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS carrier_id integer REFERENCES carriers(id)
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS transport_mode text
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS freight_cost double precision
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS vehicle text
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS driver text
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS delivery_note_ref text
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS grn_number text
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS direction text DEFAULT 'inbound'
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'purchase_order'
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS source_id integer
  `,
  `
  ALTER TABLE shipments ADD COLUMN IF NOT EXISTS source_ref text
  `,
  `
  UPDATE shipments SET direction = 'inbound' WHERE direction IS NULL
  `,
  `
  UPDATE shipments SET source_type = 'purchase_order' WHERE source_type IS NULL AND po_number IS NOT NULL
  `,
  `
  UPDATE shipments s SET source_id = po.id, source_ref = po.order_number
  FROM purchase_orders po WHERE s.po_number = po.order_number AND s.source_id IS NULL
  `,
];

/** Apply DDL and seed demo shipments when empty. */
export async function initializeOperationalData() {
  for (const ddl of OPERATIONAL_TABLE_DDLS) {
    await pool.query(ddl);
  }

  await pool.query(`
    INSERT INTO inventory_positions (sku, location, on_hand, allocated, updated_at)
    SELECT
      i.sku,
      COALESCE(NULLIF(i.default_location, ''), NULLIF(i.location, ''), 'Main Warehouse') AS location,
      COALESCE(i.quantity, 0) AS on_hand,
      0 AS allocated,
      now()
    FROM inventory_items i
    ON CONFLICT (sku, location) DO NOTHING
  `);

  const shipmentCountResult = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM shipments`,
  );
  const shipmentCount = Number(shipmentCountResult.rows[0]?.count ?? "0");

  if (shipmentCount === 0) {
    await pool.query(`
      INSERT INTO shipments (po_number, carrier, status, eta, created_at, updated_at)
      SELECT
        po.order_number,
        'Demo Carrier',
        CASE
          WHEN lower(po.status) = 'received' THEN 'delivered'
          WHEN lower(po.status) IN ('approved', 'sent') THEN 'in_transit'
          ELSE 'created'
        END AS status,
        now() + interval '2 days' AS eta,
        now(),
        now()
      FROM purchase_orders po
      ORDER BY po.created_at DESC
      LIMIT 10
    `);
  }
}
