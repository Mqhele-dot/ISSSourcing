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
