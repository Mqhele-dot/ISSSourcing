ALTER TABLE units_of_measure ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);
ALTER TABLE currencies ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);
ALTER TABLE tax_codes ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);
ALTER TABLE commodity_codes ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);
ALTER TABLE incoterms ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);
ALTER TABLE payment_terms ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);

ALTER TABLE units_of_measure DROP CONSTRAINT IF EXISTS units_of_measure_code_unique;
ALTER TABLE currencies DROP CONSTRAINT IF EXISTS currencies_code_unique;
ALTER TABLE tax_codes DROP CONSTRAINT IF EXISTS tax_codes_code_unique;
ALTER TABLE commodity_codes DROP CONSTRAINT IF EXISTS commodity_codes_code_unique;
ALTER TABLE incoterms DROP CONSTRAINT IF EXISTS incoterms_code_unique;
ALTER TABLE payment_terms DROP CONSTRAINT IF EXISTS payment_terms_code_unique;

CREATE UNIQUE INDEX IF NOT EXISTS units_of_measure_org_code_uidx ON units_of_measure (organization_id, code) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS currencies_org_code_uidx ON currencies (organization_id, code) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tax_codes_org_code_uidx ON tax_codes (organization_id, code) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS commodity_codes_org_code_uidx ON commodity_codes (organization_id, code) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS incoterms_org_code_uidx ON incoterms (organization_id, code) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_terms_org_code_uidx ON payment_terms (organization_id, code) WHERE organization_id IS NOT NULL;

INSERT INTO units_of_measure (organization_id, code, name, symbol, base_unit_id, system, active, created_at, updated_at)
SELECT organization.id, source.code, source.name, source.symbol, NULL, source.system, source.active, source.created_at, source.updated_at
FROM organizations organization CROSS JOIN units_of_measure source WHERE source.organization_id IS NULL
ON CONFLICT (organization_id, code) WHERE organization_id IS NOT NULL DO NOTHING;
INSERT INTO currencies (organization_id, code, name, symbol, region_code, region_name, is_main_for_region, exchange_rate_to_zar, decimal_places, active, created_at, updated_at)
SELECT organization.id, source.code, source.name, source.symbol, source.region_code, source.region_name, source.is_main_for_region, source.exchange_rate_to_zar, source.decimal_places, source.active, source.created_at, source.updated_at
FROM organizations organization CROSS JOIN currencies source WHERE source.organization_id IS NULL
ON CONFLICT (organization_id, code) WHERE organization_id IS NOT NULL DO NOTHING;
INSERT INTO tax_codes (organization_id, code, name, rate, type, country_code, active, created_at, updated_at)
SELECT organization.id, source.code, source.name, source.rate, source.type, source.country_code, source.active, source.created_at, source.updated_at
FROM organizations organization CROSS JOIN tax_codes source WHERE source.organization_id IS NULL
ON CONFLICT (organization_id, code) WHERE organization_id IS NOT NULL DO NOTHING;
INSERT INTO commodity_codes (organization_id, code, description, category, active, created_at, updated_at)
SELECT organization.id, source.code, source.description, source.category, source.active, source.created_at, source.updated_at
FROM organizations organization CROSS JOIN commodity_codes source WHERE source.organization_id IS NULL
ON CONFLICT (organization_id, code) WHERE organization_id IS NOT NULL DO NOTHING;
INSERT INTO incoterms (organization_id, code, name, description, active, created_at, updated_at)
SELECT organization.id, source.code, source.name, source.description, source.active, source.created_at, source.updated_at
FROM organizations organization CROSS JOIN incoterms source WHERE source.organization_id IS NULL
ON CONFLICT (organization_id, code) WHERE organization_id IS NOT NULL DO NOTHING;
INSERT INTO payment_terms (organization_id, code, name, net_days, discount_days, discount_percent, active, created_at, updated_at)
SELECT organization.id, source.code, source.name, source.net_days, source.discount_days, source.discount_percent, source.active, source.created_at, source.updated_at
FROM organizations organization CROSS JOIN payment_terms source WHERE source.organization_id IS NULL
ON CONFLICT (organization_id, code) WHERE organization_id IS NOT NULL DO NOTHING;

