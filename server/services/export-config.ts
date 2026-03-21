/**
 * Central export configuration: columns, PDF orientation, default filenames, metadata hints.
 * Consumed by document-generator-service and export routes.
 */
import type { ReportType } from "@shared/schema";

export type ReportExportOrientation = "portrait" | "landscape";

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
    columns: INVENTORY_COLS,
  },
  categories: {
    defaultTitle: "Categories Report",
    orientation: "portrait",
    pdfWrapCells: true,
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
    orientation: "landscape",
    pdfWrapCells: true,
    columns: [
      { header: "ID", key: "id", width: 10 },
      { header: "Request Number", key: "requestNumber", width: 20 },
      { header: "Item", key: "itemName", width: 30 },
      { header: "Quantity", key: "quantity", width: 15 },
      { header: "Status", key: "status", width: 20 },
      { header: "Requested By", key: "requestorName", width: 30 },
      { header: "Supplier", key: "supplierName", width: 30 },
      { header: "Warehouse", key: "warehouseName", width: 30 },
      { header: "Date Requested", key: "createdAt", width: 20 },
    ],
  },
  purchase_orders: {
    defaultTitle: "Purchase Orders Report",
    orientation: "landscape",
    pdfWrapCells: true,
    columns: [
      { header: "ID", key: "id", width: 10 },
      { header: "Order Number", key: "orderNumber", width: 20 },
      { header: "Supplier", key: "supplierName", width: 30 },
      { header: "Status", key: "status", width: 20 },
      { header: "Order Date", key: "orderDate", width: 20 },
      { header: "Expected Delivery", key: "expectedDeliveryDate", width: 20 },
      { header: "Total Amount", key: "totalAmount", width: 15 },
      { header: "Payment Status", key: "paymentStatus", width: 20 },
    ],
  },
  purchase_requisitions: {
    defaultTitle: "Purchase Requisitions Report",
    orientation: "landscape",
    pdfWrapCells: true,
    columns: [
      { header: "ID", key: "id", width: 10 },
      { header: "Requisition Number", key: "requisitionNumber", width: 20 },
      { header: "Requestor", key: "requestorName", width: 30 },
      { header: "Status", key: "status", width: 20 },
      { header: "Required Date", key: "requiredDate", width: 20 },
      { header: "Supplier", key: "supplierName", width: 30 },
      { header: "Total Amount", key: "totalAmount", width: 15 },
      { header: "Approval Date", key: "approvalDate", width: 20 },
    ],
  },
  users: {
    defaultTitle: "Users Report",
    orientation: "landscape",
    pdfWrapCells: true,
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
};

/** Fallback for unknown report types at runtime */
const DEFAULT_ENTRY: ReportExportEntry = {
  defaultTitle: "Report",
  orientation: "portrait",
  pdfWrapCells: true,
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
