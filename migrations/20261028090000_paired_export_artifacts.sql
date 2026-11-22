-- Additive export metadata only. Does not approve, generate or alter business evidence.
CREATE UNIQUE INDEX IF NOT EXISTS export_jobs_id_organization_idx ON export_jobs(id,organization_id);
CREATE TABLE IF NOT EXISTS export_artifacts (
  job_id integer NOT NULL,
  organization_id integer NOT NULL,
  kind text NOT NULL CHECK(kind IN ('summary','archive')),
  snapshot_reference text NOT NULL CHECK(length(snapshot_reference) BETWEEN 1 AND 200),
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK(file_size>0),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  source_row_count bigint NOT NULL CHECK(source_row_count>=0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(job_id,kind),
  FOREIGN KEY(job_id,organization_id) REFERENCES export_jobs(id,organization_id),
  CHECK(kind<>'summary' OR (file_size<100000000 AND mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
);
CREATE INDEX IF NOT EXISTS export_artifacts_org_job_idx ON export_artifacts(organization_id,job_id);
CREATE OR REPLACE FUNCTION prevent_export_artifact_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published export artifact evidence is immutable'; END $$;
DROP TRIGGER IF EXISTS export_artifact_immutable ON export_artifacts;
CREATE TRIGGER export_artifact_immutable BEFORE UPDATE ON export_artifacts FOR EACH ROW EXECUTE FUNCTION prevent_export_artifact_update();
