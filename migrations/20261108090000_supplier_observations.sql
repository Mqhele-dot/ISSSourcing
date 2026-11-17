-- Independent approval boundary. No historical rows are inferred or backfilled.
CREATE TABLE IF NOT EXISTS supplier_compliance_approvals (
  organization_id integer NOT NULL,
  change_request_id integer NOT NULL,
  maker_id integer NOT NULL,
  approver_id integer NOT NULL CHECK(approver_id <> maker_id),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_payload jsonb NOT NULL,
  frozen jsonb NOT NULL,
  PRIMARY KEY(organization_id,change_request_id)
);
CREATE TABLE IF NOT EXISTS supplier_compliance_publications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL,
  supplier_id integer NOT NULL,
  document_type text NOT NULL,
  source_record_id integer NOT NULL,
  document_id integer NOT NULL,
  document_version integer NOT NULL,
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  withdrawn boolean NOT NULL,
  change_request_id integer NOT NULL,
  UNIQUE(organization_id,change_request_id),
  FOREIGN KEY(organization_id,change_request_id) REFERENCES supplier_compliance_approvals(organization_id,change_request_id)
);
CREATE INDEX IF NOT EXISTS supplier_compliance_latest_idx ON supplier_compliance_publications(organization_id,supplier_id,document_type,id DESC);
CREATE TABLE IF NOT EXISTS supplier_delivery_observations (
  id uuid PRIMARY KEY,
  organization_id integer NOT NULL,
  supplier_id integer NOT NULL,
  actor_user_id integer NOT NULL,
  observed_at timestamptz NOT NULL,
  summary jsonb NOT NULL CHECK(jsonb_typeof(summary)='object'),
  evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array' AND jsonb_array_length(evidence)<=10000)
);
CREATE INDEX IF NOT EXISTS supplier_delivery_observation_list_idx ON supplier_delivery_observations(organization_id,supplier_id,observed_at DESC,id DESC);
CREATE OR REPLACE FUNCTION refuse_supplier_evidence_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published supplier evidence is immutable';
END $$;
DROP TRIGGER IF EXISTS supplier_compliance_approval_immutable ON supplier_compliance_approvals;
CREATE TRIGGER supplier_compliance_approval_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON supplier_compliance_approvals FOR EACH STATEMENT EXECUTE FUNCTION refuse_supplier_evidence_change();
DROP TRIGGER IF EXISTS supplier_compliance_publication_immutable ON supplier_compliance_publications;
CREATE TRIGGER supplier_compliance_publication_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON supplier_compliance_publications FOR EACH STATEMENT EXECUTE FUNCTION refuse_supplier_evidence_change();
DROP TRIGGER IF EXISTS supplier_delivery_observation_immutable ON supplier_delivery_observations;
CREATE TRIGGER supplier_delivery_observation_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON supplier_delivery_observations FOR EACH STATEMENT EXECUTE FUNCTION refuse_supplier_evidence_change();
