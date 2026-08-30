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
    { path: "/procurement/overview", label: "Procurement overview" },
    { path: "/procurement/sourcing", label: "Sourcing & RFQs" },
    { path: "/procurement/commercial-quotations", label: "Commercial quotations" },
    { path: "/procurement/quotations", label: "Supplier quotations" },
    { path: "/procurement/orders", label: "Purchase orders" },
    { path: "/procurement/requisitions", label: "Requisitions" },
    { path: "/procurement/suppliers", label: "Suppliers" },
    { path: "/procurement/contracts", label: "Contracts" },
    { path: "/procurement/receiving", label: "Receiving & returns" },
    { path: "/procurement/supplier-portal", label: "Supplier portal" },
  ] },
  { id: "finance", label: "Finance", items: [
    { path: "/finance/general-ledger", label: "General ledger" },
    { path: "/finance/accounts-receivable", label: "Accounts receivable" },
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
    { path: "/admin/company-setup", label: "Company setup", requiredRoles: ["admin"] },
    { path: "/admin/workflows", label: "Workflow governance", requiredRoles: ["admin"] },
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
  { entityType: "commercial_quotation", label: "Commercial quotations", amountBased: true, active: true },
  { entityType: "supplier_onboarding", label: "Supplier onboarding", amountBased: false, active: true },
  { entityType: "contract", label: "Supplier contracts", amountBased: true, active: true },
  { entityType: "contract_release", label: "Contract releases", amountBased: true, active: true },
  { entityType: "receipt_reversal", label: "Goods receipt reversals", amountBased: false, active: true },
  { entityType: "budget_override", label: "Budget overrides", amountBased: true, active: true },
  { entityType: "purchase_return", label: "Purchase returns", amountBased: true, active: true },
  { entityType: "supplier_debit_note", label: "Supplier debit notes", amountBased: true, active: true },
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

export type WorkflowBlueprint = {
  id: string;
  label: string;
  description: string;
  entityTypes: readonly string[];
  stages: readonly string[];
  alternativeStates: readonly string[];
  controls: readonly string[];
  workspacePath: string;
};

/**
 * Canonical business-process map. Approval policies provide the configurable
 * routing rules while domain services remain authoritative for transitions.
 */
export const workflowBlueprintCatalog = [
  {
    id: "requisitions", label: "Requisitions", description: "Control internal demand before supplier commitment.",
    entityTypes: ["requisition"], stages: ["Draft", "Submitted", "Pending approval", "Approved", "Converted to PO"],
    alternativeStates: ["Needs more information", "Rejected", "Cancelled", "Expired"],
    controls: ["Requester cannot approve their own request", "Amount, department and cost-centre authority", "Approved commercial fields are locked"],
    workspacePath: "/procurement/requisitions",
  },
  {
    id: "purchase-orders", label: "Purchase orders", description: "Govern supplier commitments, sending and receipt progress.",
    entityTypes: ["purchase_order"], stages: ["Draft", "Pending approval", "Approved", "Sent", "Partially received", "Received", "Closed"],
    alternativeStates: ["Rejected", "On hold", "Blocked", "Cancelled"],
    controls: ["Sequential amount-band approval", "Sent commercial terms are locked", "Closed or cancelled orders cannot receive"],
    workspacePath: "/procurement/orders",
  },
  {
    id: "supplier-confirmation", label: "Supplier confirmation", description: "Capture acknowledgement, delivery commitment and supplier exceptions.",
    entityTypes: ["purchase_order"], stages: ["PO sent", "Awaiting confirmation", "Confirmed", "ETA supplied", "Shipment created"],
    alternativeStates: ["Clarification requested", "Rejected by supplier", "ETA missing", "Supplier delay"],
    controls: ["Supplier acknowledgement evidence", "ETA required for delivery", "Missing confirmation creates an exception"],
    workspacePath: "/procurement/supplier-portal",
  },
  {
    id: "logistics", label: "Logistics & shipments", description: "Track inbound and outbound movement with ETA risk controls.",
    entityTypes: [], stages: ["Planned", "Booked", "Dispatched", "In transit", "Due soon", "Received"],
    alternativeStates: ["No ETA", "Delayed", "Exception", "Cancelled"],
    controls: ["Shipment must reference its source", "Late and missing ETA rules are deduplicated", "Receiving reconciles shipment and PO status"],
    workspacePath: "/operations/logistics",
  },
  {
    id: "receiving", label: "Receiving & inventory", description: "Verify goods before posting canonical warehouse stock.",
    entityTypes: ["receipt_reversal", "inventory_adjustment", "inventory_transfer"], stages: ["Awaiting receipt", "Receipt draft", "Quantity verified", "Posted to inventory", "Closed"],
    alternativeStates: ["Partial receipt", "Discrepancy", "Quality hold", "Over-receipt blocked"],
    controls: ["Warehouse and item ownership validation", "Tolerance and availability checks", "Every posting creates an auditable stock movement"],
    workspacePath: "/procurement/receiving",
  },
  {
    id: "contract-releases", label: "Contracts & releases", description: "Control repeat purchasing against approved supplier commitments.",
    entityTypes: ["contract", "contract_release"], stages: ["Draft", "Pending approval", "Approved", "Active", "Released", "Expired"],
    alternativeStates: ["Variance", "Exhausted", "Terminated", "Renewal due"],
    controls: ["Approved supplier and value cap", "Release PO reduces remaining value", "Price variance requires approval"],
    workspacePath: "/procurement/contracts",
  },
  {
    id: "purchase-returns", label: "Purchase returns", description: "Return received supplier goods with inventory and financial evidence.",
    entityTypes: ["purchase_return", "supplier_debit_note"], stages: ["Draft", "Pending approval", "Approved", "Dispatched", "Acknowledged", "Closed"],
    alternativeStates: ["Cancelled", "Insufficient stock", "Supplier dispute"],
    controls: ["Return cannot exceed accepted receipt quantity", "Dispatch creates compensating stock movement", "Debit note links to original evidence"],
    workspacePath: "/procurement/receiving",
  },
  {
    id: "budget-control", label: "Budget control", description: "Reserve approved spend without double-counting conversions.",
    entityTypes: ["budget_override"], stages: ["Budget checked", "Commitment reserved", "Transferred to PO", "Realized", "Released"],
    alternativeStates: ["Over budget", "Elevated approval", "Hard blocked"],
    controls: ["Department and cost-centre scope", "Default warning and elevated approval", "Organization may enable hard blocking"],
    workspacePath: "/procurement/settings",
  },
  {
    id: "accounts-payable", label: "Accounts payable", description: "Match, approve and pay supplier invoices with segregation of duties.",
    entityTypes: ["invoice", "payment_batch"], stages: ["Draft", "Submitted", "Matched", "Pending approval", "Approved", "Scheduled", "Paid"],
    alternativeStates: ["Mismatch", "Duplicate risk", "Rejected", "Blocked"],
    controls: ["PO and receipt match evidence", "Creator cannot approve their own financial document", "Paid documents are immutable"],
    workspacePath: "/finance/accounts-payable",
  },
  {
    id: "master-data", label: "Master Data changes", description: "Review sensitive reference-data changes before they become active.",
    entityTypes: ["master_data_change", "supplier_onboarding", "contract"], stages: ["Draft change", "Submitted", "Under review", "Approved", "Applied", "Active"],
    alternativeStates: ["Needs more information", "Rejected", "Superseded", "Cancelled"],
    controls: ["Before-and-after evidence", "Where-used impact review", "High-risk changes require independent approval"],
    workspacePath: "/admin/master-data",
  },
  {
    id: "exceptions", label: "Exceptions", description: "Assign, investigate, resolve and close operational problems.",
    entityTypes: [], stages: ["Detected", "Open", "Assigned", "In progress", "Resolved", "Closed"],
    alternativeStates: ["Pending external action", "Escalated", "Duplicate", "Reopened"],
    controls: ["Critical issues require an owner", "SLA breaches escalate", "Closure requires a resolution note"],
    workspacePath: "/operations/exceptions",
  },
] as const satisfies readonly WorkflowBlueprint[];
