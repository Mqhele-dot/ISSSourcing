import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReadinessStatus, SetupStatusPayload } from "@/lib/setup-readiness-queries";
import { useAppReadinessState } from "@/hooks/use-app-readiness-state";
import { getReadinessClientSnapshot } from "@/lib/readiness-client-snapshot";
import { Button } from "@/components/ui/button";
import { RefreshCw, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
    phase,
    readinessProbeFailed,
    setupProbeFailed,
    isDegraded,
    ready,
    setup,
    readyPending,
    setupPending,
    refetchReadiness,
    retrySetupStatus,
    readinessFetching,
    setupFetching,
  } = useAppReadinessState();

  const busy = readyPending || setupPending || readinessFetching || setupFetching;
  const refetchReady = refetchReadiness;
  const refetchSetup = () => void retrySetupStatus();

  const copyDiagnosticsBundle = async () => {
    const bundle = {
      generatedAt: new Date().toISOString(),
      clientReadiness: getReadinessClientSnapshot(),
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

  const clientSnap = getReadinessClientSnapshot();

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6" data-testid="system-diagnostics-page">
      <PageHeader
        title="System diagnostics"
        titleTestId="page-title"
        subtitle="Local install health, onboarding, exports path, and build metadata"
        breadcrumb={<span>Admin / Diagnostics</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={busy || (!ready && !setup)}
              onClick={() => void copyDiagnosticsBundle()}
            >
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
        <Badge variant="secondary">Client phase: {phase}</Badge>
        {isDegraded ? (
          <Badge variant="outline" className="border-amber-500/60 text-amber-900 dark:text-amber-100">
            Degraded UI (banner / limited checks)
          </Badge>
        ) : null}
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
          <CardTitle className="text-base">This browser — readiness probes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <SummaryTile label="Derived phase">{phase}</SummaryTile>
            <SummaryTile label="Updated (client)">{clientSnap?.updatedAt ?? "—"}</SummaryTile>
            <SummaryTile label="/api/ready observer">
              {readinessProbeFailed ? "Failed (no successful body yet)" : "Ok or not queried"}
            </SummaryTile>
            <SummaryTile label="/api/setup/status observer">
              {setupProbeFailed ? "Failed or empty after fetch" : "Ok or loading"}
            </SummaryTile>
          </div>
          {clientSnap?.lastReadyFailureMessage ? (
            <p className="rounded-md border border-border bg-muted/30 p-2 text-xs">
              <span className="font-medium text-foreground">Last /api/ready error: </span>
              {clientSnap.lastReadyFailureMessage}
            </p>
          ) : null}
          {clientSnap?.lastSetupFailureMessage ? (
            <p className="rounded-md border border-border bg-muted/30 p-2 text-xs">
              <span className="font-medium text-foreground">Last /api/setup/status error: </span>
              {clientSnap.lastSetupFailureMessage}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {setup?.issues && setup.issues.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Server-reported setup issues</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1">critical</code> issues drive{" "}
              <code className="rounded bg-muted px-1">setupStatusHealth: degraded</code>;{" "}
              <code className="rounded bg-muted px-1">warning</code> entries are optional diagnostics only.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {setup.issues.map((issue) => (
                <li key={issue.code}>
                  <span className="mr-2 font-medium text-muted-foreground">
                    [{issue.level ?? "warning"}]
                  </span>
                  <code className="rounded bg-muted px-1 text-xs">{issue.code}</code> — {issue.message}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operator recovery guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="text-foreground font-medium">Setup status fails but pages load:</span> confirm the API
              process is running, <code className="rounded bg-muted px-1 text-xs">DATABASE_URL</code> points at a live
              Postgres instance, and migrations have been applied (
              <span className="text-foreground">Drizzle count</span> in the summary below should be non-zero after a
              fresh install).
            </li>
            <li>
              <span className="text-foreground font-medium">/api/ready shows database or schema down:</span> fix
              connectivity first; without DB, authenticated setup cannot succeed.
            </li>
            <li>
              <span className="text-foreground font-medium">Onboarding stuck on required:</span> finish the product
              wizard or use the documented SQL / skip flags only after you understand the install mode (
              <span className="text-foreground">packaged vs hosted</span>).
            </li>
            <li>
              <span className="text-foreground font-medium">Navigation remains safe when probes fail:</span> the shell
              stays usable for triage; expect some data APIs to fail until the backend is healthy—use this page and the
              JSON export for support handoff.
            </li>
          </ul>
        </CardContent>
      </Card>

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
