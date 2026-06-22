export type ExportDatasetRegistryEntry = {
  key: string;
  label: string;
  section: "inventory" | "procurement" | "finance" | "logistics" | "admin";
  formats: Array<"csv" | "excel" | "pdf" | "docx">;
};

export const EXPORT_DATASET_REGISTRY: ExportDatasetRegistryEntry[] = [
  { key: "inventory", label: "Inventory", section: "inventory", formats: ["csv", "excel", "pdf", "docx"] },
  { key: "suppliers", label: "Suppliers", section: "procurement", formats: ["csv", "excel", "pdf", "docx"] },
  { key: "purchase_orders", label: "Purchase orders", section: "procurement", formats: ["csv", "excel", "pdf", "docx"] },
  { key: "purchase_requisitions", label: "Purchase requisitions", section: "procurement", formats: ["csv", "excel", "pdf", "docx"] },
  { key: "reorder_requests", label: "Reorder requests", section: "inventory", formats: ["csv", "excel", "pdf", "docx"] },
  { key: "invoices", label: "Invoices", section: "finance", formats: ["csv", "excel", "pdf", "docx"] },
  { key: "shipments", label: "Shipments", section: "logistics", formats: ["csv", "excel", "pdf", "docx"] },
  { key: "activity_logs", label: "Activity logs", section: "admin", formats: ["csv", "excel", "pdf", "docx"] },
];

export function getExportDatasetRegistry(): ExportDatasetRegistryEntry[] {
  return EXPORT_DATASET_REGISTRY;
}
