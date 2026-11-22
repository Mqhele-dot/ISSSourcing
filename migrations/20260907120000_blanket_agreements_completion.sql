-- Complete the governed blanket/framework agreement lifecycle without replacing
-- historical supplier_contracts records or their compatibility APIs.

ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS default_delivery_address text;
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS renewal_notice_days integer NOT NULL DEFAULT 30
  CHECK (renewal_notice_days BETWEEN 0 AND 3650);
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS submitted_by integer REFERENCES users(id);
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS approved_by integer REFERENCES users(id);
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS lifecycle_reason text;

-- Older contracts treated operational status and approval status independently.
-- Draft/pending agreements must never appear active or become pricing authority.
UPDATE supplier_contracts
SET status = 'draft', updated_at = now()
WHERE approval_status IN ('DRAFT', 'PENDING_APPROVAL')
  AND status = 'active';

ALTER TABLE supplier_contract_lines ADD COLUMN IF NOT EXISTS line_type text NOT NULL DEFAULT 'CATALOG'
  CHECK (line_type IN ('CATALOG','NON_STOCK','SERVICE'));
ALTER TABLE supplier_contract_lines ADD COLUMN IF NOT EXISTS lead_time_days integer
  CHECK (lead_time_days IS NULL OR lead_time_days >= 0);
ALTER TABLE supplier_contract_lines ADD COLUMN IF NOT EXISTS committed_quantity numeric(19,4) NOT NULL DEFAULT 0
  CHECK (committed_quantity >= 0);

CREATE TABLE IF NOT EXISTS supplier_contract_price_breaks (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_line_id bigint NOT NULL REFERENCES supplier_contract_lines(id) ON DELETE CASCADE,
  minimum_quantity numeric(19,4) NOT NULL CHECK (minimum_quantity > 0),
  unit_price numeric(19,4) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_line_id, minimum_quantity)
);

CREATE TABLE IF NOT EXISTS supplier_contract_versions (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id integer NOT NULL REFERENCES supplier_contracts(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  change_reason text NOT NULL,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, contract_id, version)
);

CREATE TABLE IF NOT EXISTS supplier_contract_release_lines (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  release_id bigint NOT NULL REFERENCES supplier_contract_releases(id) ON DELETE CASCADE,
  contract_line_id bigint NOT NULL REFERENCES supplier_contract_lines(id) ON DELETE RESTRICT,
  requisition_item_id integer NOT NULL REFERENCES purchase_requisition_items(id) ON DELETE RESTRICT,
  purchase_order_item_id integer NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  quantity numeric(19,4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(19,4) NOT NULL CHECK (unit_price >= 0),
  line_amount numeric(19,4) NOT NULL CHECK (line_amount >= 0),
  UNIQUE (release_id, requisition_item_id)
);

CREATE INDEX IF NOT EXISTS supplier_contracts_org_lifecycle_idx
  ON supplier_contracts (organization_id, approval_status, status, end_date, id DESC);
CREATE INDEX IF NOT EXISTS supplier_contract_releases_org_contract_idx
  ON supplier_contract_releases (organization_id, contract_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS supplier_contract_release_lines_org_release_idx
  ON supplier_contract_release_lines (organization_id, release_id, id);
