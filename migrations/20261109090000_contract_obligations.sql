-- Contract tracking only; no legacy backfill or change to commercial terms.
CREATE TABLE IF NOT EXISTS contract_obligation_versions (
  organization_id integer NOT NULL REFERENCES organizations(id),
  contract_id integer NOT NULL CONSTRAINT contract_obligations_contract_fk REFERENCES supplier_contracts(id),
  obligation_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  command_id uuid NOT NULL,
  command_payload jsonb NOT NULL CHECK (jsonb_typeof(command_payload) = 'object'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  owner_user_id integer NOT NULL,
  due_date date NOT NULL,
  state text NOT NULL CHECK (state IN ('open', 'completed', 'cancelled')),
  note text NOT NULL CHECK (length(note) BETWEEN 5 AND 1000),
  document_id integer,
  document_version integer,
  document_sha256 text,
  actor_user_id integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, contract_id, obligation_id, revision),
  UNIQUE (organization_id, contract_id, command_id),
  CHECK ((state = 'completed' AND document_id IS NOT NULL AND document_version IS NOT NULL
    AND document_sha256 IS NOT NULL AND document_sha256 ~ '^[0-9a-f]{64}$')
    OR (state <> 'completed' AND document_id IS NULL AND document_version IS NULL AND document_sha256 IS NULL))
);
CREATE INDEX IF NOT EXISTS contract_obligations_latest_idx ON contract_obligation_versions
  (organization_id, contract_id, obligation_id, revision DESC);

CREATE OR REPLACE FUNCTION refuse_contract_obligation_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Contract obligation evidence is immutable' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS contract_obligation_immutable ON contract_obligation_versions;
CREATE TRIGGER contract_obligation_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON contract_obligation_versions
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_contract_obligation_rewrite();
