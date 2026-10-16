ALTER TABLE ops_activity
ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id);

-- Historical operational activity is attributable only when the database has
-- exactly one organization. Ambiguous rows stay unassigned and fail closed.
UPDATE ops_activity
SET organization_id = (SELECT min(id) FROM organizations)
WHERE organization_id IS NULL
  AND (SELECT count(*) FROM organizations) = 1;

CREATE INDEX IF NOT EXISTS idx_ops_activity_org_created
ON ops_activity (organization_id, created_at DESC, id DESC);
