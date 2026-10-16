-- Bounded procurement lists and universal substring search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS suppliers_org_status_name_id_idx
  ON suppliers (organization_id, status, name, id);
CREATE INDEX IF NOT EXISTS purchase_orders_org_status_created_id_idx
  ON purchase_orders (organization_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_org_supplier_created_id_idx
  ON purchase_orders (organization_id, supplier_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS purchase_requisitions_org_status_created_id_idx
  ON purchase_requisitions (organization_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS sourcing_events_org_status_updated_id_idx
  ON sourcing_events (organization_id, status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS supplier_contracts_org_status_created_id_idx
  ON supplier_contracts (organization_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS supplier_contracts_org_supplier_created_id_idx
  ON supplier_contracts (organization_id, supplier_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS suppliers_name_trgm_idx ON suppliers USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_code_trgm_idx ON suppliers USING gin (lower(supplier_code) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS inventory_items_name_trgm_idx ON inventory_items USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS inventory_items_sku_trgm_idx ON inventory_items USING gin (lower(sku) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS purchase_orders_number_trgm_idx ON purchase_orders USING gin (lower(order_number) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS purchase_requisitions_number_trgm_idx ON purchase_requisitions USING gin (lower(requisition_number) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sourcing_events_title_trgm_idx ON sourcing_events USING gin (lower(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sourcing_events_number_trgm_idx ON sourcing_events USING gin (lower(event_number) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS supplier_contracts_title_trgm_idx ON supplier_contracts USING gin (lower(title) gin_trgm_ops);
