import type { ReportFilter } from "@shared/schema";

export function normalizeProcurementDocumentNumberFilter(value: string | null | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : undefined;
}

export function serializeProcurementLineReportFilters(filter: ReportFilter): Record<string, unknown> {
  return {
    documentNumber: normalizeProcurementDocumentNumberFilter(filter.documentNumber ?? filter.search),
    supplierId: filter.supplierId,
    projectId: filter.projectId,
    status: filter.status,
    startDate: filter.startDate?.toISOString(),
    endDate: filter.endDate?.toISOString(),
  };
}
