-- Additive evidence only. Never infer verified historical prices or FX approvals.
CREATE TABLE IF NOT EXISTS reporting_fx_revisions (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  source_rate_id integer NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  from_currency_code text NOT NULL CHECK (from_currency_code ~ '^[A-Z]{3}$'),
  to_currency_code text NOT NULL CHECK (to_currency_code ~ '^[A-Z]{3}$'),
  rate numeric NOT NULL CHECK (rate > 0 AND rate::text NOT IN ('NaN','Infinity','-Infinity')),
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  approved_at timestamptz NOT NULL,
  approved_by integer NOT NULL REFERENCES users(id),
  approval_reference text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_rate_id, version),
  CHECK (expires_at IS NULL OR expires_at > effective_at)
);
CREATE INDEX IF NOT EXISTS reporting_fx_lookup_idx ON reporting_fx_revisions
  (organization_id,from_currency_code,to_currency_code,effective_at DESC,version DESC);

CREATE TABLE IF NOT EXISTS receipt_value_evidence (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  receipt_item_id integer NOT NULL,
  original_evidence_id bigint,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  currency_code text NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  source_price_reference text NOT NULL,
  posted_at timestamptz NOT NULL,
  actor_user_id integer NOT NULL REFERENCES users(id),
  UNIQUE (organization_id, receipt_item_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id,original_evidence_id) REFERENCES receipt_value_evidence(organization_id,id),
  CHECK (quantity::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (unit_price::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK ((original_evidence_id IS NULL AND quantity >= 0) OR (original_evidence_id IS NOT NULL AND quantity <= 0))
);
CREATE INDEX IF NOT EXISTS receipt_value_org_idx ON receipt_value_evidence(organization_id,posted_at,id);

CREATE TABLE IF NOT EXISTS financial_reporting_runs (
  id uuid PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  actor_user_id integer NOT NULL REFERENCES users(id),
  measure text NOT NULL CHECK (measure IN ('ordered','open_commitment','received','invoiced','recorded_payments')),
  calculation_version text NOT NULL,
  normalized_filters jsonb NOT NULL,
  reporting_currency_code text,
  generated_at timestamptz NOT NULL,
  summary jsonb NOT NULL,
  evidence_hash text NOT NULL,
  UNIQUE (organization_id,id)
);
CREATE TABLE IF NOT EXISTS financial_reporting_contributions (
  run_id uuid NOT NULL,
  organization_id integer NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  evidence jsonb NOT NULL,
  PRIMARY KEY (run_id,ordinal),
  FOREIGN KEY (organization_id,run_id) REFERENCES financial_reporting_runs(organization_id,id)
);

CREATE OR REPLACE FUNCTION preserve_financial_reporting_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Financial reporting evidence is immutable; create a new revision or linked reversal';
END $$;
DROP TRIGGER IF EXISTS reporting_fx_immutable ON reporting_fx_revisions;
CREATE TRIGGER reporting_fx_immutable BEFORE UPDATE OR DELETE ON reporting_fx_revisions
FOR EACH ROW EXECUTE FUNCTION preserve_financial_reporting_evidence();
DROP TRIGGER IF EXISTS receipt_value_immutable ON receipt_value_evidence;
CREATE TRIGGER receipt_value_immutable BEFORE UPDATE OR DELETE ON receipt_value_evidence
FOR EACH ROW EXECUTE FUNCTION preserve_financial_reporting_evidence();
DROP TRIGGER IF EXISTS financial_runs_immutable ON financial_reporting_runs;
CREATE TRIGGER financial_runs_immutable BEFORE UPDATE OR DELETE ON financial_reporting_runs
FOR EACH ROW EXECUTE FUNCTION preserve_financial_reporting_evidence();
DROP TRIGGER IF EXISTS financial_contributions_immutable ON financial_reporting_contributions;
CREATE TRIGGER financial_contributions_immutable BEFORE UPDATE OR DELETE ON financial_reporting_contributions
FOR EACH ROW EXECUTE FUNCTION preserve_financial_reporting_evidence();
