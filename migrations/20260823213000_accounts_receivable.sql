CREATE TABLE IF NOT EXISTS ar_customers (
  id bigserial PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id), customer_number text NOT NULL,
  name text NOT NULL, email text, phone text, tax_number text, currency_code text NOT NULL DEFAULT 'ZAR',
  credit_limit numeric(18,2) NOT NULL DEFAULT 0, payment_terms_days integer NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','on_hold','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,customer_number)
);
CREATE TABLE IF NOT EXISTS ar_invoices (
  id bigserial PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id), customer_id bigint NOT NULL REFERENCES ar_customers(id),
  invoice_number text NOT NULL, document_type text NOT NULL DEFAULT 'invoice' CHECK(document_type IN ('invoice','credit_note')),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_approval','posted','partially_paid','paid','cancelled')),
  issue_date date NOT NULL, due_date date NOT NULL, currency_code text NOT NULL, exchange_rate numeric(20,8) NOT NULL DEFAULT 1,
  subtotal numeric(18,2) NOT NULL DEFAULT 0, tax_amount numeric(18,2) NOT NULL DEFAULT 0, total_amount numeric(18,2) NOT NULL DEFAULT 0,
  paid_amount numeric(18,2) NOT NULL DEFAULT 0, balance_amount numeric(18,2) NOT NULL DEFAULT 0,
  source_type text, source_id text, notes text, posted_journal_id bigint REFERENCES journal_entries(id),
  created_by integer REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(due_date>=issue_date), UNIQUE(organization_id,invoice_number)
);
CREATE TABLE IF NOT EXISTS ar_invoice_lines (
  id bigserial PRIMARY KEY, invoice_id bigint NOT NULL REFERENCES ar_invoices(id) ON DELETE CASCADE, line_no integer NOT NULL,
  description text NOT NULL, quantity numeric(18,4) NOT NULL, unit_price numeric(18,4) NOT NULL,
  tax_rate numeric(9,4) NOT NULL DEFAULT 0, net_amount numeric(18,2) NOT NULL, tax_amount numeric(18,2) NOT NULL, gross_amount numeric(18,2) NOT NULL,
  revenue_account_id bigint REFERENCES finance_accounts(id), UNIQUE(invoice_id,line_no)
);
CREATE TABLE IF NOT EXISTS ar_receipts (
  id bigserial PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id), customer_id bigint NOT NULL REFERENCES ar_customers(id),
  receipt_number text NOT NULL, receipt_date date NOT NULL, currency_code text NOT NULL, amount numeric(18,2) NOT NULL CHECK(amount>0),
  unallocated_amount numeric(18,2) NOT NULL, payment_method text NOT NULL DEFAULT 'bank_transfer', reference text,
  status text NOT NULL DEFAULT 'posted' CHECK(status IN ('draft','posted','reversed')), posted_journal_id bigint REFERENCES journal_entries(id),
  created_by integer REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,receipt_number)
);
CREATE TABLE IF NOT EXISTS ar_receipt_allocations (
  id bigserial PRIMARY KEY, receipt_id bigint NOT NULL REFERENCES ar_receipts(id), invoice_id bigint NOT NULL REFERENCES ar_invoices(id),
  amount numeric(18,2) NOT NULL CHECK(amount>0), allocated_at timestamptz NOT NULL DEFAULT now(), allocated_by integer REFERENCES users(id),
  UNIQUE(receipt_id,invoice_id)
);
CREATE INDEX IF NOT EXISTS ar_customers_org_status_name_idx ON ar_customers(organization_id,status,name,id);
CREATE INDEX IF NOT EXISTS ar_invoices_org_status_due_idx ON ar_invoices(organization_id,status,due_date,id);
CREATE INDEX IF NOT EXISTS ar_receipts_org_date_idx ON ar_receipts(organization_id,receipt_date,id);
