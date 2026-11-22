-- AP hardening: approval history tenancy + indexes for policy/audit workflows

ALTER TABLE approval_history
  ADD COLUMN IF NOT EXISTS organization_id INTEGER;

UPDATE approval_history
SET organization_id = 1
WHERE organization_id IS NULL;

ALTER TABLE approval_history
  ALTER COLUMN organization_id SET DEFAULT 1;

ALTER TABLE approval_history
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'approval_history_organization_id_organizations_id_fk'
  ) THEN
    ALTER TABLE approval_history
      ADD CONSTRAINT approval_history_organization_id_organizations_id_fk
      FOREIGN KEY (organization_id) REFERENCES organizations(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS approval_history_org_entity_idx
  ON approval_history (organization_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS approval_policies_org_entity_active_idx
  ON approval_policies (organization_id, entity_type, is_active);
