-- Canonical inventory paging and fail-closed ownership for legacy operational rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE inventory_positions ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);

WITH unique_skus AS (
  SELECT sku, MIN(organization_id) AS organization_id
  FROM inventory_items
  WHERE organization_id IS NOT NULL
  GROUP BY sku
  HAVING COUNT(DISTINCT organization_id) = 1
)
UPDATE inventory_positions p
SET organization_id = u.organization_id
FROM unique_skus u
WHERE p.organization_id IS NULL AND p.sku = u.sku;

WITH unique_skus AS (
  SELECT sku, MIN(organization_id) AS organization_id
  FROM inventory_items
  WHERE organization_id IS NOT NULL
  GROUP BY sku
  HAVING COUNT(DISTINCT organization_id) = 1
)
UPDATE inventory_movements m
SET organization_id = u.organization_id
FROM unique_skus u
WHERE m.organization_id IS NULL AND m.sku = u.sku;

CREATE INDEX IF NOT EXISTS inventory_items_org_name_id_idx ON inventory_items (organization_id, name, id);
CREATE INDEX IF NOT EXISTS inventory_items_org_sku_id_idx ON inventory_items (organization_id, sku, id);
CREATE INDEX IF NOT EXISTS inventory_items_org_category_id_idx ON inventory_items (organization_id, category_id, id);
CREATE INDEX IF NOT EXISTS inventory_items_name_trgm_idx ON inventory_items USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS inventory_items_sku_trgm_idx ON inventory_items USING gin (sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS warehouse_inventory_org_item_warehouse_idx ON warehouse_inventory (organization_id, item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS inventory_allocations_org_item_warehouse_status_idx ON inventory_allocations (organization_id, item_id, warehouse_id, status);
CREATE INDEX IF NOT EXISTS stock_movements_org_item_timestamp_idx ON stock_movements (organization_id, item_id, timestamp DESC, id DESC);
CREATE INDEX IF NOT EXISTS inventory_positions_org_sku_idx ON inventory_positions (organization_id, sku);
CREATE INDEX IF NOT EXISTS inventory_movements_org_sku_created_idx ON inventory_movements (organization_id, sku, created_at DESC, id DESC);
