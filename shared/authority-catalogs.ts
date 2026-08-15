export type NavigationAccessItem = {
  path: string;
  label: string;
  requiredRoles?: readonly string[];
};

export type NavigationAccessGroup = {
  id: string;
  label: string;
  items: readonly NavigationAccessItem[];
};

/** Server-authoritative set of navigation roots administrators may assign to profiles. */
export const navigationAccessCatalog = [
  { id: "operations", label: "Operations", items: [
    { path: "/operations", label: "Overview" },
    { path: "/operations/control-tower", label: "Control tower" },
    { path: "/operations/fuel", label: "Fuel operations" },
    { path: "/operations/logistics", label: "Logistics" },
    { path: "/operations/exceptions", label: "Exceptions" },
    { path: "/operations/mobile-workflows", label: "Mobile workflows" },
  ] },
  { id: "inventory", label: "Inventory", items: [
    { path: "/inventory", label: "Inventory" },
    { path: "/inventory/warehouse-operations", label: "Warehouse operations" },
    { path: "/inventory/cycle-counts", label: "Cycle counts" },
    { path: "/inventory/reorder", label: "Reorder requests" },
    { path: "/inventory/barcodes", label: "Barcode scanner" },
  ] },
  { id: "procurement", label: "Procurement", items: [
    { path: "/procurement/sourcing", label: "Sourcing & RFQs" },
    { path: "/procurement/orders", label: "Purchase orders" },
    { path: "/procurement/requisitions", label: "Requisitions" },
    { path: "/procurement/suppliers", label: "Suppliers" },
    { path: "/procurement/contracts", label: "Contracts" },
    { path: "/procurement/supplier-portal", label: "Supplier portal" },
  ] },
  { id: "finance", label: "Finance", items: [
    { path: "/finance/accounts-payable", label: "Accounts payable" },
    { path: "/finance/invoices", label: "Invoices" },
    { path: "/finance/approval-policies", label: "Approval policies" },
  ] },
  { id: "analytics", label: "Analytics", items: [
    { path: "/analytics/overview", label: "Overview" },
    { path: "/analytics/reports", label: "Reports" },
    { path: "/analytics/saved-reports", label: "Saved reports" },
    { path: "/analytics/export-center", label: "Export center" },
  ] },
  { id: "administration", label: "Administration", items: [
    { path: "/admin/settings", label: "Settings", requiredRoles: ["admin"] },
    { path: "/admin/master-data", label: "Master data", requiredRoles: ["admin"] },
    { path: "/admin/document-extractor", label: "Document extractor", requiredRoles: ["manager", "admin"] },
    { path: "/admin/integrations", label: "Integrations", requiredRoles: ["admin"] },
    { path: "/admin/audit-logs", label: "Audit logs", requiredRoles: ["admin"] },
    { path: "/admin/subscription", label: "Subscription", requiredRoles: ["admin"] },
    { path: "/admin/documents", label: "Documents", requiredRoles: ["manager", "admin"] },
    { path: "/admin/image-recognition", label: "Image recognition" },
    { path: "/admin/employee-profiles", label: "Employee profiles", requiredRoles: ["manager", "admin"] },
    { path: "/admin/user-roles", label: "User roles", requiredRoles: ["admin"] },
    { path: "/admin/system-diagnostics", label: "System diagnostics", requiredRoles: ["admin"] },
    { path: "/admin/profile", label: "Profile" },
  ] },
  { id: "learning", label: "Learning", items: [
    { path: "/get-educated", label: "Get Educated" },
  ] },
] as const satisfies readonly NavigationAccessGroup[];

export const assignableNavigationPaths = new Set<string>(
  navigationAccessCatalog.flatMap((group) => group.items.map((item) => item.path)),
);

export function isAssignableNavigationPath(value: unknown): value is string {
  return typeof value === "string" && assignableNavigationPaths.has(value);
}

export type ApprovalWorkflowCatalogItem = {
  entityType: string;
  label: string;
  amountBased: boolean;
  active: boolean;
};

export type ApprovalWorkflowCatalogResponse = { items: ApprovalWorkflowCatalogItem[] };

export const approvalWorkflowCatalog = [
  { entityType: "requisition", label: "Purchase requisitions", amountBased: true, active: true },
  { entityType: "purchase_order", label: "Purchase orders", amountBased: true, active: true },
  { entityType: "sourcing_award", label: "Sourcing awards", amountBased: true, active: true },
  { entityType: "supplier_onboarding", label: "Supplier onboarding", amountBased: false, active: true },
  { entityType: "contract", label: "Supplier contracts", amountBased: true, active: true },
  { entityType: "inventory_transfer", label: "Inventory transfers", amountBased: true, active: true },
  { entityType: "inventory_adjustment", label: "Inventory adjustments", amountBased: true, active: true },
  { entityType: "invoice", label: "Supplier invoices", amountBased: true, active: true },
  { entityType: "payment_batch", label: "Payment batches", amountBased: true, active: true },
  { entityType: "master_data_change", label: "Master Data changes", amountBased: false, active: true },
] as const satisfies readonly ApprovalWorkflowCatalogItem[];

export type GovernedApprovalEntityType = (typeof approvalWorkflowCatalog)[number]["entityType"];
export const governedApprovalEntityTypes = approvalWorkflowCatalog.map((item) => item.entityType) as GovernedApprovalEntityType[];

export function isGovernedApprovalEntityType(value: string): value is GovernedApprovalEntityType {
  return (governedApprovalEntityTypes as readonly string[]).includes(value);
}
