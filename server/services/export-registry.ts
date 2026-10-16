export type ExportDatasetRegistryEntry = {
  key: string;
  label: string;
  section: "inventory" | "procurement" | "finance" | "logistics" | "admin";
  formats: Array<"csv" | "excel" | "pdf" | "docx">;
  columns: Array<{ key: string; label: string; type?: "text" | "number" | "date" | "money" | "status" }>;
  joinHints?: string[];
  previewable?: boolean;
};

export const EXPORT_DATASET_REGISTRY: ExportDatasetRegistryEntry[] = [
  {
    key: "inventory",
    label: "Inventory",
    section: "inventory",
    formats: ["csv", "excel", "pdf", "docx"],
    previewable: true,
    columns: [
      { key: "sku", label: "SKU", type: "text" },
      { key: "name", label: "Item", type: "text" },
      { key: "categoryName", label: "Category", type: "text" },
      { key: "quantity", label: "On hand", type: "number" },
      { key: "price", label: "Price", type: "money" },
      { key: "location", label: "Location", type: "text" },
      { key: "status", label: "Status", type: "status" },
    ],
  },
  {
    key: "suppliers",
    label: "Suppliers",
    section: "procurement",
    formats: ["csv", "excel", "pdf", "docx"],
    previewable: true,
    columns: [
      { key: "name", label: "Supplier", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "defaultCurrencyCode", label: "Currency", type: "text" },
      { key: "status", label: "Status", type: "status" },
    ],
  },
  {
    key: "purchase_orders",
    label: "Purchase orders",
    section: "procurement",
    formats: ["csv", "excel", "pdf", "docx"],
    previewable: true,
    joinHints: ["suppliers", "shipments", "invoices", "receipts"],
    columns: [
      { key: "documentNumber", label: "PO", type: "text" },
      { key: "supplierName", label: "Supplier", type: "text" },
      { key: "status", label: "Status", type: "status" },
      { key: "currencyCode", label: "Currency", type: "text" },
      { key: "documentTotal", label: "Document total", type: "money" },
      { key: "lineNumber", label: "Line", type: "number" },
      { key: "lineType", label: "Line type", type: "status" },
      { key: "itemCode", label: "Item code", type: "text" },
      { key: "lineDescription", label: "Description", type: "text" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "uom", label: "UOM", type: "text" },
      { key: "unitPrice", label: "Unit price", type: "money" },
      { key: "taxCode", label: "Tax", type: "text" },
      { key: "lineTotal", label: "Line total", type: "money" },
      { key: "receivedQuantity", label: "Received", type: "number" },
    ],
  },
  {
    key: "purchase_requisitions",
    label: "Purchase requisitions",
    section: "procurement",
    formats: ["csv", "excel", "pdf", "docx"],
    previewable: true,
    columns: [
      { key: "documentNumber", label: "Requisition", type: "text" },
      { key: "supplierName", label: "Supplier", type: "text" },
      { key: "status", label: "Status", type: "status" },
      { key: "documentTotal", label: "Document total", type: "money" },
      { key: "requiredDate", label: "Required date", type: "date" },
      { key: "lineNumber", label: "Line", type: "number" },
      { key: "lineType", label: "Line type", type: "status" },
      { key: "itemCode", label: "Item code", type: "text" },
      { key: "lineDescription", label: "Description", type: "text" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "uom", label: "UOM", type: "text" },
      { key: "unitPrice", label: "Unit price", type: "money" },
      { key: "taxCode", label: "Tax", type: "text" },
      { key: "lineTotal", label: "Line total", type: "money" },
    ],
  },
  {
    key: "reorder_requests",
    label: "Reorder requests",
    section: "inventory",
    formats: ["csv", "excel", "pdf", "docx"],
    previewable: true,
    columns: [
      { key: "itemName", label: "Item", type: "text" },
      { key: "status", label: "Status", type: "status" },
      { key: "requestedQuantity", label: "Requested qty", type: "number" },
      { key: "supplierName", label: "Supplier", type: "text" },
      { key: "warehouseName", label: "Warehouse", type: "text" },
    ],
  },
  {
    key: "invoices",
    label: "Invoices",
    section: "finance",
    formats: ["csv", "excel", "pdf", "docx"],
    previewable: true,
    joinHints: ["suppliers", "purchase_orders", "payments"],
    columns: [
      { key: "invoiceNumber", label: "Invoice", type: "text" },
      { key: "supplierName", label: "Supplier", type: "text" },
      { key: "status", label: "Status", type: "status" },
      { key: "total", label: "Total", type: "money" },
      { key: "dueAmount", label: "Due", type: "money" },
      { key: "dueDate", label: "Due date", type: "date" },
    ],
  },
  {
    key: "shipments",
    label: "Shipments",
    section: "logistics",
    formats: ["csv", "excel", "pdf", "docx"],
    previewable: true,
    joinHints: ["purchase_orders", "suppliers", "carriers"],
    columns: [
      { key: "poNumber", label: "PO", type: "text" },
      { key: "carrier", label: "Carrier", type: "text" },
      { key: "status", label: "Status", type: "status" },
      { key: "eta", label: "ETA", type: "date" },
      { key: "trackingNumber", label: "Tracking", type: "text" },
      { key: "lateRisk", label: "Late risk", type: "status" },
    ],
  },
  {
    key: "po_delivery_comparison",
    label: "PO vs deliveries",
    section: "logistics",
    formats: ["csv"],
    previewable: true,
    joinHints: ["purchase_orders", "shipments", "suppliers"],
    columns: [
      { key: "poNumber", label: "PO", type: "text" },
      { key: "supplierName", label: "Supplier", type: "text" },
      { key: "poStatus", label: "PO status", type: "status" },
      { key: "shipmentStatus", label: "Delivery status", type: "status" },
      { key: "eta", label: "ETA", type: "date" },
      { key: "trackingNumber", label: "Tracking", type: "text" },
      { key: "deliveryGap", label: "Delivery gap", type: "text" },
    ],
  },
  {
    key: "activity_logs",
    label: "Activity logs",
    section: "admin",
    formats: ["csv", "excel", "pdf", "docx"],
    previewable: true,
    columns: [
      { key: "action", label: "Action", type: "text" },
      { key: "description", label: "Description", type: "text" },
      { key: "userName", label: "User", type: "text" },
      { key: "timestamp", label: "Timestamp", type: "date" },
    ],
  },
];

export function getExportDatasetRegistry(): ExportDatasetRegistryEntry[] {
  return EXPORT_DATASET_REGISTRY;
}
