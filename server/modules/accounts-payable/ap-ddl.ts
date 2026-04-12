import { pool } from "../../db";

const AP_DDLS = [
  `
  ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL'
  `,
  `
  ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'APPROVED'
  `,
  `
  ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'DISPUTED'
  `,
  `
  DO $$
  BEGIN
    CREATE TYPE ap_capture_status AS ENUM ('STAGED', 'REVIEW_REQUIRED', 'READY_TO_PROMOTE', 'PROMOTED', 'REJECTED');
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$;
  `,
  `
  DO $$
  BEGIN
    CREATE TYPE ap_match_status AS ENUM ('PENDING', 'MATCHED', 'MATCHED_WITH_TOLERANCE', 'EXCEPTION', 'WAIVED');
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$;
  `,
  `
  DO $$
  BEGIN
    CREATE TYPE ap_receipt_status AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$;
  `,
  `
  DO $$
  BEGIN
    CREATE TYPE ap_payment_batch_status AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RELEASED', 'CANCELLED');
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$;
  `,
  `
  ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS gl_code text
  `,
  `
  ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost_center text
  `,
  `
  ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS project_code text
  `,
  `
  ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tax_code text
  `,
  `
  ALTER TABLE approval_history ADD COLUMN IF NOT EXISTS organization_id integer DEFAULT 1
  `,
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'approval_history_organization_id_organizations_id_fk'
    ) THEN
      ALTER TABLE approval_history
      ADD CONSTRAINT approval_history_organization_id_organizations_id_fk
      FOREIGN KEY (organization_id) REFERENCES organizations(id);
    END IF;
  END $$;
  `,
  `
  UPDATE approval_history SET organization_id = 1 WHERE organization_id IS NULL
  `,
  `
  ALTER TABLE approval_history ALTER COLUMN organization_id SET NOT NULL
  `,
  `
  CREATE INDEX IF NOT EXISTS approval_history_org_entity_idx
  ON approval_history (organization_id, entity_type, entity_id)
  `,
  `
  CREATE TABLE IF NOT EXISTS ap_invoice_captures (
    id serial PRIMARY KEY,
    organization_id integer NOT NULL DEFAULT 1 REFERENCES organizations(id),
    source text NOT NULL DEFAULT 'manual_upload',
    status ap_capture_status NOT NULL DEFAULT 'STAGED',
    document_id integer,
    supplier_id integer,
    invoice_number text,
    issue_date timestamp,
    due_date timestamp,
    currency_code text,
    subtotal_amount real DEFAULT 0,
    tax_amount real DEFAULT 0,
    total_amount real DEFAULT 0,
    confidence_score real DEFAULT 0,
    duplicate_check_key text,
    extracted_header jsonb NOT NULL DEFAULT '{}'::jsonb,
    extracted_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
    warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
    reviewer_notes text,
    promoted_invoice_id integer,
    created_by integer,
    reviewed_by integer,
    reviewed_at timestamp,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS ap_receipts (
    id serial PRIMARY KEY,
    organization_id integer NOT NULL DEFAULT 1 REFERENCES organizations(id),
    receipt_number text NOT NULL,
    purchase_order_id integer NOT NULL,
    supplier_id integer,
    status ap_receipt_status NOT NULL DEFAULT 'POSTED',
    received_date timestamp NOT NULL DEFAULT now(),
    received_by integer,
    notes text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS ap_receipts_org_number_uidx ON ap_receipts (organization_id, receipt_number)
  `,
  `
  CREATE TABLE IF NOT EXISTS ap_receipt_items (
    id serial PRIMARY KEY,
    receipt_id integer NOT NULL,
    purchase_order_item_id integer,
    item_id integer NOT NULL,
    quantity real NOT NULL DEFAULT 0,
    accepted_quantity real NOT NULL DEFAULT 0,
    rejected_quantity real NOT NULL DEFAULT 0,
    notes text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS ap_invoice_match_results (
    id serial PRIMARY KEY,
    organization_id integer NOT NULL DEFAULT 1 REFERENCES organizations(id),
    invoice_id integer NOT NULL,
    purchase_order_id integer,
    receipt_id integer,
    status ap_match_status NOT NULL DEFAULT 'PENDING',
    match_type text NOT NULL DEFAULT '3_way',
    price_tolerance_pct real NOT NULL DEFAULT 0,
    quantity_tolerance_pct real NOT NULL DEFAULT 0,
    tax_tolerance_pct real NOT NULL DEFAULT 0,
    matched_line_count integer NOT NULL DEFAULT 0,
    mismatch_count integer NOT NULL DEFAULT 0,
    mismatch_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
    reviewed_by integer,
    reviewed_at timestamp,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS ap_payment_batches (
    id serial PRIMARY KEY,
    organization_id integer NOT NULL DEFAULT 1 REFERENCES organizations(id),
    batch_number text NOT NULL,
    status ap_payment_batch_status NOT NULL DEFAULT 'DRAFT',
    scheduled_date timestamp,
    approved_at timestamp,
    released_at timestamp,
    total_amount real NOT NULL DEFAULT 0,
    payment_method payment_method NOT NULL DEFAULT 'BANK_TRANSFER',
    export_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    notes text,
    created_by integer,
    approved_by integer,
    released_by integer,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS ap_payment_batches_org_number_uidx ON ap_payment_batches (organization_id, batch_number)
  `,
  `
  CREATE TABLE IF NOT EXISTS ap_payment_batch_items (
    id serial PRIMARY KEY,
    batch_id integer NOT NULL,
    invoice_id integer NOT NULL,
    payment_id integer,
    amount real NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'PENDING',
    notes text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )
  `,
];

export async function initializeAccountsPayableData() {
  for (const ddl of AP_DDLS) {
    await pool.query(ddl);
  }
}
