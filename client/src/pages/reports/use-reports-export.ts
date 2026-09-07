import { useCallback, useRef, useState } from "react";
import type { ReportsExportDeps } from "./reports-types";
import { getExportReportType, getReportTitle } from "./reports-types";
import { requestJson } from "@/lib/queryClient";
import { downloadExportJob } from "@/lib/export-job-download";
import { normalizeProcurementDocumentNumberFilter } from "./procurement-line-report-filters";

type ExportJob = {
  id: number;
  status: "queued" | "running" | "succeeded" | "failed";
  lastError?: string | null;
  error?: { code: string; message: string; hint?: string; requestId?: string | null } | null;
  downloadUrl?: string | null;
};

function exportFailureMessage(job: ExportJob): string {
  if (job.error) {
    const requestReference = job.error.requestId ? ` Request ID: ${job.error.requestId}.` : "";
    return `${job.error.message}${job.error.hint ? ` ${job.error.hint}` : ""}${requestReference}`;
  }
  if (!job.lastError) return "Export job failed. Retry it from Export Center or review System Diagnostics.";
  try {
    const parsed = JSON.parse(job.lastError) as { message?: string; hint?: string; requestId?: string };
    return `${parsed.message ?? "Export job failed."}${parsed.hint ? ` ${parsed.hint}` : ""}${parsed.requestId ? ` Request ID: ${parsed.requestId}.` : ""}`;
  } catch {
    return job.lastError;
  }
}

async function waitForExportJob(jobId: number): Promise<ExportJob> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const job = await requestJson<ExportJob>("GET", `/api/export-jobs/${jobId}`);
    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new Error("Export job timed out. Check Export Center for the latest status.");
}

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
      const filters: Record<string, string> = {};

      if (filter.startDate && filter.endDate) {
        filters.startDate = filter.startDate.toISOString();
        filters.endDate = filter.endDate.toISOString();
      }
      if (filter.categoryId) {
        filters.categoryId = filter.categoryId.toString();
      }
      if (filter.warehouseId) {
        filters.warehouseId = filter.warehouseId.toString();
      }
      if (filter.supplierId) {
        filters.supplierId = filter.supplierId.toString();
      }
      if (filter.projectId) {
        filters.projectId = filter.projectId.toString();
      }
      if (filter.status) {
        filters.status = filter.status;
      }
      if (activeTab === "purchase-orders" || activeTab === "purchase-requisitions") {
        const documentNumber = normalizeProcurementDocumentNumberFilter(filter.documentNumber ?? filter.search);
        if (documentNumber) {
          filters.documentNumber = documentNumber;
        }
      }
      if (activeTab === "shipments") {
        if (filter.shipmentPo?.trim()) {
          filters.po = filter.shipmentPo.trim();
        }
        if (filter.shipmentCarrier?.trim()) {
          filters.carrier = filter.shipmentCarrier.trim();
        }
        if (filter.shipmentRisk?.trim()) {
          filters.risk = filter.shipmentRisk.trim();
        }
      }
      if (activeTab === "low-stock") {
        filters.status = "low_stock";
      }
      if (filter.tags && filter.tags.length > 0) {
        filters.tags = filter.tags.join(",");
      }
      if (exportFormat === "pdf") {
        filters.template = pdfTemplate;
      }
      const queued = await requestJson<ExportJob>("POST", "/api/export-jobs", {
        dataset: getExportReportType(activeTab),
        format: exportFormat,
        filters,
        sourcePage: window.location.pathname,
      });

      const job = await waitForExportJob(queued.id);
      if (job.status !== "succeeded") {
        throw new Error(exportFailureMessage(job));
      }
      const fileExtension = exportFormat === "excel" ? "xlsx" : exportFormat === "csv" ? "csv.gz" : exportFormat;
      const filenameSuffix =
        exportFormat === "pdf"
          ? "report"
          : exportFormat === "docx"
            ? "word-report"
            : exportFormat === "csv"
              ? "raw-data"
              : "analysis";
      await downloadExportJob(job.id, `${activeTab}-${filenameSuffix}.${fileExtension}`);

      toast({
        title: "Export Successful",
        description: `${getReportTitle(activeTab)} has been exported as ${exportFormat === "excel" ? "XLSX" : exportFormat === "docx" ? "DOCX" : exportFormat.toUpperCase()}`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description:
          error instanceof Error
            ? error.message
            : "The export could not be generated. Retry it from Export Center or review System Diagnostics.",
        variant: "destructive",
      });
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  }, [activeTab, exportFormat, filter, pdfTemplate, toast]);

  return { exporting, handleExport, setExporting };
}