UPDATE suppliers supplier SET
  payment_terms_id = COALESCE((SELECT scoped.id FROM payment_terms legacy JOIN payment_terms scoped ON scoped.organization_id = supplier.organization_id AND scoped.code = legacy.code WHERE legacy.id = supplier.payment_terms_id), supplier.payment_terms_id),
  tax_code_id = COALESCE((SELECT scoped.id FROM tax_codes legacy JOIN tax_codes scoped ON scoped.organization_id = supplier.organization_id AND scoped.code = legacy.code WHERE legacy.id = supplier.tax_code_id), supplier.tax_code_id),
  incoterm_id = COALESCE((SELECT scoped.id FROM incoterms legacy JOIN incoterms scoped ON scoped.organization_id = supplier.organization_id AND scoped.code = legacy.code WHERE legacy.id = supplier.incoterm_id), supplier.incoterm_id);
UPDATE supplier_contracts contract SET
  payment_terms_id = COALESCE((SELECT scoped.id FROM payment_terms legacy JOIN payment_terms scoped ON scoped.organization_id = contract.organization_id AND scoped.code = legacy.code WHERE legacy.id = contract.payment_terms_id), contract.payment_terms_id),
  default_tax_code_id = COALESCE((SELECT scoped.id FROM tax_codes legacy JOIN tax_codes scoped ON scoped.organization_id = contract.organization_id AND scoped.code = legacy.code WHERE legacy.id = contract.default_tax_code_id), contract.default_tax_code_id),
  incoterm_id = COALESCE((SELECT scoped.id FROM incoterms legacy JOIN incoterms scoped ON scoped.organization_id = contract.organization_id AND scoped.code = legacy.code WHERE legacy.id = contract.incoterm_id), contract.incoterm_id);

-- Some installable databases predate the integer MDM foreign keys and store a
-- UOM/commodity code in these columns. Resolve codes within the item's tenant,
-- preserve numeric legacy IDs for the scoped remap below, and fail closed on
-- values that cannot be attributed safely.
DO $$
DECLARE column_type text;
BEGIN
  SELECT data_type INTO column_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'organization_id';
  IF column_type IS NOT NULL AND column_type <> 'integer' THEN
    UPDATE inventory_items
    SET organization_id = NULL
    WHERE organization_id IS NOT NULL AND organization_id::text !~ '^[0-9]+$';
    ALTER TABLE inventory_items ALTER COLUMN organization_id TYPE integer
      USING NULLIF(organization_id::text, '')::integer;
  END IF;

  SELECT data_type INTO column_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'unit_of_measure_id';
  IF column_type IS NOT NULL AND column_type <> 'integer' THEN
    UPDATE inventory_items item
    SET unit_of_measure_id = scoped.id::text
    FROM units_of_measure scoped
    WHERE scoped.organization_id = item.organization_id
      AND (scoped.code = item.unit_of_measure_id::text OR scoped.id::text = item.unit_of_measure_id::text);
    UPDATE inventory_items
    SET unit_of_measure_id = NULL
    WHERE unit_of_measure_id IS NOT NULL AND unit_of_measure_id::text !~ '^[0-9]+$';
    ALTER TABLE inventory_items ALTER COLUMN unit_of_measure_id TYPE integer
      USING NULLIF(unit_of_measure_id::text, '')::integer;
  END IF;

  SELECT data_type INTO column_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'commodity_code_id';
  IF column_type IS NOT NULL AND column_type <> 'integer' THEN
    UPDATE inventory_items item
    SET commodity_code_id = scoped.id::text
    FROM commodity_codes scoped
    WHERE scoped.organization_id = item.organization_id
      AND (scoped.code = item.commodity_code_id::text OR scoped.id::text = item.commodity_code_id::text);
    UPDATE inventory_items
    SET commodity_code_id = NULL
    WHERE commodity_code_id IS NOT NULL AND commodity_code_id::text !~ '^[0-9]+$';
    ALTER TABLE inventory_items ALTER COLUMN commodity_code_id TYPE integer
      USING NULLIF(commodity_code_id::text, '')::integer;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE $remap$
    UPDATE inventory_items item SET
      unit_of_measure_id = COALESCE((SELECT scoped.id FROM units_of_measure legacy JOIN units_of_measure scoped ON scoped.organization_id = item.organization_id AND scoped.code = legacy.code WHERE legacy.id = item.unit_of_measure_id), item.unit_of_measure_id),
      commodity_code_id = COALESCE((SELECT scoped.id FROM commodity_codes legacy JOIN commodity_codes scoped ON scoped.organization_id = item.organization_id AND scoped.code = legacy.code WHERE legacy.id = item.commodity_code_id), item.commodity_code_id)
  $remap$;
