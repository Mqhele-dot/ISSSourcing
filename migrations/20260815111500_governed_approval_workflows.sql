-- Complete starter approval coverage without overwriting tenant-defined policies.
WITH policy_defaults(entity_type, name, amount_min, amount_max, approval_level, approver_role) AS (
  VALUES
    ('requisition', 'Requisition Standard Approval', 0::real, 5000::real, 1, 'manager'),
    ('requisition', 'Requisition High Value Approval', 5000.01::real, NULL::real, 2, 'admin'),
    ('purchase_order', 'PO Standard Approval', 0::real, NULL::real, 1, 'manager'),
    ('purchase_order', 'PO High Value Approval', 5000::real, NULL::real, 2, 'admin'),
    ('sourcing_award', 'Sourcing Award Approval', 0::real, NULL::real, 1, 'manager'),
    ('supplier_onboarding', 'Supplier Onboarding Approval', 0::real, NULL::real, 1, 'manager'),
    ('contract', 'Supplier Contract Approval', 0::real, NULL::real, 1, 'manager'),
    ('inventory_transfer', 'Inventory Transfer Approval', 0::real, NULL::real, 1, 'manager'),
    ('inventory_adjustment', 'Inventory Adjustment Approval', 0::real, NULL::real, 1, 'manager'),
    ('invoice', 'Invoice Approval', 0::real, NULL::real, 1, 'manager'),
    ('payment_batch', 'Payment Batch Approval', 0::real, NULL::real, 1, 'admin'),
    ('master_data_change', 'Master Data Change Approval', 0::real, NULL::real, 1, 'admin')
)
INSERT INTO approval_policies (
  organization_id, name, entity_type, amount_min, amount_max,
  approval_level, approver_role, is_active, version, created_at, updated_at
)
SELECT organization.id, defaults.name, defaults.entity_type, defaults.amount_min, defaults.amount_max,
  defaults.approval_level, defaults.approver_role, TRUE, 1, NOW(), NOW()
FROM organizations organization
CROSS JOIN policy_defaults defaults
WHERE COALESCE(organization.active, TRUE) = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM approval_policies existing
    WHERE existing.organization_id = organization.id
      AND existing.entity_type = defaults.entity_type
      AND existing.approval_level = defaults.approval_level
  );

CREATE INDEX IF NOT EXISTS approval_policies_org_entity_active_level_idx
  ON approval_policies (organization_id, entity_type, is_active, approval_level, amount_min, amount_max);

CREATE INDEX IF NOT EXISTS approval_history_org_entity_level_action_idx
  ON approval_history (organization_id, entity_type, entity_id, level, action, performed_at);
