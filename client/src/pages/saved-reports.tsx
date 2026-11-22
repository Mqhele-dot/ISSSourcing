import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookmarkPlus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { SectionNav } from "@/components/section-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, requestJson } from "@/lib/queryClient";
import { APP_ROUTES } from "@/lib/routes/app-routes";

type ExportDataset = {
  key: string;
  label: string;
  formats: string[];
};

type SavedReport = {
  id: number;
  reportName: string;
  dataset: string;
  defaultFormat: string;
  visibleColumns: string[];
  sourcePage: string | null;
  createdAt: string;
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

export default function SavedReportsPage() {
  const { toast } = useToast();
  const [reportName, setReportName] = useState("");
  const [dataset, setDataset] = useState("");
  const [defaultFormat, setDefaultFormat] = useState("csv");
  const [visibleColumns, setVisibleColumns] = useState("");

  const { data: datasets = [] } = useQuery({
    queryKey: ["/api/export-center/datasets"],
    queryFn: () => requestJson<ExportDataset[]>("GET", "/api/export-center/datasets"),
  });

  const { data: savedReports = [] } = useQuery({
    queryKey: ["/api/export-center/saved-reports"],
    queryFn: () => requestJson<SavedReport[]>("GET", "/api/export-center/saved-reports"),
  });

  const createSavedReport = useMutation({
    mutationFn: () =>
      requestJson("POST", "/api/export-center/saved-reports", {
        reportName,
        dataset,
        defaultFormat,
        filters: {},
        visibleColumns: visibleColumns
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        sourcePage: APP_ROUTES.analytics.reports,
      }),
    onSuccess: async () => {
      setReportName("");
      setVisibleColumns("");
      setDataset("");
      setDefaultFormat("csv");
      await queryClient.invalidateQueries({ queryKey: ["/api/export-center/saved-reports"] });
      toast({ title: "Saved report created" });
    },
    onError: (error) =>
      toast({
        title: "Could not save report",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      }),
  });

  return (
    <PageShell variant="standard">
      <PageHeader
        title="Saved reports"
        subtitle="Base model for reusable report definitions tied to export datasets."
        breadcrumb={<span>Analytics / Saved reports</span>}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href={APP_ROUTES.analytics.reports}>Open reports</Link>
          </Button>
        }
      />

      <SectionNav items={[...ANALYTICS_NAV]} />

      <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookmarkPlus className="h-4 w-4" />
              Create saved report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="saved-report-name">Report name</Label>
              <Input
                id="saved-report-name"
                value={reportName}
                onChange={(event) => setReportName(event.target.value)}
                placeholder="Weekly AP review"
              />
            </div>
            <div className="space-y-2">
              <Label>Dataset</Label>
              <Select value={dataset} onValueChange={setDataset}>
                <SelectTrigger>
                  <SelectValue placeholder="Select export dataset" />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Default format</Label>
              <Select value={defaultFormat} onValueChange={setDefaultFormat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="excel">Excel</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="docx">DOCX</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="saved-report-columns">Visible columns</Label>
              <Input
                id="saved-report-columns"
                value={visibleColumns}
                onChange={(event) => setVisibleColumns(event.target.value)}
                placeholder="invoiceNumber,status,dueAmount"
              />
            </div>
            <Button
              onClick={() => createSavedReport.mutate()}
              disabled={!reportName.trim() || !dataset || createSavedReport.isPending}
            >
              {createSavedReport.isPending ? "Saving..." : "Save report"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saved report library</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {savedReports.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved reports yet.</p>
            ) : (
              savedReports.map((report) => (
                <div key={report.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{report.reportName}</div>
                      <div className="text-xs text-muted-foreground">
                        Dataset: {report.dataset} · Default: {report.defaultFormat.toUpperCase()}
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={APP_ROUTES.analytics.reports}>Open in reports</Link>
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Columns: {report.visibleColumns?.length ? report.visibleColumns.join(", ") : "Default columns"}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
