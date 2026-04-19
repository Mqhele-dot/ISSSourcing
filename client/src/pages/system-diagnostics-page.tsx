import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchReadinessStatus } from "@/app/app-readiness-banner";
import { requestJson } from "@/lib/queryClient";
import type { SetupStatusPayload } from "@/components/setup/product-onboarding-gate";
import { Button } from "@/components/ui/button";
import { RefreshCw, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ReadinessStatus } from "@/app/app-readiness-banner";

async function fetchSetupStatus(): Promise<SetupStatusPayload> {
  return requestJson<SetupStatusPayload>("GET", "/api/setup/status");
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[420px] overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function SummaryTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-sm text-foreground">{children}</div>
    </div>
  );
}

function formatPathLine(
  label: string,
  row: { path?: string; pathReady?: boolean; writable?: boolean } | undefined,
): ReactNode {
  if (!row) return "—";
  const p = row.path ?? "—";
  const exists = row.pathReady === true ? "exists" : row.pathReady === false ? "missing" : "—";
  const write = row.writable === true ? "writable" : row.writable === false ? "not writable" : "—";
  return (
    <span>
      <span className="font-medium">{label}:</span> {p}
      <span className="text-muted-foreground">
        {" "}
        · {exists} · {write}
      </span>
    </span>
  );
}

export default function SystemDiagnosticsPage() {
  const { toast } = useToast();
  const {
    data: ready,
    isLoading: readyLoading,
    refetch: refetchReady,
    isFetching: readyFetching,
  } = useQuery({
    queryKey: ["/api/ready"],
    queryFn: fetchReadinessStatus,
    staleTime: 10_000,
  });

  const {
    data: setup,
    isLoading: setupLoading,
    refetch: refetchSetup,
    isFetching: setupFetching,
  } = useQuery({
    queryKey: ["/api/setup/status"],
    queryFn: fetchSetupStatus,
    staleTime: 10_000,
  });

  const busy = readyLoading || setupLoading || readyFetching || setupFetching;

  const copyDiagnosticsBundle = async () => {
    const bundle = {
      generatedAt: new Date().toISOString(),
      ready: ready as ReadinessStatus | undefined,
      setup: setup ?? undefined,
    };
    const text = JSON.stringify(bundle, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Diagnostics JSON is on the clipboard." });
    } catch {
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      });
    }
  };

  const deploymentMode = setup?.deploymentMode ?? ready?.build?.deploymentMode ?? ready?.deploymentMode;
  const build = setup?.build ?? ready?.build;
  const checkpoint = setup?.onboarding?.checkpoint;
  const hasCheckpoint =
    checkpoint != null &&
    typeof checkpoint === "object" &&
    (Boolean((checkpoint as { step?: string }).step) ||
      Boolean((checkpoint as { draft?: unknown }).draft));

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <PageHeader
        title="System diagnostics"
        subtitle="Local install health, onboarding, exports path, and build metadata"
        breadcrumb={<span>Admin / Diagnostics</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="default" size="sm" disabled={busy || !ready || !setup} onClick={() => void copyDiagnosticsBundle()}>
              <Copy className="mr-2 h-4 w-4" />
              Copy diagnostics JSON
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                void refetchReady();
                void refetchSetup();
              }}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">Runtime: {ready?.build?.runtimeProfile ?? "—"}</Badge>
        <Badge variant="outline">Deployment: {deploymentMode ?? "—"}</Badge>
        <Badge variant={setup?.onboarding?.required ? "destructive" : "secondary"}>
          Onboarding: {setup?.onboarding?.required ? "required" : "complete"}
        </Badge>
        <Badge variant="outline">DB: {ready?.dbReady ? "ok" : "down"}</Badge>
        <Badge variant="outline">Uploads: {ready?.uploadPathReady ? "ok" : "missing"}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {setup ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <SummaryTile label="Database (authenticated check)">
                {setup.database?.ok === true ? (
                  <span className="text-emerald-700 dark:text-emerald-400">Connected</span>
                ) : setup.database?.ok === false ? (
                  <span className="text-destructive">{setup.database.error ?? "Error"}</span>
                ) : (
                  <span className="text-muted-foreground">Not reported by this payload</span>
                )}
              </SummaryTile>
              <SummaryTile label="Product onboarding">
                <div className="space-y-1">
                  <div>
                    Status:{" "}
                    {setup.onboarding.required ? (
                      <span className="text-amber-800 dark:text-amber-200">Required</span>
                    ) : (
                      <span className="text-emerald-700 dark:text-emerald-400">Complete</span>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    Completed: {setup.onboarding.completedAt ? new Date(setup.onboarding.completedAt).toLocaleString() : "—"}
                  </div>
                  <div className="text-muted-foreground">Saved checkpoint: {hasCheckpoint ? "yes" : "no"}</div>
                </div>
              </SummaryTile>
              <SummaryTile label="Paths">{formatPathLine("Uploads", setup.uploads)}</SummaryTile>
              <SummaryTile label="Exports">{formatPathLine("Exports", setup.exports)}</SummaryTile>
              <SummaryTile label="Last export failure">
                {setup.diagnostics?.lastExportFailure ? (
                  <span>
                    Job #{setup.diagnostics.lastExportFailure.id}: {setup.diagnostics.lastExportFailure.lastError}
                    <span className="block text-xs text-muted-foreground">
                      {new Date(setup.diagnostics.lastExportFailure.updatedAt).toLocaleString()}
                    </span>
                  </span>
                ) : (
                  "None recorded"
                )}
              </SummaryTile>
              <SummaryTile label="Migrations applied (Drizzle)">
                {setup.diagnostics?.drizzleMigrationCount != null
                  ? String(setup.diagnostics.drizzleMigrationCount)
                  : "Unknown"}
              </SummaryTile>
              <SummaryTile label="Build">
                <div className="space-y-1 text-muted-foreground">
                  <div>
                    <span className="text-foreground">Version:</span> {build?.version ?? "—"}
                  </div>
                  <div>
                    <span className="text-foreground">Commit:</span> {build?.commitSha ?? "—"}
                  </div>
                  <div>
                    <span className="text-foreground">Deployment:</span>{" "}
                    {build?.deploymentMode ?? deploymentMode ?? "—"}
                  </div>
                  <div>
                    <span className="text-foreground">Runtime profile:</span> {build?.runtimeProfile ?? "—"}
                  </div>
                </div>
              </SummaryTile>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Load setup status to see the summary.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Authenticated setup status</CardTitle>
        </CardHeader>
        <CardContent>
          {setup ? <JsonBlock value={setup} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Public readiness (/api/ready)</CardTitle>
        </CardHeader>
        <CardContent>
          {ready ? <JsonBlock value={ready} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
        </CardContent>
      </Card>

      {deploymentMode === "packaged" ? (
        <p className="text-xs text-muted-foreground">
          This instance reports <span className="font-medium text-foreground">packaged</span> deployment (local or
          desktop installer). Paths for uploads and exports are resolved relative to the app unless overridden by your
          vendor documentation.
        </p>
      ) : deploymentMode === "hosted" ? (
        <p className="text-xs text-muted-foreground">
          This instance reports <span className="font-medium text-foreground">hosted</span> deployment (server-side
          install). Verify disk permissions on the server for uploads and export directories.
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Use this screen when helping a business IT team verify database connectivity, first-run onboarding, and export
        directories without reading server logs.
      </p>
    </div>
  );
}
