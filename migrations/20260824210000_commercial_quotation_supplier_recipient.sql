ALTER TABLE commercial_quotations
  ADD COLUMN IF NOT EXISTS recipient_source TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS recipient_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;

ALTER TABLE commercial_quotations
  DROP CONSTRAINT IF EXISTS commercial_quotations_recipient_source_check;

ALTER TABLE commercial_quotations
  ADD CONSTRAINT commercial_quotations_recipient_source_check
  CHECK (recipient_source IN ('SUPPLIER_MASTER', 'MANUAL'));

CREATE INDEX IF NOT EXISTS commercial_quotations_org_recipient_supplier_idx
  ON commercial_quotations (organization_id, recipient_supplier_id, updated_at DESC, id DESC)
  WHERE recipient_supplier_id IS NOT NULL;

COMMENT ON COLUMN commercial_quotations.recipient_source IS
  'SUPPLIER_MASTER snapshots a tenant-owned supplier record; MANUAL represents a recipient not yet onboarded.';

COMMENT ON COLUMN commercial_quotations.recipient_supplier_id IS
  'Optional source supplier. The quotation retains recipient snapshots if the supplier is later changed or removed.';
