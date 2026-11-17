ALTER TABLE reporting_fx_revisions ADD COLUMN IF NOT EXISTS applied_at timestamptz;
ALTER TABLE reporting_fx_revisions ADD COLUMN IF NOT EXISTS change_request_id integer;
ALTER TABLE reporting_fx_revisions ADD COLUMN IF NOT EXISTS withdrawn boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS reporting_fx_request_uidx ON reporting_fx_revisions(organization_id,change_request_id) WHERE change_request_id IS NOT NULL;
-- Existing evidence stays immutable. Legacy publication uses recorded_at at read time.
CREATE TABLE IF NOT EXISTS reporting_fx_approvals (
  organization_id integer NOT NULL REFERENCES organizations(id),
  change_request_id integer NOT NULL,
  payload jsonb NOT NULL,
  target_snapshot jsonb,
  approved_by integer NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,change_request_id)
);
DROP TRIGGER IF EXISTS reporting_fx_approval_immutable ON reporting_fx_approvals;
CREATE TRIGGER reporting_fx_approval_immutable BEFORE UPDATE OR DELETE ON reporting_fx_approvals
FOR EACH ROW EXECUTE FUNCTION preserve_financial_reporting_evidence();
