ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'PUT_AWAY';
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'RECEIPT_REVERSAL';
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'PURCHASE_RETURN';

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS original_eta timestamptz;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_changed_count integer NOT NULL DEFAULT 0;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS destination_warehouse_id integer REFERENCES warehouses(id);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS destination_bin text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dispatch_date timestamptz;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS supplier_comments text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS internal_notes text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS last_updated_by integer REFERENCES users(id);

UPDATE shipments SET original_eta=eta WHERE original_eta IS NULL AND eta IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_putaway_tasks (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_number text NOT NULL,
  receipt_id integer NOT NULL REFERENCES ap_receipts(id) ON DELETE RESTRICT,
  receipt_item_id integer NOT NULL REFERENCES ap_receipt_items(id) ON DELETE RESTRICT,
  warehouse_id integer NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id integer NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(19,4) NOT NULL CHECK (quantity > 0),
  from_location text NOT NULL DEFAULT 'Receiving bay',
  to_bin text,
  assigned_user_id integer REFERENCES users(id),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ASSIGNED','IN_PROGRESS','COMPLETED','EXCEPTION','CANCELLED')),
  due_at timestamptz,
  completed_at timestamptz,
  completed_by integer REFERENCES users(id),
  exception_reason text,
  movement_id integer REFERENCES stock_movements(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, task_number),
  UNIQUE (organization_id, receipt_item_id)
);

CREATE INDEX IF NOT EXISTS inventory_putaway_tasks_org_status_due_idx
  ON inventory_putaway_tasks (organization_id, status, due_at, id DESC);
CREATE INDEX IF NOT EXISTS inventory_putaway_tasks_org_receipt_idx
  ON inventory_putaway_tasks (organization_id, receipt_id, id);
