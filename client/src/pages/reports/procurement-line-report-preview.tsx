import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import type { ReportFilter } from "@shared/schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { requestJson } from "@/lib/queryClient";
import { serializeProcurementLineReportFilters } from "./procurement-line-report-filters";

type ReportPreview = {
  rows: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  hasNext: boolean;
  resultCount: number;
  generatedAt: string;
};

type Props = {
  dataset: "purchase_orders" | "purchase_requisitions";
  filter: ReportFilter;
  formatMoney: (value: number) => string;
};

function value(row: Record<string, unknown>, key: string): string {
  const raw = row[key];
  return raw == null || raw === "" ? "-" : String(raw);
}

export function ProcurementLineReportPreview({ dataset, filter, formatMoney }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const filters = useMemo(() => serializeProcurementLineReportFilters(filter), [filter]);

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  const preview = useQuery({
    queryKey: ["reports", "line-preview", dataset, filters, page, pageSize],
    queryFn: () =>
      requestJson<ReportPreview>("POST", "/api/reports/preview", {
        dataset,
        page,
        pageSize,
        filters,
      }),
  });

  const noLineRows = (preview.data?.rows ?? []).filter(
    (row) => row.dataQualityStatus === "DOCUMENT_HAS_NO_LINES",
  ).length;

  return (
    <div className="space-y-3" data-testid={`reports-${dataset}-line-preview`}>
      <div className="flex flex-col gap-2 border-b bg-muted/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-medium">Line-level report preview</h3>
          <p className="text-xs text-muted-foreground">
            One row per document line. Header values repeat so downloaded files remain sortable and auditable.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(pageSize)} onValueChange={(next) => setPageSize(Number(next))}>
            <SelectTrigger className="w-28" data-testid={`reports-${dataset}-page-size`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10 rows</SelectItem>
              <SelectItem value="25">25 rows</SelectItem>
              <SelectItem value="50">50 rows</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="icon"
            variant="outline"
            title="Refresh preview"
            onClick={() => void preview.refetch()}
            disabled={preview.isFetching}
            data-testid={`reports-${dataset}-refresh`}
          >
            <RefreshCw className={`h-4 w-4 ${preview.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {noLineRows > 0 ? (
        <Alert data-testid={`reports-${dataset}-data-quality-warning`}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Document lines missing</AlertTitle>
          <AlertDescription>
            {noLineRows} document{noLineRows === 1 ? "" : "s"} on this page have no line records and remain visible
            for data-quality review.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-[1180px] w-full text-sm">
          <thead className="sticky top-0 bg-muted/70">
            <tr>
              {["Document", "Supplier", "Status", "Line", "Type", "Item / description", "Qty", "UOM", "Unit price", "Tax", "Line total", "Cost centre", "GL", "Received"].map(
                (label) => (
                  <th key={label} className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {preview.isLoading ? (
              <tr>
                <td colSpan={14} className="px-3 py-8 text-center text-muted-foreground" data-testid="report-preview-loading">
                  Loading transaction lines...
                </td>
              </tr>
            ) : preview.isError ? (
              <tr>
                <td colSpan={14} className="px-3 py-8 text-center" data-testid="report-preview-error">
                  <p className="font-medium text-destructive">The report preview could not be loaded.</p>
                  <p className="mt-1 text-xs text-muted-foreground">{preview.error.message}</p>
                  <Button className="mt-3" size="sm" variant="outline" onClick={() => void preview.refetch()}>
                    Retry
                  </Button>
                </td>
              </tr>
            ) : preview.data?.rows.length ? (
              preview.data.rows.map((row, index) => (
                <tr
                  key={`${value(row, "documentId")}-${value(row, "lineNumber")}-${index}`}
                  className="border-t align-top"
                  data-testid={`report-line-${value(row, "lineType").toLowerCase()}`}
                >
                  <td className="px-3 py-2 font-medium">{value(row, "documentNumber")}</td>
                  <td className="px-3 py-2">{value(row, "supplierName")}</td>
                  <td className="px-3 py-2">{value(row, "status")}</td>
                  <td className="px-3 py-2">{value(row, "lineNumber")}</td>
                  <td className="px-3 py-2">{value(row, "lineType")}</td>
                  <td className="max-w-72 px-3 py-2">
                    <div className="font-medium">{value(row, "itemCode")}</div>
                    <div className="text-muted-foreground">{value(row, "lineDescription")}</div>
                  </td>
                  <td className="px-3 py-2">{value(row, "quantity")}</td>
                  <td className="px-3 py-2">{value(row, "uom")}</td>
                  <td className="px-3 py-2">{formatMoney(Number(row.unitPrice ?? 0))}</td>
                  <td className="px-3 py-2">{value(row, "taxCode")}</td>
                  <td className="px-3 py-2 font-medium">{formatMoney(Number(row.lineTotal ?? 0))}</td>
                  <td className="px-3 py-2">{value(row, "costCentre")}</td>
                  <td className="px-3 py-2">{value(row, "glAccount")}</td>
                  <td className="px-3 py-2">{value(row, "receivedQuantity")}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={14} className="px-3 py-8 text-center text-muted-foreground" data-testid="report-preview-empty">
                  No transaction lines match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-muted-foreground" data-testid={`reports-${dataset}-page-status`}>
          Page {page} · {preview.data?.resultCount ?? 0} rows
          {preview.data?.generatedAt ? ` · generated ${new Date(preview.data.generatedAt).toLocaleString()}` : ""}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page <= 1 || preview.isFetching}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            data-testid={`reports-${dataset}-previous-page`}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!preview.data?.hasNext || preview.isFetching}
            onClick={() => setPage((current) => current + 1)}
            data-testid={`reports-${dataset}-next-page`}
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
