/**
 * Single catalog of RBAC resources and permission types for the Role Manager UI and documentation.
 * Keep in sync with `ensurePermission("resource", "type")` on routes and custom-role checks.
 */

export type PermissionCatalogCategory = {
  id: string;
  label: string;
  resources: string[];
};

export const PERMISSION_CATALOG_CATEGORIES: PermissionCatalogCategory[] = [
  {
    id: "inventory",
    label: "Inventory & logistics",
    resources: ["inventory", "categories", "warehouses", "stock_movements"],
  },
  {
    id: "procurement",
    label: "Purchasing",
    resources: ["purchases", "suppliers", "reorder_requests"],
  },
  {
    id: "finance_data",
    label: "Finance data",
    resources: ["invoices", "billing", "taxes", "payments"],
  },
  {
    id: "people_access",
    label: "Users & access",
    resources: ["users", "custom_roles"],
  },
  {
    id: "insights",
    label: "Reporting & analytics",
    resources: ["reports", "analytics", "dashboards", "activity_logs", "audit_logs"],
  },
  {
    id: "system",
    label: "System",
    resources: ["settings", "system", "master_data", "import_export", "documents", "notifications"],
  },
];

export const PERMISSION_CATALOG_TYPES: { value: string; label: string }[] = [
  { value: "read", label: "Read" },
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
  { value: "approve", label: "Approve" },
  { value: "export", label: "Export" },
  { value: "import", label: "Import" },
  { value: "assign", label: "Assign" },
  { value: "execute", label: "Execute" },
  { value: "manage", label: "Manage" },
  { value: "admin", label: "Admin" },
];

export function getPermissionCatalogPayload() {
  return {
    categories: PERMISSION_CATALOG_CATEGORIES,
    permissionTypes: PERMISSION_CATALOG_TYPES,
  };
}
