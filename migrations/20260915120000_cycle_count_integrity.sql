-- Additive: historical count headers/lines remain untouched.
ALTER TABLE warehouse_inventory ADD COLUMN IF NOT EXISTS count_revision bigint NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION bump_warehouse_count_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.count_revision := OLD.count_revision + 1;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS warehouse_count_revision ON warehouse_inventory;
CREATE TRIGGER warehouse_count_revision BEFORE UPDATE ON warehouse_inventory
FOR EACH ROW EXECUTE FUNCTION bump_warehouse_count_revision();

ALTER TABLE cycle_counts ADD COLUMN IF NOT EXISTS current_attempt integer NOT NULL DEFAULT 0;
ALTER TABLE cycle_counts ADD COLUMN IF NOT EXISTS approved_by integer;
ALTER TABLE cycle_counts ADD COLUMN IF NOT EXISTS posting_key text;
ALTER TABLE cycle_counts ADD COLUMN IF NOT EXISTS posted_at timestamptz;
CREATE TABLE IF NOT EXISTS cycle_count_attempts (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  cycle_count_id integer NOT NULL REFERENCES cycle_counts(id),
  attempt integer NOT NULL,
  position_id integer NOT NULL,
  item_id integer NOT NULL,
  location text,
  expected_quantity integer NOT NULL,
  counted_quantity integer CHECK (counted_quantity >= 0),
  position_revision bigint NOT NULL,
  unit_cost numeric(20,6),
  counter_id integer NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  entered_at timestamptz,
  UNIQUE (cycle_count_id,attempt,position_id)
);
CREATE INDEX IF NOT EXISTS cycle_count_attempts_scope ON cycle_count_attempts(organization_id,cycle_count_id,attempt,id);
CREATE INDEX IF NOT EXISTS cycle_counts_scope ON cycle_counts(organization_id,id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cycle_count_posting_key ON cycle_counts(organization_id,posting_key) WHERE posting_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cycle_count_v2_movement_source ON stock_movements(organization_id,reference_id)
  WHERE reference_type='cycle_count_attempt';