END $$;

CREATE TABLE IF NOT EXISTS inventory_issues (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  issue_number text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED')),
  warehouse_id integer NOT NULL REFERENCES warehouses(id),
  recipient text NOT NULL,
  destination text NOT NULL,
  carrier_id integer REFERENCES carriers(id),
  tracking_number text,
  notes text,
  idempotency_key text,
  dispatch_idempotency_key text,
  dispatched_at timestamp,
  delivered_at timestamp,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT inventory_issues_org_number_uidx UNIQUE (organization_id, issue_number),
  CONSTRAINT inventory_issues_org_idempotency_uidx UNIQUE (organization_id, idempotency_key),
  CONSTRAINT inventory_issues_org_dispatch_idempotency_uidx UNIQUE (organization_id, dispatch_idempotency_key)
);

CREATE TABLE IF NOT EXISTS inventory_issue_lines (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  issue_id integer NOT NULL REFERENCES inventory_issues(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES inventory_items(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_of_measure text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT inventory_issue_lines_issue_item_uidx UNIQUE (issue_id, item_id)
);

CREATE TABLE IF NOT EXISTS inventory_issue_events (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  issue_id integer NOT NULL REFERENCES inventory_issues(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text,
  actor_user_id integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_issues_org_status_updated_idx
  ON inventory_issues (organization_id, status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS inventory_issue_lines_org_item_idx
  ON inventory_issue_lines (organization_id, item_id);

CREATE TABLE IF NOT EXISTS fuel_products (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  product_class text NOT NULL,
  unit text NOT NULL DEFAULT 'litre',
  applicable_storage_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fuel_products_org_code_uidx UNIQUE (organization_id, code)
);

ALTER TABLE fuel_tanks ADD COLUMN IF NOT EXISTS product_id integer REFERENCES fuel_products(id);
CREATE INDEX IF NOT EXISTS fuel_products_org_active_name_idx
  ON fuel_products (organization_id, active, name, id);

INSERT INTO fuel_products (organization_id, code, name, product_class, unit, applicable_storage_types)
SELECT DISTINCT organization_id,
  UPPER(REGEXP_REPLACE(product_type, '[^a-zA-Z0-9]+', '_', 'g')),
  product_type,
  'fuel',
  'litre',
  ARRAY[storage_type]
FROM fuel_tanks
WHERE NULLIF(TRIM(product_type), '') IS NOT NULL
ON CONFLICT (organization_id, code) DO NOTHING;

UPDATE fuel_tanks tank
SET product_id = product.id
FROM fuel_products product
WHERE tank.product_id IS NULL
  AND product.organization_id = tank.organization_id
  AND product.code = UPPER(REGEXP_REPLACE(tank.product_type, '[^a-zA-Z0-9]+', '_', 'g'));
