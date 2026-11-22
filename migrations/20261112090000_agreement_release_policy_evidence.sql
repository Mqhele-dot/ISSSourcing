-- Preserve the observed release decision, never infer older versions.
CREATE TABLE IF NOT EXISTS agreement_release_policy_evidence (
  release_id bigint PRIMARY KEY REFERENCES supplier_contract_releases(id) ON DELETE RESTRICT,
  agreement_version integer NOT NULL CHECK (agreement_version > 0),
  command_hash text NOT NULL CHECK (command_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION refuse_agreement_release_policy_evidence_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agreement release policy evidence is immutable' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS agreement_release_policy_evidence_immutable ON agreement_release_policy_evidence;
CREATE TRIGGER agreement_release_policy_evidence_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON agreement_release_policy_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_agreement_release_policy_evidence_rewrite();
