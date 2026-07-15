/**
 * Central export configuration: columns, PDF orientation, default filenames, metadata hints.
 * Consumed by document-generator-service and export routes.
 */
import type { ReportType } from "@shared/schema";

export type ReportExportOrientation = "portrait" | "landscape";

/** Dedicated PDF layout (generic = column-driven table via generateGenericPdf). */
export type ReportPdfLayout =
  | "generic"
  | "purchase_orders"
  | "purchase_requisitions"
  | "activity_logs"
  | "supplier_profile"
  | "warehouse_profile";

export interface ReportColumnDef {
  header: string;
  key: string;
  width: number;
}

export interface ReportExportEntry {
  /** Default report title stem (before filter suffix from route) */
  defaultTitle: string;
  orientation: ReportExportOrientation;
  /** Use wrap-first multi-line cells in generic PDF tables */
  pdfWrapCells: boolean;
  /** When not generic, generateDocument uses a dedicated PDF builder (may fall back for edge cases). */
  pdfLayout: ReportPdfLayout;
  columns: ReportColumnDef[];
}

const INVENTORY_COLS: ReportColumnDef[] = [
  { header: "SKU", key: "sku", width: 15 },
  { header: "Name", key: "name", width: 30 },
  { header: "Description", key: "description", width: 40 },
  { header: "Category", key: "categoryId", width: 15 },
  { header: "Quantity", key: "quantity", width: 10 },
  { header: "Price", key: "price", width: 12 },
  { header: "Cost", key: "cost", width: 12 },
  { header: "Status", key: "status", width: 15 },
  { header: "Low Stock Threshold", key: "lowStockThreshold", width: 20 },
];

