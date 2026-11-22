ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS retry_of_job_id integer REFERENCES export_jobs(id);

CREATE INDEX IF NOT EXISTS export_jobs_retry_chain_idx
  ON export_jobs (organization_id, retry_of_job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ap_payment_batches_org_created_idx
  ON ap_payment_batches (organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS ap_payment_batches_org_status_created_idx
  ON ap_payment_batches (organization_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS invoices_org_created_idx
  ON invoices (organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS invoices_org_status_due_idx
  ON invoices (organization_id, status, due_date, id);

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS last_verified_at timestamp;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS target_path text,
  ADD COLUMN IF NOT EXISTS finding_code text;

CREATE INDEX IF NOT EXISTS notifications_org_finding_idx
  ON notifications (organization_id, finding_code, last_occurred_at DESC)
  WHERE finding_code IS NOT NULL;
