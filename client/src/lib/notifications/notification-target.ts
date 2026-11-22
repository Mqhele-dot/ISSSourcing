import { APP_ROUTES } from "@/lib/routes/app-routes";

export type NotificationTargetInput = {
  entityType?: string | null;
  entityId?: number | null;
  type?: string | null;
  title?: string | null;
  targetPath?: string | null;
  findingCode?: string | null;
};

export function isSafeInternalNotificationPath(value: string | null | undefined): value is string {
  if (!value) return false;
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !/[\r\n]/.test(value);
}

export function notificationTarget(input: NotificationTargetInput): string {
  if (isSafeInternalNotificationPath(input.targetPath)) return input.targetPath;
  const entityType = String(input.entityType ?? "").trim().toLowerCase();
  const type = String(input.type ?? "").toLowerCase();
  const notificationKind = `${type} ${String(input.title ?? "").toLowerCase()}`;
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
  if (["inventory", "inventory_item", "stock"].includes(entityType)) {
    const params = new URLSearchParams();
    if (notificationKind.includes("low_stock") || notificationKind.includes("low stock")) params.set("low", "1");
    if (hasId) params.set("focusId", String(id));
    const query = params.toString();
    return `${APP_ROUTES.inventory.root}${query ? `?${query}` : ""}`;
  }
  if (["shipment"].includes(entityType)) return hasId ? APP_ROUTES.operations.shipment(id) : APP_ROUTES.operations.logistics;
  if (["gas_asset_profile", "fuel_station", "fuel_tank", "fuel_safety_inspection"].includes(entityType)) return APP_ROUTES.operations.fuel;
  if (["exception"].includes(entityType)) return `${APP_ROUTES.operations.exceptions}${hasId ? `?focusId=${id}` : ""}`;
  if (["invoice", "capture", "match_result", "payment_batch"].includes(entityType)) return APP_ROUTES.finance.accountsPayable;
  if (entityType === "diagnostics") {
    const params = new URLSearchParams({ view: "consistency" });
    if (input.findingCode) params.set("finding", input.findingCode);
    return `${APP_ROUTES.admin.systemDiagnostics}?${params.toString()}`;
  }

  if (notificationKind.includes("approval")) return APP_ROUTES.operations.mobileApprovals;
  if (notificationKind.includes("low_stock") || notificationKind.includes("low stock")) return `${APP_ROUTES.inventory.root}?low=1`;
  if (type.includes("stock") || type.includes("inventory")) return APP_ROUTES.inventory.root;
  if (type.includes("gas") || type.includes("fuel") || type.includes("lpg")) return APP_ROUTES.operations.fuel;
  if (type.includes("shipment") || type.includes("delivery")) return APP_ROUTES.operations.logistics;
  if (type.includes("contract")) return APP_ROUTES.procurement.contracts;
  return APP_ROUTES.operations.controlTower;
}
