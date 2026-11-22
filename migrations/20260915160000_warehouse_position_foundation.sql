-- Location/reconciliation foundation only. Does not migrate quantities or enable quality holds.
-- Requires 20260915120000_cycle_count_integrity.sql.
CREATE TABLE IF NOT EXISTS wms_warehouse_sites (
  warehouse_id integer PRIMARY KEY REFERENCES warehouses(id),
  organization_id integer NOT NULL REFERENCES organizations(id),
  site_id integer NOT NULL REFERENCES mdm_sites(id),
  updated_by integer NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wms_zones (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  warehouse_id integer NOT NULL REFERENCES warehouses(id),
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wms_zone_code ON wms_zones(organization_id,warehouse_id,lower(code));
CREATE TABLE IF NOT EXISTS wms_bins (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  warehouse_id integer NOT NULL REFERENCES warehouses(id),
  zone_id integer NOT NULL REFERENCES wms_zones(id),
  code text NOT NULL,
  aisle text,
  bay text,
  shelf text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wms_bin_code ON wms_bins(organization_id,warehouse_id,lower(code));
CREATE TABLE IF NOT EXISTS wms_position_reconciliations (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  position_id integer NOT NULL,
  warehouse_id integer NOT NULL,
  item_id integer NOT NULL,
  bin_id integer NOT NULL REFERENCES wms_bins(id),
  site_id integer NOT NULL REFERENCES mdm_sites(id),
  quantity_snapshot numeric(20,6) NOT NULL,
  source_revision bigint NOT NULL,
  previous_location jsonb NOT NULL,
  reason text NOT NULL,
  verified_by integer NOT NULL REFERENCES users(id),
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,position_id,source_revision)
);
CREATE INDEX IF NOT EXISTS wms_reconciliation_latest ON wms_position_reconciliations(organization_id,position_id,id DESC);
CREATE OR REPLACE FUNCTION wms_reconciliation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'WMS_RECONCILIATION_IMMUTABLE'; END $$;
DROP TRIGGER IF EXISTS wms_reconciliation_immutable ON wms_position_reconciliations;
CREATE TRIGGER wms_reconciliation_immutable BEFORE UPDATE OR DELETE ON wms_position_reconciliations
FOR EACH ROW EXECUTE FUNCTION wms_reconciliation_immutable();
