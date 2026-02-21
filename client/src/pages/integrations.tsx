import { useCallback, useMemo, useState } from "react";
import { Play } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataState } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { fetchIntegrationRunsEnvelope, runIntegration, type IntegrationRun } from "@/api/client";
import type { FallbackKind } from "@/components/ui/data-state";

const CONNECTORS = ["erp", "wms", "tms"] as const;

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

export default function IntegrationsPage() {
  const { toast } = useToast();
  const [runningConnector, setRunningConnector] = useState<string | null>(null);

  const fetcher = useCallback(() => fetchIntegrationRunsEnvelope(), []);
  const { loading, error, data: envelope, refetch } = useAsyncResource(fetcher);
  const data = envelope?.data ?? null;
  const fallback = envelope?.meta?.fallback as FallbackKind | undefined;

  const latestByConnector = useMemo(() => {
    const map = new Map<string, IntegrationRun>();
    for (const run of data ?? []) {
      if (!map.has(run.connector)) {
        map.set(run.connector, run);
      }
    }
    return map;
  }, [data]);

  const runNow = async (connector: string) => {
    setRunningConnector(connector);
    try {
      await runIntegration(connector);
      await refetch();
      toast({
        title: "Connector run completed",
        description: `${connector.toUpperCase()} finished successfully.`,
      });
    } catch (runError) {
      const err = runError as Error & { status?: number };
      const msg =
        err.status === 503
          ? "Service unavailable (operations degraded)"
          : err.status === 408 || (err.message && String(err.message).toLowerCase().includes("timeout"))
            ? "Timed out — DB may be down"
            : err.message || "Request failed";
      toast({
        title: "Connector run failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setRunningConnector(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Integrations"
        subtitle="Connector runtime status and run logs"
        breadcrumb={<span>Operations / Integrations</span>}
        actions={
          <Button variant="outline" onClick={refetch}>
            Refresh
          </Button>
        }
      />

      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={(runs) => (Array.isArray(runs) ? runs : []).length === 0}
        emptyTitle="No integration runs yet"
        fallback={fallback}
        onRetry={refetch}
      >
        {(runs) => {
          const runList = Array.isArray(runs) ? runs : [];
          return (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              {CONNECTORS.map((connector) => {
                const latest = latestByConnector.get(connector);
                return (
                  <Card key={connector}>
                    <CardHeader className="pb-2">
                      <CardTitle className="uppercase">{connector}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Status</span>
                        <StatusBadge status={latest?.status || "not connected"} />
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Last run: {formatDate(latest?.startedAt || null)}
                      </div>
                      <Button
                        onClick={() => runNow(connector)}
                        disabled={runningConnector === connector}
                        className="w-full gap-2"
                      >
                        <Play className="h-4 w-4" />
                        Run now
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Run log</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Connector</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Finished</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runList.slice(0, 20).map((run) => (
                      <TableRow key={run.id}>
                        <TableCell>{run.id}</TableCell>
                        <TableCell className="uppercase">{run.connector}</TableCell>
                        <TableCell>
                          <StatusBadge status={run.status} />
                        </TableCell>
                        <TableCell>{formatDate(run.startedAt)}</TableCell>
                        <TableCell>{formatDate(run.finishedAt)}</TableCell>
                        <TableCell>{run.message || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
          );
        }}
      </DataState>
    </div>
  );
}
