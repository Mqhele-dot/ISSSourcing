-- A carrier is an operational profile of a supplier, not a second business party.
-- Existing carrier rows remain visible as unlinked legacy records until explicitly reconciled.
ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS supplier_id integer;

CREATE UNIQUE INDEX IF NOT EXISTS carriers_org_supplier_unique
  ON carriers (organization_id, supplier_id)
  WHERE supplier_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'carriers_supplier_id_suppliers_id_fk'
  ) THEN
    ALTER TABLE carriers
      ADD CONSTRAINT carriers_supplier_id_suppliers_id_fk
      FOREIGN KEY (supplier_id)
      REFERENCES suppliers(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS carriers_org_active_name_idx
  ON carriers (organization_id, active, name, id);
