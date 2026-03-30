import type { DocumentType } from "@shared/schema";

export type ReportTab =
  | "inventory"
  | "low-stock"
  | "value"
  | "purchase-orders"
  | "purchase-requisitions"
  | "suppliers"
  | "reorder-requests"
  | "invoices"
  | "shipments";

export function getExportReportType(reportTab: ReportTab): string {
  switch (reportTab) {
    case "purchase-orders":
      return "purchase_orders";
    case "purchase-requisitions":
      return "purchase_requisitions";
    case "reorder-requests":
      return "reorder_requests";
    case "suppliers":
      return "suppliers";
    case "invoices":
      return "invoices";
    case "shipments":
      return "shipments";
    case "inventory":
    case "low-stock":
    case "value":
      return "inventory";
    default:
      return reportTab;
  }
}

export function getReportTitle(reportType: ReportTab): string {
  switch (reportType) {
    case "inventory":
      return "Inventory Report";
    case "low-stock":
      return "Low Stock Items Report";
    case "value":
      return "Inventory Value Report";
    case "purchase-orders":
      return "Purchase Orders Report";
    case "purchase-requisitions":
      return "Purchase Requisitions Report";
    case "suppliers":
      return "Suppliers Report";
    case "reorder-requests":
      return "Reorder Requests Report";
    case "invoices":
      return "Invoices Report";
    case "shipments":
      return "Shipments Report";
    default:
      return "Report";
  }
}

export type PdfTemplateVariant = "standard" | "compact" | "custom";

export type ReportsExportDeps = {
  activeTab: ReportTab;
  exportFormat: DocumentType;
  pdfTemplate: PdfTemplateVariant;
  filter: import("@shared/schema").ReportFilter;
  toast: (props: {
    title: string;
    description?: string;
    variant?: "destructive" | "default";
  }) => void;
};
