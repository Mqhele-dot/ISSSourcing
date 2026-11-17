-- Safety holds are item-wide, not bin/lot quality classifications.
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS safety_hold boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS inventory_safety_holds (
 id bigserial PRIMARY KEY,
 organization_id integer NOT NULL,
 item_id integer NOT NULL REFERENCES inventory_items(id),
 kind text NOT NULL CHECK(kind IN ('INSPECTION','QUARANTINE','DAMAGED','BLOCKED')),
 reason text NOT NULL CHECK(length(trim(reason))>=5),
 created_by integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 request_key uuid NOT NULL,
 UNIQUE(organization_id,request_key)
);
CREATE TABLE IF NOT EXISTS inventory_safety_releases (
 hold_id bigint PRIMARY KEY REFERENCES inventory_safety_holds(id),
 reason text NOT NULL CHECK(length(trim(reason))>=5),
 released_by integer NOT NULL,
 released_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_safety_holds_item ON inventory_safety_holds(organization_id,item_id);
CREATE OR REPLACE FUNCTION immutable_safety_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SAFETY_EVIDENCE_IMMUTABLE'; END $$;
DROP TRIGGER IF EXISTS immutable_safety_hold ON inventory_safety_holds;
CREATE TRIGGER immutable_safety_hold BEFORE UPDATE OR DELETE ON inventory_safety_holds FOR EACH ROW EXECUTE FUNCTION immutable_safety_evidence();
DROP TRIGGER IF EXISTS immutable_safety_release ON inventory_safety_releases;
CREATE TRIGGER immutable_safety_release BEFORE UPDATE OR DELETE ON inventory_safety_releases FOR EACH ROW EXECUTE FUNCTION immutable_safety_evidence();

CREATE OR REPLACE FUNCTION protect_held_stock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held boolean;
BEGIN
 IF TG_TABLE_NAME='inventory_items' THEN held:=OLD.safety_hold;
 ELSE SELECT safety_hold INTO held FROM inventory_items WHERE id=OLD.item_id AND organization_id=OLD.organization_id;
 END IF;
 IF held THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'STOCK_QUALITY_HOLD' USING ERRCODE='P0001'; END IF;
   IF NEW.quantity<OLD.quantity OR NEW.organization_id<>OLD.organization_id THEN
     RAISE EXCEPTION 'STOCK_QUALITY_HOLD' USING ERRCODE='P0001';
   END IF;
   IF TG_TABLE_NAME='warehouse_inventory' THEN
     IF NEW.item_id<>OLD.item_id OR NEW.warehouse_id<>OLD.warehouse_id THEN
       RAISE EXCEPTION 'STOCK_QUALITY_HOLD' USING ERRCODE='P0001';
     END IF;
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='inventory_items' THEN
   -- API payloads cannot clear the guard without append-only release evidence.
   NEW.safety_hold:=EXISTS(SELECT 1 FROM inventory_safety_holds h WHERE h.organization_id=NEW.organization_id AND h.item_id=NEW.id AND NOT EXISTS(SELECT 1 FROM inventory_safety_releases r WHERE r.hold_id=h.id));
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_item_safety ON inventory_items;
CREATE TRIGGER protect_item_safety BEFORE UPDATE OR DELETE ON inventory_items FOR EACH ROW EXECUTE FUNCTION protect_held_stock();
DROP TRIGGER IF EXISTS protect_position_safety ON warehouse_inventory;
CREATE TRIGGER protect_position_safety BEFORE UPDATE OR DELETE ON warehouse_inventory FOR EACH ROW EXECUTE FUNCTION protect_held_stock();

CREATE OR REPLACE FUNCTION protect_held_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held boolean;
BEGIN
 IF NEW.status='reserved' THEN
   SELECT safety_hold INTO held FROM inventory_items WHERE id=NEW.item_id AND organization_id=NEW.organization_id FOR SHARE;
   IF held THEN RAISE EXCEPTION 'STOCK_QUALITY_HOLD' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_reservation_safety ON inventory_allocations;
CREATE TRIGGER protect_reservation_safety BEFORE INSERT OR UPDATE ON inventory_allocations FOR EACH ROW EXECUTE FUNCTION protect_held_reservation();

CREATE OR REPLACE FUNCTION protect_held_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held boolean;
BEGIN
 IF NEW.quantity<0 OR NEW.new_quantity<NEW.previous_quantity OR NEW.type::text IN ('SALE','ISSUE','TRANSFER','DAMAGE','EXPIRE','RECEIPT_REVERSAL','PURCHASE_RETURN') THEN
   SELECT safety_hold INTO held FROM inventory_items WHERE id=NEW.item_id AND organization_id=NEW.organization_id FOR SHARE;
   IF held THEN RAISE EXCEPTION 'STOCK_QUALITY_HOLD' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_movement_safety ON stock_movements;
CREATE TRIGGER protect_movement_safety BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION protect_held_movement();
