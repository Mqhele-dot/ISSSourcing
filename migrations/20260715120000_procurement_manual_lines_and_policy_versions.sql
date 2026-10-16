ALTER TABLE purchase_requisition_items ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS line_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'CATALOG';
ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS item_code_snapshot TEXT;
ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS item_description_snapshot TEXT;
ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS manual_entry_reason TEXT;
ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS fulfilment_type TEXT NOT NULL DEFAULT 'GOODS_RECEIPT';
ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS receipt_required BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE purchase_order_items ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS line_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'CATALOG';
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS item_code_snapshot TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS item_description_snapshot TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS manual_entry_reason TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS fulfilment_type TEXT NOT NULL DEFAULT 'GOODS_RECEIPT';
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS receipt_required BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE approval_policies ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE invoice_items ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS purchase_order_item_id INTEGER REFERENCES purchase_order_items(id);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'CATALOG';

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY requisition_id ORDER BY id) AS next_line_number
  FROM purchase_requisition_items
)
UPDATE purchase_requisition_items pri
SET line_number = numbered.next_line_number,
    line_type = 'CATALOG',
    fulfilment_type = 'GOODS_RECEIPT',
    receipt_required = TRUE,
    item_code_snapshot = COALESCE(pri.item_code_snapshot, (SELECT ii.sku FROM inventory_items ii WHERE ii.id = pri.item_id)),
    item_description_snapshot = COALESCE(pri.item_description_snapshot, (SELECT ii.name FROM inventory_items ii WHERE ii.id = pri.item_id)),
    description = COALESCE(pri.description, (SELECT ii.name FROM inventory_items ii WHERE ii.id = pri.item_id))
FROM numbered
WHERE pri.id = numbered.id;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY id) AS next_line_number
  FROM purchase_order_items
)
UPDATE purchase_order_items poi
SET line_number = numbered.next_line_number,
    line_type = 'CATALOG',
    fulfilment_type = 'GOODS_RECEIPT',
    receipt_required = TRUE,
    item_code_snapshot = COALESCE(poi.item_code_snapshot, (SELECT ii.sku FROM inventory_items ii WHERE ii.id = poi.item_id)),
    item_description_snapshot = COALESCE(poi.item_description_snapshot, (SELECT ii.name FROM inventory_items ii WHERE ii.id = poi.item_id)),
    description = COALESCE(poi.description, (SELECT ii.name FROM inventory_items ii WHERE ii.id = poi.item_id))
FROM numbered
WHERE poi.id = numbered.id;

DO $$ BEGIN
  ALTER TABLE purchase_requisition_items ADD CONSTRAINT purchase_requisition_items_line_type_check
    CHECK (line_type IN ('CATALOG', 'NON_STOCK', 'SERVICE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE purchase_requisition_items ADD CONSTRAINT purchase_requisition_items_manual_line_check
    CHECK ((line_type = 'CATALOG' AND item_id IS NOT NULL) OR (line_type <> 'CATALOG' AND item_id IS NULL AND NULLIF(BTRIM(description), '') IS NOT NULL AND NULLIF(BTRIM(manual_entry_reason), '') IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_line_type_check
    CHECK (line_type IN ('CATALOG', 'NON_STOCK', 'SERVICE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_manual_line_check
    CHECK ((line_type = 'CATALOG' AND item_id IS NOT NULL) OR (line_type <> 'CATALOG' AND item_id IS NULL AND NULLIF(BTRIM(description), '') IS NOT NULL AND NULLIF(BTRIM(manual_entry_reason), '') IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
