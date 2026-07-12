import { pool } from "../../db";

export type MdmWhereUsedUsage = {
  workflow: string;
  label: string;
  count: number;
  blocking: boolean;
};

export type MdmWhereUsedResult = {
  domain: string;
  id: number;
  dependencies: MdmWhereUsedUsage[];
  canArchive: boolean;
  canDeactivate: boolean;
  replacementAllowed: boolean;
  code: "MDM_DEPENDENCY_BLOCKED" | "MDM_NO_DEPENDENCIES";
};

async function count(sqlText: string, values: unknown[]) {
  const result = await pool.query<{ count: string }>(sqlText, values);
  return Number(result.rows[0]?.count ?? 0);
}

function usage(workflow: string, label: string, countValue: number, blocking = true): MdmWhereUsedUsage[] {
  return countValue > 0 ? [{ workflow, label, count: countValue, blocking }] : [];
}

export async function getMdmWhereUsed(domain: string, organizationId: number, id: number): Promise<MdmWhereUsedResult> {
  const dependencies: MdmWhereUsedUsage[] = [];

  if (domain === "suppliers" || domain === "supplier") {
    dependencies.push(
      ...usage(
        "Procurement",
        "open requisitions",
        await count(
          "SELECT COUNT(*) FROM purchase_requisitions WHERE organization_id = $1 AND supplier_id = $2 AND UPPER(COALESCE(status, 'DRAFT')) NOT IN ('CONVERTED', 'CLOSED', 'CANCELLED', 'REJECTED')",
          [organizationId, id],
        ),
      ),
      ...usage(
        "Procurement",
        "open purchase orders",
        await count(
          "SELECT COUNT(*) FROM purchase_orders WHERE organization_id = $1 AND supplier_id = $2 AND UPPER(COALESCE(status, 'DRAFT')) NOT IN ('RECEIVED', 'CLOSED', 'CANCELLED')",
          [organizationId, id],
        ),
      ),
      ...usage(
        "Finance",
        "open AP invoices",
        await count(
          "SELECT COUNT(*) FROM invoices WHERE organization_id = $1 AND supplier_id = $2 AND UPPER(COALESCE(status, 'DRAFT')) NOT IN ('PAID', 'CANCELLED', 'VOID')",
          [organizationId, id],
        ),
      ),
      ...usage(
        "Contracts",
        "active contracts",
        await count(
          "SELECT COUNT(*) FROM supplier_contracts WHERE organization_id = $1 AND supplier_id = $2 AND COALESCE(status, 'active') = 'active'",
          [organizationId, id],
        ),
      ),
    );
  } else if (domain === "items" || domain === "inventory-items") {
    dependencies.push(
      ...usage(
        "Procurement",
        "open requisition lines",
        await count(
          "SELECT COUNT(*) FROM purchase_requisition_items pri JOIN purchase_requisitions pr ON pr.id = pri.requisition_id WHERE pr.organization_id = $1 AND pri.item_id = $2 AND UPPER(COALESCE(pr.status, 'DRAFT')) NOT IN ('CONVERTED', 'CLOSED', 'CANCELLED', 'REJECTED')",
          [organizationId, id],
        ),
      ),
      ...usage(
        "Procurement",
        "open purchase order lines",
        await count(
          "SELECT COUNT(*) FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.order_id WHERE po.organization_id = $1 AND poi.item_id = $2 AND UPPER(COALESCE(po.status, 'DRAFT')) NOT IN ('RECEIVED', 'CLOSED', 'CANCELLED')",
          [organizationId, id],
        ),
      ),
      ...usage(
        "Inventory",
        "warehouse stock records",
        await count("SELECT COUNT(*) FROM warehouse_inventory WHERE organization_id = $1 AND item_id = $2", [
          organizationId,
          id,
        ]),
      ),
    );
  } else if (domain === "warehouses") {
    dependencies.push(
      ...usage(
        "Inventory",
        "warehouse stock",
        await count("SELECT COUNT(*) FROM warehouse_inventory WHERE organization_id = $1 AND warehouse_id = $2", [
          organizationId,
          id,
        ]),
      ),
      ...usage(
        "Warehouse",
        "cycle counts",
        await count("SELECT COUNT(*) FROM cycle_counts WHERE organization_id = $1 AND warehouse_id = $2", [
          organizationId,
          id,
        ]),
      ),
    );
  } else if (domain === "cost-centres") {
    dependencies.push(
      ...usage(
        "Procurement",
        "open requisition lines",
        await count(
          "SELECT COUNT(*) FROM purchase_requisition_items pri JOIN purchase_requisitions pr ON pr.id = pri.requisition_id WHERE pr.organization_id = $1 AND pri.cost_centre_id = $2 AND UPPER(COALESCE(pr.status, 'DRAFT')) NOT IN ('CONVERTED', 'CLOSED', 'CANCELLED', 'REJECTED')",
          [organizationId, id],
        ),
      ),
      ...usage(
        "Finance",
        "GL mappings",
        await count("SELECT COUNT(*) FROM mdm_gl_mappings WHERE organization_id = $1 AND cost_centre_id = $2", [
          organizationId,
          id,
        ]),
      ),
    );
  } else if (domain === "units-of-measure" || domain === "uom") {
    dependencies.push(
      ...usage(
        "Inventory",
        "active items",
        await count(
          "SELECT COUNT(*) FROM inventory_items WHERE organization_id = $1 AND unit_of_measure_id = $2 AND COALESCE(status, 'active') = 'active'",
          [organizationId, id],
        ),
      ),
      ...usage(
        "Procurement",
        "open PO lines",
        await count(
          "SELECT COUNT(*) FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.order_id WHERE po.organization_id = $1 AND poi.unit_of_measure_id = $2 AND UPPER(COALESCE(po.status, 'DRAFT')) NOT IN ('RECEIVED', 'CLOSED', 'CANCELLED')",
          [organizationId, id],
        ),
      ),
    );
  } else if (domain === "tax-codes") {
    dependencies.push(
      ...usage(
        "Suppliers",
        "supplier defaults",
        await count("SELECT COUNT(*) FROM suppliers WHERE organization_id = $1 AND tax_code_id = $2", [
          organizationId,
          id,
        ]),
      ),
      ...usage(
        "Procurement",
        "open PO headers",
        await count(
          "SELECT COUNT(*) FROM purchase_orders WHERE organization_id = $1 AND tax_code_id = $2 AND UPPER(COALESCE(status, 'DRAFT')) NOT IN ('RECEIVED', 'CLOSED', 'CANCELLED')",
          [organizationId, id],
        ),
      ),
    );
  }

  const blocking = dependencies.some((dependency) => dependency.blocking);
  return {
    domain,
    id,
    dependencies,
    canArchive: !blocking,
    canDeactivate: !blocking,
    replacementAllowed: blocking,
    code: blocking ? "MDM_DEPENDENCY_BLOCKED" : "MDM_NO_DEPENDENCIES",
  };
}
