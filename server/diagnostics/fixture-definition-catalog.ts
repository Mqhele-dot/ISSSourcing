export const FIXTURE_PREDICATES = {
  users: "(username ~ '^subrt-[0-9]+-[a-f0-9]{8}-' OR email ~ '^subrt-[0-9]+-[a-f0-9]{8}-' OR lower(username) LIKE 'e2e_%' OR lower(email) LIKE 'e2e_%')",
  warehouses: "name ~* '^subrt-' OR name ~ '^(Workflow|Runtime|Propagation|Sourcing) Warehouse '",
  suppliers: "name ~ '^(Dependency|Workflow|Runtime|Propagation|Sourcing) Supplier ' OR supplier_code ~* '^subrt-'",
  inventoryItems: "name ~ '^(Dependency|Workflow|Runtime|Propagation|Sourcing) Item ' OR sku ~ '^(DEP-ITEM-|WF-|RT-|PROP-|SOURCING-|QT-QA-)'",
  unitsOfMeasure: "code ~ '^(DEP-(EA|BOX)-|EA-(ap|apx|rcv|over)-|EA-[0-9]{8}$)'",
  taxCodes: "code ~ '^(DEP-VAT-|VAT-(ap|apx|rcv|over)-|SRC-VAT-)'",
  costCentres: "code ~ '^(DEP-CC|CC-(ap|apx|rcv|over)-|CC-uie2e-)'",
  purchaseOrders: "order_number ~ '^(SUBRT-|RT-|RUNTIME-|PO-LT-)'",
  requisitions: "requisition_number ~ '^(SUBRT-|RT-|RUNTIME-|REQ-WF-)'",
  invoices: "invoice_number ~ '^(AP-INV-|AP-CTRL-|AP-DUP-|INV-MATCH-ap-|INV-UI-MATCH-uie2e-ap-|SUBRT-|RT-|RUNTIME-)'",
  approvalPolicies: "name ~ '^(AP Workflow|AP Test|AP Invalid)'",
  sourcingEvents: "title ~ '^(Runtime RFQ|E2E Controlled RFQ) '",
} as const;

export function fixtureDiagnosticUnionSql(): string {
  const p = FIXTURE_PREDICATES;
  return `
    SELECT COUNT(*) AS match_count FROM suppliers WHERE organization_id = $1 AND (${p.suppliers})
    UNION ALL SELECT COUNT(*) FROM inventory_items WHERE organization_id = $1 AND (${p.inventoryItems})
    UNION ALL SELECT COUNT(*) FROM approval_policies WHERE organization_id = $1 AND (${p.approvalPolicies})
    UNION ALL SELECT COUNT(*) FROM warehouses WHERE organization_id = $1 AND (${p.warehouses})
    UNION ALL SELECT COUNT(*) FROM users fixture_user WHERE (${p.users}) AND EXISTS (
      SELECT 1 FROM organization_members fixture_member WHERE fixture_member.user_id = fixture_user.id AND fixture_member.organization_id = $1
    )
    UNION ALL SELECT COUNT(*) FROM purchase_orders WHERE organization_id = $1 AND (${p.purchaseOrders})
    UNION ALL SELECT COUNT(*) FROM purchase_requisitions WHERE organization_id = $1 AND (${p.requisitions})
    UNION ALL SELECT COUNT(*) FROM invoices WHERE organization_id = $1 AND (${p.invoices})
    UNION ALL SELECT COUNT(*) FROM sourcing_events WHERE organization_id = $1 AND (${p.sourcingEvents})
    UNION ALL SELECT COUNT(*) FROM units_of_measure WHERE organization_id = $1 AND (${p.unitsOfMeasure})
    UNION ALL SELECT COUNT(*) FROM tax_codes WHERE organization_id = $1 AND (${p.taxCodes})
    UNION ALL SELECT COUNT(*) FROM mdm_cost_centres WHERE organization_id = $1 AND (${p.costCentres})
  `;
}
