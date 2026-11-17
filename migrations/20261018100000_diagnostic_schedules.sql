CREATE TABLE IF NOT EXISTS diagnostic_schedules (
  organization_id integer NOT NULL REFERENCES organizations(id),
  tier text NOT NULL CHECK(tier IN ('critical','deep')),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_outcome text CHECK(last_outcome IN ('completed','failed')),
  PRIMARY KEY(organization_id,tier)
);
CREATE INDEX IF NOT EXISTS diagnostic_schedules_due_idx ON diagnostic_schedules(next_run_at,organization_id);
