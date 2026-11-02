-- Separate approval boundary. Evidence storage does not enable Compact Excel.
CREATE TABLE IF NOT EXISTS compact_export_publications (
  job_id integer PRIMARY KEY,
  organization_id integer NOT NULL,
  actor_id integer NOT NULL,
  attempt_id bigint NOT NULL UNIQUE REFERENCES compact_export_attempts(id),
  observation_reference text NOT NULL CHECK(length(observation_reference) BETWEEN 1 AND 200),
  dataset text NOT NULL,
  schema_version text NOT NULL,
  normalized_filters jsonb NOT NULL,
  selected_columns jsonb NOT NULL CHECK(jsonb_typeof(selected_columns)='array'),
  source_information jsonb NOT NULL,
  capture_sha256 text NOT NULL CHECK(capture_sha256 ~ '^[a-f0-9]{64}$'),
  writer_version text NOT NULL,
  validator_version text NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL UNIQUE,
  file_size bigint NOT NULL CHECK(file_size>0 AND file_size<100000000),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  source_row_count bigint NOT NULL CHECK(source_row_count>=0),
  data_sheet_count integer NOT NULL CHECK(data_sheet_count>0),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(job_id,organization_id) REFERENCES export_jobs(id,organization_id)
);
CREATE INDEX IF NOT EXISTS compact_publication_org_job_idx ON compact_export_publications(organization_id,job_id);
CREATE OR REPLACE FUNCTION prevent_compact_publication_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published compact validation evidence is immutable'; END $$;
DROP TRIGGER IF EXISTS compact_publication_immutable ON compact_export_publications;
CREATE TRIGGER compact_publication_immutable BEFORE UPDATE OR DELETE ON compact_export_publications
  FOR EACH ROW EXECUTE FUNCTION prevent_compact_publication_change();
