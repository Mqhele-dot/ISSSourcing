import { pool } from "../../db";

export type DependencyCheck = {
  label: string;
  count: number;
};

async function count(sqlText: string, params: unknown[]): Promise<number> {
  const result = await pool.query<{ count: number }>(sqlText, params);
  return Number(result.rows[0]?.count ?? 0);
}

function compact(checks: DependencyCheck[]): DependencyCheck[] {
  return checks.filter((check) => Number(check.count) > 0);
}

export function dependencyBlockedMessage(entityLabel: string, action: "disable" | "delete", checks: DependencyCheck[]) {
  const details = checks.map((check) => `${check.count} ${check.label}`).join(", ");
  return `Cannot ${action} this ${entityLabel} while it is used by ${details}.`;
}

export async function getSupplierWhereUsed(organizationId: number, supplierId: number): Promise<DependencyCheck[]> {
  return compact([
    {
      label: "carrier profiles",
      count: await count(
        `
          SELECT count(*)::int
          FROM carriers
          WHERE organization_id = $1
            AND supplier_id = $2
        `,
        [organizationId, supplierId],
      ),
    },
    {
      label: "open requisitions",
      count: await count(
        `
          SELECT count(*)::int
          FROM purchase_requisitions
          WHERE organization_id = $1
            AND supplier_id = $2
            AND upper(COALESCE(status, '')) IN ('DRAFT', 'PENDING', 'APPROVED')
        `,
        [organizationId, supplierId],
      ),
    },
    {
      label: "open purchase orders",
      count: await count(
        `
          SELECT count(*)::int
          FROM purchase_orders
          WHERE organization_id = $1
            AND supplier_id = $2
            AND lower(COALESCE(status, '')) NOT IN ('received', 'closed', 'cancelled', 'void')
        `,
        [organizationId, supplierId],
      ),
    },
    {
      label: "active supplier contracts",
      count: await count(
        `
          SELECT count(*)::int
          FROM supplier_contracts
          WHERE organization_id = $1
            AND supplier_id = $2
            AND lower(COALESCE(status, 'active')) NOT IN ('expired', 'terminated', 'cancelled', 'inactive')
        `,
        [organizationId, supplierId],
      ),
    },
    {
      label: "open AP invoices",
      count: await count(
        `
          SELECT count(*)::int
          FROM invoices
          WHERE organization_id = $1
            AND supplier_id = $2
            AND upper(COALESCE(status, '')) NOT IN ('PAID', 'CANCELLED', 'VOID')
        `,
        [organizationId, supplierId],
      ),
    },
  ]);
}

export async function getInventoryItemWhereUsed(organizationId: number, itemId: number): Promise<DependencyCheck[]> {
  return compact([
    {
      label: "open requisition lines",
      count: await count(
        `
          SELECT count(*)::int
          FROM purchase_requisition_items pri
          JOIN purchase_requisitions pr ON pr.id = pri.requisition_id
          WHERE pr.organization_id = $1
            AND pri.item_id = $2
            AND upper(COALESCE(pr.status, '')) IN ('DRAFT', 'PENDING', 'APPROVED')
        `,
        [organizationId, itemId],
      ),
    },
    {
      label: "open purchase order lines",
      count: await count(
        `
          SELECT count(*)::int
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.order_id
          WHERE po.organization_id = $1
            AND poi.item_id = $2
            AND lower(COALESCE(po.status, '')) NOT IN ('received', 'closed', 'cancelled', 'void')
        `,
        [organizationId, itemId],
      ),
    },
    {
      label: "open invoice lines",
      count: await count(
        `
          SELECT count(*)::int
          FROM invoice_items ii
          JOIN invoices i ON i.id = ii.invoice_id
          WHERE i.organization_id = $1
            AND ii.item_id = $2
            AND upper(COALESCE(i.status, '')) NOT IN ('PAID', 'CANCELLED', 'VOID')
        `,
        [organizationId, itemId],
      ),
    },
    {
      label: "warehouse stock",
      count: await count(
        `
          SELECT count(*)::int
          FROM warehouse_inventory
          WHERE organization_id = $1
            AND item_id = $2
            AND COALESCE(quantity, 0) <> 0
        `,
        [organizationId, itemId],
      ),
    },
  ]);
}

export async function getWarehouseWhereUsed(organizationId: number, warehouseId: number): Promise<DependencyCheck[]> {
  return compact([
    {
      label: "stock balances",
      count: await count(
        `
          SELECT count(*)::int
          FROM warehouse_inventory
          WHERE organization_id = $1
            AND warehouse_id = $2
            AND COALESCE(quantity, 0) <> 0
        `,
        [organizationId, warehouseId],
      ),
    },
    {
      label: "stock movements",
      count: await count(
        `
          SELECT count(*)::int
          FROM stock_movements
          WHERE organization_id = $1
            AND (
              warehouse_id = $2
              OR source_warehouse_id = $2
              OR destination_warehouse_id = $2
            )
        `,
        [organizationId, warehouseId],
      ),
    },
    {
      label: "item defaults",
      count: await count(
        `
          SELECT count(*)::int
          FROM inventory_items
          WHERE organization_id = $1
            AND default_warehouse_id = $2
        `,
        [organizationId, warehouseId],
      ),
    },
    {
      label: "supplier contract defaults",
      count: await count(
        `
          SELECT count(*)::int
          FROM supplier_contracts
          WHERE organization_id = $1
            AND default_warehouse_id = $2
            AND lower(COALESCE(status, 'active')) NOT IN ('expired', 'terminated', 'cancelled', 'inactive')
        `,
        [organizationId, warehouseId],
      ),
    },
  ]);
}
