import { useCallback, useRef, useState } from "react";
import { downloadFile } from "@/lib/utils";
import type { ReportsExportDeps } from "./reports-types";
import { getExportReportType, getReportTitle } from "./reports-types";

export function useReportsExport({
  activeTab,
  exportFormat,
  pdfTemplate,
  filter,
  toast,
}: ReportsExportDeps) {
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);

  const handleExport = useCallback(async () => {
    if (exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    try {
      let url = `/api/export/${getExportReportType(activeTab)}/${exportFormat}`;
      const queryParams = new URLSearchParams();

      if (filter.startDate && filter.endDate) {
        queryParams.append("startDate", filter.startDate.toISOString());
        queryParams.append("endDate", filter.endDate.toISOString());
      }
      if (filter.categoryId) {
        queryParams.append("categoryId", filter.categoryId.toString());
      }
      if (filter.warehouseId) {
        queryParams.append("warehouseId", filter.warehouseId.toString());
      }
      if (filter.supplierId) {
        queryParams.append("supplierId", filter.supplierId.toString());
      }
      if (filter.projectId) {
        queryParams.append("projectId", filter.projectId.toString());
      }
      if (filter.status) {
        queryParams.append("status", filter.status);
      }
      if (activeTab === "shipments") {
        if (filter.shipmentPo?.trim()) {
          queryParams.append("po", filter.shipmentPo.trim());
        }
        if (filter.shipmentCarrier?.trim()) {
          queryParams.append("carrier", filter.shipmentCarrier.trim());
        }
        if (filter.shipmentRisk?.trim()) {
          queryParams.append("risk", filter.shipmentRisk.trim());
        }
      }
      if (activeTab === "low-stock") {
        queryParams.set("status", "low_stock");
      }
      if (filter.tags && filter.tags.length > 0) {
        queryParams.append("tags", filter.tags.join(","));
      }
      if (exportFormat === "pdf") {
        queryParams.set("template", pdfTemplate);
      }
      if (queryParams.toString()) {
        url += `?${queryParams.toString()}`;
      }

      const response = await fetch(url, { credentials: "include" });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok) {
        let detail = `Export failed (${response.status})`;
        try {
          const errBody = (await response.json()) as {
            message?: string;
            error?: { message?: string };
          };
          if (errBody?.error?.message) detail = errBody.error.message;
          else if (errBody?.message) detail = errBody.message;
        } catch {
          /* not JSON */
        }
        if (response.status === 401) {
          detail = "Not signed in or session expired — log in again, then retry the export.";
        }
        throw new Error(detail);
      }
      if (exportFormat === "pdf" && contentType.includes("application/json")) {
        throw new Error(
          "Server returned JSON instead of a PDF (usually a session/auth issue). Log in again and retry.",
        );
      }
      const blob = await response.blob();
      const fileExtension = exportFormat === "excel" ? "xlsx" : exportFormat;
      const filenameSuffix =
        exportFormat === "pdf"
          ? "report"
          : exportFormat === "docx"
            ? "word-report"
            : exportFormat === "csv"
              ? "raw-data"
              : "analysis";
      downloadFile(blob, `${activeTab}-${filenameSuffix}.${fileExtension}`);

      toast({
        title: "Export Successful",
        description: `${getReportTitle(activeTab)} has been exported as ${exportFormat === "excel" ? "XLSX" : exportFormat === "docx" ? "DOCX" : exportFormat.toUpperCase()}`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export report",
        variant: "destructive",
      });
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  }, [activeTab, exportFormat, filter, pdfTemplate, toast]);

  return { exporting, handleExport, setExporting };
}