export const REPORT_EXPORT_CONFIG: Record<ReportType, ReportExportEntry> = {
  inventory: {
    defaultTitle: "Inventory Report",
    orientation: "portrait",
    pdfWrapCells: true,
    pdfLayout: "generic",
    columns: INVENTORY_COLS,
  },
  categories: {
    defaultTitle: "Categories Report",
    orientation: "portrait",
    pdfWrapCells: true,
    pdfLayout: "generic",
    columns: [
      { header: "ID", key: "id", width: 10 },
      { header: "Name", key: "name", width: 30 },
      { header: "Description", key: "description", width: 50 },
    ],
  },
  suppliers: {
    defaultTitle: "Suppliers Report",
    orientation: "landscape",
    pdfWrapCells: true,
    pdfLayout: "supplier_profile",
    columns: [
      { header: "ID", key: "id", width: 8 },
      { header: "Name", key: "name", width: 22 },
      { header: "Contact", key: "contactName", width: 18 },
      { header: "Email", key: "email", width: 28 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Address", key: "address", width: 36 },
      { header: "Tax ID", key: "taxIdentificationNumber", width: 18 },
      { header: "Bank", key: "bankName", width: 18 },
      { header: "Currency", key: "defaultCurrencyCode", width: 12 },
    ],
  },
  warehouses: {
    defaultTitle: "Warehouses Report",
    orientation: "portrait",
    pdfWrapCells: true,
    pdfLayout: "warehouse_profile",
    columns: [
      { header: "ID", key: "id", width: 10 },
      { header: "Name", key: "name", width: 30 },
      { header: "Location", key: "location", width: 30 },
      { header: "Contact Person", key: "contactPerson", width: 30 },
      { header: "Contact Phone", key: "contactPhone", width: 20 },
      { header: "Address", key: "address", width: 50 },
      { header: "Is Default", key: "isDefault", width: 15 },
    ],
  },
  reorder_requests: {
    defaultTitle: "Reorder Requests Report",
    /** Portrait + wrapped cells: landscape generic tables often feel cramped or mis-scaled in viewers */
    orientation: "portrait",
    pdfWrapCells: true,
    pdfLayout: "generic",
    columns: [
      { header: "ID", key: "id", width: 8 },
      { header: "Request #", key: "requestNumber", width: 18 },
      { header: "Item", key: "itemName", width: 28 },
      { header: "Qty", key: "quantity", width: 8 },
      { header: "Status", key: "status", width: 14 },
      { header: "Requestor", key: "requestorName", width: 22 },
      { header: "Supplier", key: "supplierName", width: 22 },
      { header: "Warehouse", key: "warehouseName", width: 20 },
      { header: "Created", key: "createdAt", width: 18 },
    ],
  },
  purchase_orders: {
    defaultTitle: "Purchase Orders Report",
    orientation: "landscape",
    pdfWrapCells: true,
    pdfLayout: "generic",
    columns: [
      { header: "PO", key: "documentNumber", width: 18 },
      { header: "Supplier", key: "supplierName", width: 24 },
      { header: "Status", key: "status", width: 14 },
      { header: "Currency", key: "currencyCode", width: 10 },
      { header: "Line", key: "lineNumber", width: 7 },
      { header: "Type", key: "lineType", width: 12 },
      { header: "Item / description", key: "lineDescription", width: 32 },
      { header: "Qty", key: "quantity", width: 9 },
      { header: "UOM", key: "uom", width: 9 },
      { header: "Unit price", key: "unitPrice", width: 12 },
      { header: "Tax", key: "taxCode", width: 9 },
      { header: "Line total", key: "lineTotal", width: 13 },
      { header: "Received", key: "receivedQuantity", width: 10 },
    ],
  },
  purchase_requisitions: {
    defaultTitle: "Purchase Requisitions Report",
    orientation: "landscape",
    pdfWrapCells: true,
    pdfLayout: "generic",
    columns: [
      { header: "Requisition", key: "documentNumber", width: 18 },
      { header: "Supplier", key: "supplierName", width: 24 },
      { header: "Status", key: "status", width: 14 },
      { header: "Currency", key: "currencyCode", width: 10 },
      { header: "FX rate", key: "exchangeRate", width: 10 },
      { header: "Line", key: "lineNumber", width: 7 },
      { header: "Type", key: "lineType", width: 12 },
      { header: "Item / description", key: "lineDescription", width: 32 },
      { header: "Qty", key: "quantity", width: 9 },
      { header: "UOM", key: "uom", width: 9 },
      { header: "Unit price", key: "unitPrice", width: 12 },
      { header: "Tax", key: "taxCode", width: 9 },
      { header: "Line total", key: "lineTotal", width: 13 },
    ],
  },
  users: {
    defaultTitle: "Users Report",
    orientation: "landscape",
    pdfWrapCells: true,
    pdfLayout: "generic",
    columns: [
      { header: "ID", key: "id", width: 10 },
      { header: "Username", key: "username", width: 20 },
      { header: "Full Name", key: "fullName", width: 30 },
      { header: "Email", key: "email", width: 30 },
      { header: "Role", key: "role", width: 20 },
      { header: "Active", key: "active", width: 10 },
      { header: "Last Login", key: "lastLogin", width: 20 },
    ],
  },
  stock_movements: {
    defaultTitle: "Stock Movements Report",
    orientation: "landscape",
    pdfWrapCells: true,
    pdfLayout: "generic",
    columns: [
      { header: "ID", key: "id", width: 10 },
      { header: "Date", key: "createdAt", width: 20 },
      { header: "Item", key: "itemName", width: 30 },
      { header: "From Warehouse", key: "fromWarehouseName", width: 25 },
      { header: "To Warehouse", key: "toWarehouseName", width: 25 },
      { header: "Quantity", key: "quantity", width: 15 },
      { header: "Type", key: "movementType", width: 20 },
      { header: "Reference", key: "reference", width: 20 },
      { header: "User", key: "userName", width: 20 },
    ],
  },
  activity_logs: {
    defaultTitle: "Activity Logs Report",
    orientation: "landscape",
    pdfWrapCells: true,
    pdfLayout: "activity_logs",
    columns: [
      { header: "ID", key: "id", width: 10 },
      { header: "Timestamp", key: "timestamp", width: 20 },
      { header: "User", key: "userName", width: 20 },
      { header: "Action", key: "action", width: 20 },
      { header: "Description", key: "description", width: 50 },
      { header: "Reference Type", key: "referenceType", width: 20 },
      { header: "Reference ID", key: "referenceId", width: 15 },
    ],
  },
  invoices: {
    defaultTitle: "Invoices Report",
    orientation: "landscape",
    pdfWrapCells: true,
    pdfLayout: "generic",
    columns: [
      { header: "Invoice #", key: "invoiceNumber", width: 18 },
      { header: "Status", key: "status", width: 12 },
      { header: "Supplier", key: "supplierName", width: 22 },
      { header: "Issue date", key: "issueDate", width: 14 },
      { header: "Due date", key: "dueDate", width: 14 },
      { header: "Subtotal", key: "subtotal", width: 12 },
      { header: "Tax", key: "tax", width: 10 },
      { header: "Total", key: "total", width: 12 },
      { header: "Paid", key: "paidAmount", width: 12 },
      { header: "Due", key: "dueAmount", width: 12 },
      { header: "PO ID", key: "purchaseOrderId", width: 10 },
    ],
  },
  shipments: {
    defaultTitle: "Shipments Report",
    orientation: "landscape",
    pdfWrapCells: true,
    pdfLayout: "generic",
    columns: [
      { header: "ID", key: "id", width: 8 },
      { header: "PO", key: "poNumber", width: 18 },
      { header: "Carrier", key: "carrier", width: 18 },
      { header: "Status", key: "status", width: 14 },
      { header: "ETA", key: "eta", width: 18 },
      { header: "Tracking", key: "trackingNumber", width: 22 },
      { header: "Drift (min)", key: "driftMinutes", width: 12 },
      { header: "Late risk", key: "lateRisk", width: 10 },
      { header: "Updated", key: "updatedAt", width: 18 },
    ],
  },
};

/** Fallback for unknown report types at runtime */
const DEFAULT_ENTRY: ReportExportEntry = {
  defaultTitle: "Report",
  orientation: "portrait",
  pdfWrapCells: true,
  pdfLayout: "generic",
  columns: [
    { header: "ID", key: "id", width: 10 },
    { header: "Name", key: "name", width: 30 },
    { header: "Description", key: "description", width: 50 },
  ],
};

export function getReportExportEntry(reportType: ReportType): ReportExportEntry {
  return REPORT_EXPORT_CONFIG[reportType] ?? DEFAULT_ENTRY;
}

export function getReportColumnsFromConfig(reportType: ReportType): ReportColumnDef[] {
  return getReportExportEntry(reportType).columns;
}

export function defaultFilenameStem(title: string): string {
  return title.replace(/\s+/g, "-").toLowerCase();
}
