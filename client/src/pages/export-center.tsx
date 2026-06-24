import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, RotateCcw, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { SectionNav } from "@/components/section-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { requestJson } from "@/lib/queryClient";
import { useProductSetupComplete } from "@/hooks/use-product-setup-complete";
import { PanelInlineError } from "@/components/panel-inline-error";
import { useToast } from "@/hooks/use-toast";

type ExportHistoryRow = {
  id: number;
  dataset: string;
  format: string;
  status: string;
  fileName: string | null;
  fileSize: number | null;
  sourcePage: string | null;
  createdBy: string | null;
  createdAt: string;
  downloadUrl: string | null;
  canRetry: boolean;
  lastError?: string | null;
};

type ExportDataset = {
  key: string;
  label: string;
  section: string;
  formats: string[];
  previewable?: boolean;
  columns: Array<{ key: string; label: string; type?: string }>;
  joinHints?: string[];
};

type CustomPreview = {
  dataset: string;
  label: string;
  columns: Array<{ key: string; label: string; type?: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  previewLimit: number;
};

const ANALYTICS_NAV = [
  { label: "Overview", href: APP_ROUTES.analytics.overview },
  { label: "Inventory", href: APP_ROUTES.analytics.inventory },
  { label: "Procurement", href: APP_ROUTES.analytics.procurement },
  { label: "Finance", href: APP_ROUTES.analytics.finance },
  { label: "Logistics", href: APP_ROUTES.analytics.logistics },
  { label: "Reports", href: APP_ROUTES.analytics.reports },
  { label: "Saved reports", href: APP_ROUTES.analytics.savedReports },
  { label: "Export center", href: APP_ROUTES.analytics.exportCenter },
] as const;

const REPORT_TEMPLATES = [
  {
    name: "PO vs deliveries",
    description: "Compare ordered value and receipt progress by supplier and purchase order.",
    dataset: "po_delivery_comparison",
    columns: ["poNumber", "supplierName", "poStatus", "shipmentStatus", "eta", "trackingNumber", "deliveryGap"],
  },
  {
    name: "Delivery export",
    description: "Shipment and delivery list for logistics review.",
    dataset: "shipments",
    columns: ["poNumber", "carrier", "status", "eta", "trackingNumber", "lateRisk"],
  },
  {
    name: "Supplier currency audit",
    description: "Supplier defaults for currency, terms, and operational setup.",
    dataset: "suppliers",
    columns: ["name", "email", "phone", "defaultCurrencyCode", "status"],
  },
] as const;

function formatBytes(value: number | null): string {
  if (!value || value <= 0) return "Unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ExportCenterPage() {
  const { toast } = useToast();
  const productSetupComplete = useProductSetupComplete();
  const queryClient = useQueryClient();
  const [customDataset, setCustomDataset] = useState("po_delivery_comparison");
  const [customColumns, setCustomColumns] = useState("");
  const [customReportName, setCustomReportName] = useState("PO delivery comparison");
  const [customPreview, setCustomPreview] = useState<CustomPreview | null>(null);

  const datasetsQuery = useQuery({
    queryKey: ["/api/export-center/datasets"],
    queryFn: () => requestJson<ExportDataset[]>("GET", "/api/export-center/datasets"),
    throwOnError: false,
  });
  const datasets = datasetsQuery.data ?? [];
  const selectedDataset = datasets.find((dataset) => dataset.key === customDataset);
  const selectedColumnKeys =
    customColumns
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);

  const historyQuery = useQuery({
    queryKey: ["/api/export-center/history"],
    queryFn: () => requestJson<ExportHistoryRow[]>("GET", "/api/export-center/history"),
    throwOnError: false,
  });
  const history = historyQuery.data ?? [];
  const retryMutation = useMutation({
    mutationFn: (id: number) => requestJson("POST", `/api/export-jobs/${id}/retry`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/export-center/history"] }),
  });
  const previewMutation = useMutation({
    mutationFn: () =>
      requestJson<CustomPreview>("POST", "/api/export-center/custom-preview", {
        dataset: customDataset,
        columns: selectedColumnKeys,
        limit: 25,
      }),
    onSuccess: (data) => setCustomPreview(data),
    onError: (error) =>
      toast({
        title: "Preview failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      }),
  });
  const exportCustomMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/export-center/custom-export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportName: customReportName,
          dataset: customDataset,
          columns: selectedColumnKeys,
          format: "csv",
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `${customReportName.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "custom-report"}.csv.gz`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    },
    onSuccess: () => toast({ title: "Compressed export downloaded", description: "The custom report was saved as CSV.GZ." }),
    onError: (error) =>
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      }),
  });

  return (
    <PageShell variant="wide-table" data-testid="export-center-page">
      <PageHeader
        title="Export center"
        subtitle="Shared export history for recent files, retries, and download links."
        breadcrumb={<span>Analytics / Export center</span>}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href={APP_ROUTES.analytics.savedReports}>Saved reports</Link>
          </Button>
        }
      />

      <SectionNav items={[...ANALYTICS_NAV]} />

      {historyQuery.isError ? (
        <PanelInlineError
          title="Could not load export history"
          description={
            historyQuery.error instanceof Error
              ? historyQuery.error.message
              : "The export center API did not respond. Retry or check diagnostics."
          }
          onRetry={() => void historyQuery.refetch()}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Custom report builder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {REPORT_TEMPLATES.map((template) => (
              <button
                key={template.name}
                type="button"
                className="rounded-md border bg-background p-3 text-left transition hover:border-primary hover:bg-primary/5"
                onClick={() => {
                  setCustomDataset(template.dataset);
                  setCustomColumns(template.columns.join(","));
                  setCustomReportName(template.name);
                  setCustomPreview(null);
                }}
              >
                <div className="flex items-center gap-2 font-medium">
                  <Wand2 className="h-4 w-4 text-primary" />
                  {template.name}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-[1.1fr_1.4fr_1fr_auto_auto] md:items-end">
            <div className="space-y-2">
              <Label>Dataset</Label>
              <Select
                value={customDataset}
                onValueChange={(value) => {
                  setCustomDataset(value);
                  setCustomColumns("");
                  setCustomPreview(null);
                }}
              >
                <SelectTrigger data-testid="custom-report-dataset">
                  <SelectValue placeholder="Select dataset" />
                </SelectTrigger>
                <SelectContent>
                  {datasets.filter((dataset) => dataset.previewable).map((dataset) => (
                    <SelectItem key={dataset.key} value={dataset.key}>
                      {dataset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-report-columns">Columns</Label>
              <Input
                id="custom-report-columns"
                value={customColumns}
                onChange={(event) => setCustomColumns(event.target.value)}
                placeholder={selectedDataset?.columns.map((column) => column.key).join(",") || "Default columns"}
                data-testid="custom-report-columns"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-report-name">Export name</Label>
              <Input
                id="custom-report-name"
                value={customReportName}
                onChange={(event) => setCustomReportName(event.target.value)}
                data-testid="custom-report-name"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => previewMutation.mutate()}
              disabled={!customDataset || previewMutation.isPending}
              data-testid="custom-report-preview"
            >
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </Button>
            <Button
              type="button"
              onClick={() => exportCustomMutation.mutate()}
              disabled={!customDataset || exportCustomMutation.isPending}
              data-testid="custom-report-export"
            >
              <Download className="mr-2 h-4 w-4" />
              Export .gz
            </Button>
          </div>
          {selectedDataset ? (
            <div className="text-xs text-muted-foreground">
              Available columns: {selectedDataset.columns.map((column) => `${column.key} (${column.label})`).join(", ")}
              {selectedDataset.joinHints?.length ? ` - Connects with: ${selectedDataset.joinHints.join(", ")}` : ""}
            </div>
          ) : datasetsQuery.isError ? (
            <PanelInlineError
              title="Could not load report datasets"
              description={datasetsQuery.error instanceof Error ? datasetsQuery.error.message : "Dataset registry failed to load."}
              onRetry={() => void datasetsQuery.refetch()}
            />
          ) : null}
          {customPreview ? (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[48rem] text-sm">
                <thead className="bg-muted/60 text-left">
                  <tr>
                    {customPreview.columns.map((column) => (
                      <th key={column.key} className="px-3 py-2 font-medium">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customPreview.rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-muted-foreground" colSpan={customPreview.columns.length}>
                        No preview rows returned.
                      </td>
                    </tr>
                  ) : (
                    customPreview.rows.map((row, index) => (
                      <tr key={index} className="border-t">
                        {customPreview.columns.map((column) => (
                          <td key={column.key} className="px-3 py-2">
                            {String(row[column.key] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent exports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">No exports have been generated yet.</p>
              {productSetupComplete ? (
                <Button asChild size="sm" variant="default">
                  <Link href={APP_ROUTES.analytics.savedReports}>Open saved reports</Link>
                </Button>
              ) : (
                <Button asChild size="sm" variant="outline">
                  <Link href={APP_ROUTES.setup.product}>Continue product setup</Link>
                </Button>
              )}
            </div>
          ) : (
            history.map((row) => (
              <div key={row.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-medium">
                      {row.dataset} · {row.format.toUpperCase()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Status: {row.status} · Created by: {row.createdBy || "Unknown"} · File size: {formatBytes(row.fileSize)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Source: {row.sourcePage || "Unknown"} · {new Date(row.createdAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      File: {row.fileName || "Generated on demand"}
                    </div>
                    {row.lastError ? (
                      <div className="text-xs text-destructive">Last error: {row.lastError}</div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {row.downloadUrl ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={row.downloadUrl}>
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </a>
                      </Button>
                    ) : null}
                    {row.canRetry ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => retryMutation.mutate(row.id)}
                        disabled={retryMutation.isPending}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Retry
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
