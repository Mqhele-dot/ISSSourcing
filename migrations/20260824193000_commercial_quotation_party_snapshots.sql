ALTER TABLE commercial_quotations
  ADD COLUMN IF NOT EXISTS recipient_registration_number TEXT,
  ADD COLUMN IF NOT EXISTS recipient_tax_number TEXT,
  ADD COLUMN IF NOT EXISTS recipient_physical_address TEXT,
  ADD COLUMN IF NOT EXISTS recipient_billing_address TEXT,
  ADD COLUMN IF NOT EXISTS recipient_delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS supplier_legal_name TEXT,
  ADD COLUMN IF NOT EXISTS supplier_registration_number TEXT,
  ADD COLUMN IF NOT EXISTS supplier_tax_number TEXT,
  ADD COLUMN IF NOT EXISTS supplier_physical_address TEXT,
  ADD COLUMN IF NOT EXISTS supplier_email TEXT,
  ADD COLUMN IF NOT EXISTS supplier_phone TEXT,
  ADD COLUMN IF NOT EXISTS supplier_website TEXT;

UPDATE commercial_quotations
SET recipient_physical_address = recipient_address
WHERE recipient_physical_address IS NULL
  AND recipient_address IS NOT NULL;

COMMENT ON COLUMN commercial_quotations.recipient_physical_address IS
  'Customer legal/physical address snapshot at quotation draft save.';
COMMENT ON COLUMN commercial_quotations.supplier_physical_address IS
  'Issuing organization physical address snapshot at quotation draft save.';
