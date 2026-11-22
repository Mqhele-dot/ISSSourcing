-- Separate approval boundary: Compact Excel remains disabled after installation.
ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS profile text NOT NULL DEFAULT 'standard';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='export_jobs'::regclass AND conname='export_jobs_profile_check') THEN
    ALTER TABLE export_jobs ADD CONSTRAINT export_jobs_profile_check CHECK(profile IN ('standard','compact_excel'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS export_jobs_id_organization_idx ON export_jobs(id,organization_id);
CREATE TABLE IF NOT EXISTS compact_export_attempts(
  id bigserial PRIMARY KEY,
  job_id integer NOT NULL,
  organization_id integer NOT NULL,
  server_id text NOT NULL CHECK(length(server_id) BETWEEN 1 AND 100),
  lease_token uuid NOT NULL UNIQUE,
  stage text NOT NULL CHECK(stage IN ('capturing','writing','validating','complete','refused','cancelled','interrupted')),
  lease_until timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  FOREIGN KEY(job_id,organization_id) REFERENCES export_jobs(id,organization_id),
  CHECK((stage IN ('capturing','writing','validating')) = (finished_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS compact_export_active_org_idx ON compact_export_attempts(organization_id) WHERE finished_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS compact_export_active_server_idx ON compact_export_attempts(server_id) WHERE finished_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS compact_export_active_job_idx ON compact_export_attempts(job_id) WHERE finished_at IS NULL;
CREATE INDEX IF NOT EXISTS compact_export_lease_expiry_idx ON compact_export_attempts(lease_until,id) WHERE finished_at IS NULL;
