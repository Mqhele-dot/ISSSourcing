-- Separate approval boundary. Immutable source-capture evidence, no feature enablement.
CREATE UNIQUE INDEX IF NOT EXISTS compact_workspace_source_identity_idx ON compact_export_workspaces(id,attempt_id,job_id,organization_id,actor_id);
CREATE TABLE IF NOT EXISTS compact_export_captures (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL UNIQUE,
  attempt_id bigint NOT NULL,
  job_id integer NOT NULL,
  organization_id integer NOT NULL,
  actor_id integer NOT NULL,
  capture_directory text NOT NULL CHECK(capture_directory ~ '^compact-capture-[A-Za-z0-9]{6,}$'),
  capture_sha256 text NOT NULL CHECK(capture_sha256 ~ '^[a-f0-9]{64}$'),
  source_rows bigint NOT NULL CHECK(source_rows BETWEEN 0 AND 2147483647),
  capture_bytes bigint NOT NULL CHECK(capture_bytes BETWEEN 0 AND 2147483648),
  scope jsonb NOT NULL CHECK(jsonb_typeof(scope)='object'),
  columns jsonb NOT NULL CHECK(jsonb_typeof(columns)='array' AND jsonb_array_length(columns) BETWEEN 1 AND 16384),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(workspace_id,attempt_id,job_id,organization_id,actor_id) REFERENCES compact_export_workspaces(id,attempt_id,job_id,organization_id,actor_id)
);
CREATE INDEX IF NOT EXISTS compact_capture_job_idx ON compact_export_captures(organization_id,job_id,id);
CREATE OR REPLACE FUNCTION protect_compact_capture_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Compact source-capture evidence is immutable'; END $$;
DROP TRIGGER IF EXISTS compact_capture_evidence_guard ON compact_export_captures;
CREATE TRIGGER compact_capture_evidence_guard BEFORE UPDATE OR DELETE ON compact_export_captures FOR EACH ROW EXECUTE FUNCTION protect_compact_capture_evidence();
