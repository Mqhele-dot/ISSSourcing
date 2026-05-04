import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { SectionNav } from "@/components/section-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { requestJson } from "@/lib/queryClient";
import { useProductSetupComplete } from "@/hooks/use-product-setup-complete";
import { PanelInlineError } from "@/components/panel-inline-error";

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

function formatBytes(value: number | null): string {
  if (!value || value <= 0) return "Unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ExportCenterPage() {
  const productSetupComplete = useProductSetupComplete();
  const queryClient = useQueryClient();
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
