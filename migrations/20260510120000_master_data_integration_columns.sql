-- Cross-module master data: contract commercial FKs, PO tax header, PO line snapshots, inventory UoM FK.

ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS payment_terms_id integer REFERENCES payment_terms(id);
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS incoterm_id integer REFERENCES incoterms(id);
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS default_tax_code_id integer REFERENCES tax_codes(id);
ALTER TABLE supplier_contracts ADD COLUMN IF NOT EXISTS default_warehouse_id integer REFERENCES warehouses(id);

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tax_code_id integer REFERENCES tax_codes(id);

ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS unit_of_measure_id integer REFERENCES units_of_measure(id);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS commodity_code_id integer REFERENCES commodity_codes(id);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS tax_code_id integer REFERENCES tax_codes(id);

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS unit_of_measure_id integer REFERENCES units_of_measure(id);

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS purchase_order_id integer REFERENCES purchase_orders(id);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS carrier_id integer REFERENCES carriers(id);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS transport_mode text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS freight_cost double precision;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS vehicle text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS driver text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS delivery_note_ref text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS grn_number text;
