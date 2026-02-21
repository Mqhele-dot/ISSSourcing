import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, Boxes, CheckCircle2, Clock3, PackageCheck, PlayCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataState } from "@/components/ui/data-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import {
  fetchControlTowerOverviewEnvelope,
  fetchReady,
  runDemoWalkthrough,
  startTutorialPrep,
  type ControlTowerOverview,
  type DemoWalkthroughResult,
} from "@/api/client";
import type { FallbackKind } from "@/components/ui/data-state";
import { useTutorial } from "@/contexts/tutorial-context";

export const KPI_DEEP_LINKS = {
  exceptions: "/exceptions?status=open&severity=high",
  logistics: "/logistics?status=in_transit&risk=late",
  purchase: "/purchase?status=approved",
  inventory: "/inventory?low=1",
} as const;

function SystemStatusBadge() {
  const [ready, setReady] = useState<{ dbReady: boolean; schemaReady: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchReady()
      .then((r) => {
        if (!cancelled) setReady(r);
      })
      .catch(() => {
        if (!cancelled) setReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (ready === null) return null;
  const ok = ready.dbReady && ready.schemaReady;
  return (
    <Badge variant={ok ? "default" : "destructive"} className="text-xs">
      System: {ready.dbReady ? "DB ✓" : "DB ✗"} {ready.schemaReady ? "Schema ✓" : "Schema ✗"}
    </Badge>
  );
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

type KpiCardProps = {
  title: string;
  value: string | number;
  href: string;
  icon: ReactNode;
};

function KpiCard({ title, value, href, icon }: KpiCardProps) {
  return (
    <Link href={href}>
      <Card className="cursor-pointer transition-colors hover:bg-accent/40">
        <CardContent className="flex items-center justify-between pt-6">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-3xl font-semibold">{value}</p>
          </div>
          <div className="text-primary">{icon}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function HomePage() {
  const { toast } = useToast();
  const fetcher = useCallback(() => fetchControlTowerOverviewEnvelope(), []);
  const { loading, error, data: envelope, refetch } = useAsyncResource(fetcher);
  const data = envelope?.data ?? null;
  const fallback = envelope?.meta?.fallback as FallbackKind | undefined;
  const {
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    lastRefreshedAt,
    lastRefreshedLabel,
    refreshNow,
    markRefreshed,
  } = useAutoRefresh(refetch);
  const [walkthrough, setWalkthrough] = useState<DemoWalkthroughResult | null>(null);
  const [runningWalkthrough, setRunningWalkthrough] = useState(false);
  const [startingTutorial, setStartingTutorial] = useState(false);
  const { startTutorial } = useTutorial();

  const openExceptions = data?.kpis?.exceptionsBySeverity
    ? Object.values(data.kpis.exceptionsBySeverity).reduce((sum, count) => sum + count, 0)
    : 0;

  useEffect(() => {
    if (data && !lastRefreshedAt) {
      markRefreshed();
    }
  }, [data, lastRefreshedAt, markRefreshed]);

  const handleStartTutorial = async () => {
    setStartingTutorial(true);
    try {
      const { systemStatus } = await startTutorialPrep();
      const isOk = systemStatus === "ok";
      toast({
        title: isOk ? "Demo ready" : "Demo mode",
        description: isOk
          ? "DB connected. Starting the guided tour."
          : "Running in demo mode (degraded). Tour uses demo storage and stubbed operations.",
      });
      const started = startTutorial("full-app");
      if (!started) {
        toast({
          title: "Tour loading",
          description: "Guided tour will be ready in a moment. Click Start Tutorial again.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Tutorial could not start",
        description: err instanceof Error ? err.message : "Check connection and try again.",
        variant: "destructive",
      });
    } finally {
      setStartingTutorial(false);
    }
  };

  const handleRunWalkthrough = async () => {
    setRunningWalkthrough(true);
    try {
      const result = await runDemoWalkthrough();
      setWalkthrough(result);
      await refreshNow();
      toast({
        title: "Demo walkthrough complete",
        description: "Operational demo data has been prepared.",
      });
    } catch (walkthroughError) {
      const msg =
        walkthroughError instanceof Error ? walkthroughError.message : "Failed to run walkthrough";
      const isServiceUnavailable =
        msg.includes("503") ||
        msg.includes("DB_UNAVAILABLE") ||
        msg.includes("DEMO_WALKTHROUGH_TIMEOUT") ||
        msg.includes("Service temporarily unavailable");
      toast({
        title: "Walkthrough failed",
        description: isServiceUnavailable
          ? "Service temporarily unavailable. Please retry in a moment."
          : msg,
        variant: "destructive",
      });
    } finally {
      setRunningWalkthrough(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Control Tower"
        subtitle="Operational command center"
        breadcrumb={<span>Overview / Control Tower</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleStartTutorial}
              disabled={startingTutorial}
              className="gap-2"
            >
              <PlayCircle className="h-4 w-4" />
              Start Tutorial
            </Button>
            <Button
              variant="outline"
              onClick={handleRunWalkthrough}
              disabled={runningWalkthrough}
              className="gap-2"
            >
              Run Demo Walkthrough
            </Button>
            <Button
              variant={autoRefreshEnabled ? "default" : "outline"}
              onClick={() => setAutoRefreshEnabled((current) => !current)}
            >
              Auto-refresh: {autoRefreshEnabled ? "On" : "Off"}
            </Button>
            <Button variant="outline" onClick={refreshNow}>
              Refresh
            </Button>
            <span className="self-center text-xs text-muted-foreground">
              Last refreshed: {lastRefreshedLabel}
            </span>
            <span data-tour="system-status">
              <SystemStatusBadge />
            </span>
          </div>
        }
      />

      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={() => false}
        emptyTitle="No dashboard data available"
        fallback={fallback}
        onRetry={refreshNow}
      >
        {(overview) => (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-tour="dashboard-summary">
              <KpiCard
                title="Open exceptions"
                value={openExceptions}
                href={KPI_DEEP_LINKS.exceptions}
                icon={<AlertTriangle className="h-8 w-8" />}
              />
              <KpiCard
                title="Late shipments"
                value={overview.kpis?.lateShipments ?? 0}
                href={KPI_DEEP_LINKS.logistics}
                icon={<Clock3 className="h-8 w-8" />}
              />
              <KpiCard
                title="POs awaiting action"
                value={overview.kpis?.posAwaitingAction ?? 0}
                href={KPI_DEEP_LINKS.purchase}
                icon={<PackageCheck className="h-8 w-8" />}
              />
              <KpiCard
                title="Low stock SKUs"
                value={overview.kpis?.lowStockSkus ?? 0}
                href={KPI_DEEP_LINKS.inventory}
                icon={<Boxes className="h-8 w-8" />}
              />
            </div>

            {walkthrough ? (
              <Card>
                <CardHeader>
                  <CardTitle>Demo walkthrough checklist</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {walkthrough.steps.map((step) => (
                    <div
                      key={step.id}
                      className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2"
                    >
                      <div>
                        <p className="font-medium">{step.label}</p>
                        {step.details ? (
                          <p className="text-xs text-muted-foreground">{step.details}</p>
                        ) : null}
                      </div>
                      <Badge variant={step.completed ? "default" : "outline"}>
                        {step.completed ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            done
                          </span>
                        ) : (
                          "pending"
                        )}
                      </Badge>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={walkthrough.links.inventory}>View inventory</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={walkthrough.links.purchase}>View purchase</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={walkthrough.links.logistics}>View logistics</Link>
                    </Button>
                    {walkthrough.links.exception ? (
                      <Button asChild size="sm">
                        <Link href={walkthrough.links.exception}>Open exception</Link>
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>Recent activity</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(overview.activity ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent activity events.</p>
                  ) : (
                    (overview.activity ?? []).map((event) => (
                      <div key={event.id} className="rounded-md border border-border p-3">
                        <div className="flex items-center justify-between gap-4">
                          <p className="font-medium">{event.title}</p>
                          <Badge variant="outline">{event.eventType}</Badge>
                        </div>
                        {event.details ? (
                          <p className="mt-1 text-sm text-muted-foreground">{event.details}</p>
                        ) : null}
                        <p className="mt-2 text-xs text-muted-foreground">{formatDate(event.createdAt)}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Exception severity mix</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {Object.entries(overview.kpis?.exceptionsBySeverity ?? {}).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No open exceptions.</p>
                  ) : (
                    Object.entries(overview.kpis?.exceptionsBySeverity ?? {}).map(([severity, count]) => (
                      <Link key={severity} href={`/exceptions?severity=${encodeURIComponent(severity)}&status=open`}>
                        <div className="flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-accent/40">
                          <span className="capitalize">{severity}</span>
                          <Badge variant="outline">{count}</Badge>
                        </div>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </DataState>
    </div>
  );
}
