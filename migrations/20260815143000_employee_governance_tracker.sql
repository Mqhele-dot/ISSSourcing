CREATE TABLE IF NOT EXISTS user_approval_limits (
  id serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  amount_limit real,
  currency_code text NOT NULL DEFAULT 'ZAR',
  updated_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT user_approval_limits_amount_check CHECK (amount_limit IS NULL OR amount_limit >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_approval_limits_org_user_entity_uidx
  ON user_approval_limits (organization_id, user_id, entity_type);
CREATE INDEX IF NOT EXISTS user_approval_limits_org_entity_idx
  ON user_approval_limits (organization_id, entity_type, user_id);

-- Preserve the legacy requisition authority as the initial requisition-specific limit.
INSERT INTO user_approval_limits (
  organization_id, user_id, entity_type, amount_limit, currency_code, updated_by
)
SELECT om.organization_id, u.id, 'requisition', u.approver_amount_limit,
       COALESCE(o.default_currency_code, 'ZAR'), u.id
FROM users u
JOIN organization_members om ON om.user_id = u.id AND om.active = TRUE
JOIN organizations o ON o.id = om.organization_id
WHERE u.approver_amount_limit IS NOT NULL
ON CONFLICT (organization_id, user_id, entity_type) DO NOTHING;
