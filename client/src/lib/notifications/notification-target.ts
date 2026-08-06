import { APP_ROUTES } from "@/lib/routes/app-routes";

export type NotificationTargetInput = {
  entityType?: string | null;
  entityId?: number | null;
  type?: string | null;
};

export function notificationTarget(input: NotificationTargetInput): string {
  const entityType = String(input.entityType ?? "").trim().toLowerCase();
  const id = Number(input.entityId);
  const hasId = Number.isInteger(id) && id > 0;

  if (["requisition", "purchase_requisition"].includes(entityType)) {
    return hasId ? APP_ROUTES.procurement.requisition(id) : APP_ROUTES.procurement.requisitions;
  }
  if (["purchase_order", "po", "receipt"].includes(entityType)) {
    return `${APP_ROUTES.procurement.orders}${hasId ? `?focusId=${id}` : ""}`;
  }
  if (["supplier"].includes(entityType)) return hasId ? APP_ROUTES.procurement.supplier(id) : APP_ROUTES.procurement.suppliers;
  if (["contract"].includes(entityType)) return `${APP_ROUTES.procurement.contracts}${hasId ? `?focusId=${id}` : ""}`;
  if (["inventory", "inventory_item", "stock"].includes(entityType)) return `${APP_ROUTES.inventory.root}${hasId ? `?focusId=${id}` : ""}`;
  if (["shipment"].includes(entityType)) return hasId ? APP_ROUTES.operations.shipment(id) : APP_ROUTES.operations.logistics;
  if (["gas_asset_profile", "fuel_station", "fuel_tank", "fuel_safety_inspection"].includes(entityType)) return APP_ROUTES.operations.fuel;
  if (["exception"].includes(entityType)) return `${APP_ROUTES.operations.exceptions}${hasId ? `?focusId=${id}` : ""}`;
  if (["invoice", "capture", "match_result", "payment_batch"].includes(entityType)) return APP_ROUTES.finance.accountsPayable;
  if (entityType === "diagnostics") return APP_ROUTES.admin.systemDiagnostics;

  const type = String(input.type ?? "").toLowerCase();
  if (type.includes("approval")) return APP_ROUTES.operations.mobileApprovals;
  if (type.includes("stock") || type.includes("inventory")) return APP_ROUTES.inventory.root;
  if (type.includes("gas") || type.includes("fuel") || type.includes("lpg")) return APP_ROUTES.operations.fuel;
  if (type.includes("shipment") || type.includes("delivery")) return APP_ROUTES.operations.logistics;
  if (type.includes("contract")) return APP_ROUTES.procurement.contracts;
  return APP_ROUTES.operations.controlTower;
}
