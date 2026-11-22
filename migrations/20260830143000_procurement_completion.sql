-- Procurement completion foundation. Existing requisition, PO, sourcing, receipt,
-- exception, and AP records remain authoritative and are not duplicated.

CREATE TABLE IF NOT EXISTS procurement_feature_settings (
  organization_id integer PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  phase1_enabled boolean NOT NULL DEFAULT true,
  phase2_enabled boolean NOT NULL DEFAULT false,
  phase3_enabled boolean NOT NULL DEFAULT false,
  phase4_enabled boolean NOT NULL DEFAULT false,
  confirmation_due_days integer NOT NULL DEFAULT 3 CHECK (confirmation_due_days BETWEEN 1 AND 90),
  budget_control_mode text NOT NULL DEFAULT 'WARN_APPROVAL'
    CHECK (budget_control_mode IN ('WARNING_ONLY','WARN_APPROVAL','HARD_BLOCK')),
  receipt_over_tolerance_pct numeric(9,4) NOT NULL DEFAULT 0,
  price_variance_tolerance_pct numeric(9,4) NOT NULL DEFAULT 0,
  quantity_variance_tolerance_pct numeric(9,4) NOT NULL DEFAULT 0,
  updated_by integer REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS po_supplier_confirmations (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purchase_order_id integer NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  supplier_id integer NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('AWAITING','CONFIRMED','REJECTED','CLARIFICATION_REQUESTED')),
  reason text,
  promised_delivery_date timestamptz,
  source text NOT NULL DEFAULT 'INTERNAL' CHECK (source IN ('SYSTEM','INTERNAL','SUPPLIER_PORTAL','MIGRATION')),
  actor_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS po_supplier_confirmations_org_po_created_idx
  ON po_supplier_confirmations (organization_id, purchase_order_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS po_supplier_confirmations_one_awaiting_idx
  ON po_supplier_confirmations (organization_id, purchase_order_id)
  WHERE status = 'AWAITING';

ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS contract_number text;
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS owner_user_id integer REFERENCES users(id);
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'DRAFT';
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS maximum_value numeric(19,4);
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS committed_value numeric(19,4) NOT NULL DEFAULT 0;
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS renewal_date timestamptz;
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS release_rules jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_contracts_org_number_uidx
  ON supplier_contracts (organization_id, contract_number) WHERE contract_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS supplier_contract_lines (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id integer NOT NULL REFERENCES supplier_contracts(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  item_id integer REFERENCES inventory_items(id),
  description text NOT NULL,
  unit_of_measure_id integer REFERENCES units_of_measure(id),
  currency_code text NOT NULL,
  unit_price numeric(19,4) NOT NULL CHECK (unit_price >= 0),
  minimum_quantity numeric(19,4) NOT NULL DEFAULT 0,
  maximum_quantity numeric(19,4),
  tax_code_id integer REFERENCES tax_codes(id),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (contract_id, line_number)
);

CREATE TABLE IF NOT EXISTS supplier_contract_releases (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id integer NOT NULL REFERENCES supplier_contracts(id) ON DELETE RESTRICT,
  requisition_id integer REFERENCES purchase_requisitions(id) ON DELETE RESTRICT,
  purchase_order_id integer NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  release_amount numeric(19,4) NOT NULL CHECK (release_amount > 0),
  released_by integer REFERENCES users(id),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, purchase_order_id)
);

CREATE TABLE IF NOT EXISTS supplier_price_lists (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id integer NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  currency_code text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','EXPIRED')),
  approved_by integer REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS supplier_price_list_lines (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  price_list_id bigint NOT NULL REFERENCES supplier_price_lists(id) ON DELETE CASCADE,
  item_id integer REFERENCES inventory_items(id),
  description text NOT NULL,
  unit_of_measure_id integer REFERENCES units_of_measure(id),
  minimum_quantity numeric(19,4) NOT NULL DEFAULT 0,
  unit_price numeric(19,4) NOT NULL CHECK (unit_price >= 0),
  lead_time_days integer,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS supplier_price_list_lines_lookup_idx
  ON supplier_price_list_lines (organization_id, item_id, minimum_quantity DESC, id DESC);

CREATE TABLE IF NOT EXISTS finance_budgets (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fiscal_year integer NOT NULL,
  currency_code text NOT NULL,
  department_id integer REFERENCES departments(id),
  cost_centre_id integer REFERENCES mdm_cost_centres(id),
  project_id integer,
  gl_account_code text,
  approved_amount numeric(19,4) NOT NULL CHECK (approved_amount >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budget_commitments (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  budget_id bigint REFERENCES finance_budgets(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('REQUISITION','PURCHASE_ORDER','RECEIPT','INVOICE')),
  source_id integer NOT NULL,
  parent_commitment_id bigint REFERENCES budget_commitments(id),
  amount numeric(19,4) NOT NULL,
  currency_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','TRANSFERRED','REALIZED','RELEASED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS goods_receipt_reversals (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  receipt_id integer NOT NULL REFERENCES ap_receipts(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  reversed_by integer REFERENCES users(id),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, receipt_id),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  return_number text NOT NULL,
  purchase_order_id integer NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  receipt_id integer NOT NULL REFERENCES ap_receipts(id) ON DELETE RESTRICT,
  supplier_id integer NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id integer NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','DISPATCHED','ACKNOWLEDGED','CLOSED','CANCELLED')),
  reason text NOT NULL,
  created_by integer REFERENCES users(id),
  approved_by integer REFERENCES users(id),
  approved_at timestamptz,
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, return_number)
);

CREATE TABLE IF NOT EXISTS purchase_return_lines (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  return_id bigint NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  receipt_item_id integer NOT NULL REFERENCES ap_receipt_items(id) ON DELETE RESTRICT,
  item_id integer NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(19,4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(19,4) NOT NULL DEFAULT 0,
  tax_amount numeric(19,4) NOT NULL DEFAULT 0,
  batch_number text,
  serial_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_debit_notes (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  debit_note_number text NOT NULL,
  return_id bigint NOT NULL REFERENCES purchase_returns(id) ON DELETE RESTRICT,
  supplier_id integer NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  currency_code text NOT NULL,
  subtotal numeric(19,4) NOT NULL,
  tax_amount numeric(19,4) NOT NULL,
  total_amount numeric(19,4) NOT NULL,
  status text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('DRAFT','ISSUED','ACKNOWLEDGED','APPLIED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, debit_note_number),
  UNIQUE (organization_id, return_id)
);

CREATE INDEX IF NOT EXISTS purchase_returns_org_status_updated_idx
  ON purchase_returns (organization_id, status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS budget_commitments_org_status_idx
  ON budget_commitments (organization_id, status, id DESC);

-- Compatibility-safe status normalization. Unresolved CONVERTED records remain
-- CONVERTED and are surfaced as legacy conversion findings rather than guessed.
UPDATE purchase_requisitions SET status = 'PENDING_APPROVAL' WHERE upper(status) = 'PENDING';

-- Preserve historical acknowledgement as independent supplier evidence.
INSERT INTO po_supplier_confirmations (
  organization_id, purchase_order_id, supplier_id, status, source, created_at
)
SELECT po.organization_id, po.id, po.supplier_id, 'CONFIRMED', 'MIGRATION', COALESCE(po.updated_at, now())
FROM purchase_orders po
WHERE upper(po.status) = 'ACKNOWLEDGED'
  AND NOT EXISTS (
    SELECT 1 FROM po_supplier_confirmations c
    WHERE c.organization_id = po.organization_id AND c.purchase_order_id = po.id
  );
