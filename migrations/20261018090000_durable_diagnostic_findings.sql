-- Diagnostic evidence only; no operational data is changed.
CREATE TABLE IF NOT EXISTS diagnostic_check_runs (
  id uuid PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (organization_id,id)
);
CREATE TABLE IF NOT EXISTS diagnostic_persistent_findings (
  organization_id integer NOT NULL REFERENCES organizations(id),
  finding_key text NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('open','acknowledged','resolved')),
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  last_passed_at timestamptz,
  last_checked_at timestamptz NOT NULL,
  occurrences integer NOT NULL DEFAULT 0,
  consecutive_passes integer NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL,
  PRIMARY KEY (organization_id,finding_key)
);
CREATE TABLE IF NOT EXISTS diagnostic_observations (
  id bigserial PRIMARY KEY,
  organization_id integer NOT NULL,
  run_id uuid NOT NULL,
  finding_key text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  evidence jsonb NOT NULL,
  previous_lifecycle text,
  lifecycle text NOT NULL,
  FOREIGN KEY (organization_id,run_id) REFERENCES diagnostic_check_runs(organization_id,id),
  UNIQUE (organization_id,run_id,finding_key)
);
CREATE INDEX IF NOT EXISTS diagnostic_findings_lifecycle_idx ON diagnostic_persistent_findings
  (organization_id,lifecycle,last_checked_at DESC,finding_key);
CREATE INDEX IF NOT EXISTS diagnostic_observation_history_idx ON diagnostic_observations
  (organization_id,finding_key,observed_at DESC,id DESC);
