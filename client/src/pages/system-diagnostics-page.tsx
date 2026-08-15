import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReadinessStatus, SetupStatusPayload } from "@/lib/setup-readiness-queries";
import { useAppReadinessState } from "@/hooks/use-app-readiness-state";
import { getReadinessClientSnapshot } from "@/lib/readiness-client-snapshot";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Copy, Download, ExternalLink, PlayCircle, ShieldCheck, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ModuleTrainingPanel } from "@/components/training/module-training-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  fetchDiagnosticsScan,
  fetchDiagnosticsSnapshot,
  fixDiagnostics,
  type DiagnosticsScanResult,
  type DiagnosticsSnapshotResult,
} from "@/api/client";
import {
  addDiagnosticEvent,
  clearDiagnosticEvents,
  getDiagnosticEvents,
  markDiagnosticResolved,
  subscribeToDiagnostics,
  type DiagnosticEvent,
  type DiagnosticSeverity,
} from "@/lib/diagnostics/diagnostics-store";
import {
  copyDiagnosticsSummary,
  downloadDiagnosticsJson,
  downloadDiagnosticsMarkdown,
type DiagnosticsReportContext,
} from "@/lib/diagnostics/diagnostics-report";
import { runDiagnosticsSelfChecks } from "@shared/diagnostics/self-checks";
import {
  diagnosticCategories,
  type DiagnosticCategory,
  type DiagnosticFinding,
  type DiagnosticsSummary,
} from "@shared/diagnostics/findings";
import { requestJson } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";

type ScanCategory = keyof DiagnosticsScanResult;

const DIAGNOSTIC_WORKSPACES: Record<DiagnosticCategory, { label: string; description: string }> = {
  overview: { label: "Overview", description: "Readiness, observed failures, safe probes, and affected modules." },
  "user-errors": { label: "User-Visible Errors", description: "Failed actions and structured validation that users actually encountered." },
  frontend: { label: "Frontend", description: "React, route, browser network, and slow-request evidence from this browser." },
  backend: { label: "Backend", description: "Readiness, server exceptions, failed routes, database, schema, and job evidence." },
  business: { label: "Business Rules", description: "Approval conflicts and controlled workflow or master-data failures." },
  integrations: { label: "Integrations", description: "Export, email, billing, WebSocket, and externally configured service evidence." },
  consistency: { label: "Data Consistency", description: "Fixture pollution and orphan, dependency, currency, tax, or GL risks." },
  notifications: { label: "Notifications", description: "Unread backlog, duplicate-event symptoms, delivery, and retention evidence." },
  security: { label: "Security", description: "Recorded runtime security evidence and explicit release-gate verification gaps." },
  audit: { label: "Audit Timeline", description: "Tenant-scoped audit coverage and recent activity evidence." },
};

function diagnosticsWorkspaceFromUrl(): DiagnosticCategory {
  if (typeof window === "undefined") return "overview";
  const value = new URLSearchParams(window.location.search).get("view") as DiagnosticCategory | null;
  return value && diagnosticCategories.includes(value) ? value : "overview";
}

function statusLabel(status: DiagnosticFinding["status"]): string {
  return status.replaceAll("_", " ");
}

function findingTargetRoute(finding: DiagnosticFinding): string | null {
  if (finding.targetRoute?.startsWith("/")) return finding.targetRoute;
  if (finding.affectedRoute?.startsWith("/") && !finding.affectedRoute.startsWith("/api/")) return finding.affectedRoute;
  const fallback: Partial<Record<DiagnosticCategory, string>> = {
    frontend: "/admin/system-diagnostics?view=frontend",
    backend: "/admin/system-diagnostics?view=backend",
    "user-errors": "/admin/system-diagnostics?view=user-errors",
    business: "/operations/exceptions",
    integrations: "/admin/integrations",
    consistency: "/admin/master-data",
    notifications: "/admin/system-diagnostics?view=notifications",
    security: "/admin/settings/security",
    audit: "/admin/audit-logs",
  };
  return fallback[finding.category] ?? null;
}

function DiagnosticsWorkspacePanel({
  category,
  findings,
  localEvents,
  loading,
  error,
  probing,
  onRunProbes,
  onRetry,
}: {
  category: DiagnosticCategory;
  findings: DiagnosticFinding[];
  localEvents: DiagnosticEvent[];
  loading: boolean;
  error: string | null;
  probing: boolean;
  onRunProbes: () => void;
  onRetry: () => void;
}) {
  const workspace = DIAGNOSTIC_WORKSPACES[category];
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [evidenceFilter, setEvidenceFilter] = useState("current");
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const visibleFindings = findings.filter(
    (finding) =>
      (severityFilter === "all" || finding.severity === severityFilter) &&
      (statusFilter === "all" || finding.status === statusFilter) &&
      (evidenceFilter === "all" || finding.evidenceState === evidenceFilter),
  );
  return (
    <Card data-testid={`diagnostics-workspace-${category}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{workspace.label}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{workspace.description}</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={probing} onClick={onRunProbes} data-testid={`diagnostics-run-probes-${category}`}>
          <RefreshCw className={`mr-2 h-4 w-4 ${probing ? "animate-spin" : ""}`} />
          Run safe probes
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {selectedFindingIds.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3">
            <span className="text-sm">{selectedFindingIds.length} issue(s) selected</span>
            <Button type="button" size="sm" onClick={() => {
              const selected = visibleFindings.find((finding) => selectedFindingIds.includes(finding.id));
              const target = selected ? findingTargetRoute(selected) : null;
              if (target?.startsWith("/")) window.location.assign(target);
            }} disabled={!visibleFindings.some((finding) => selectedFindingIds.includes(finding.id) && Boolean(findingTargetRoute(finding)))}>
              Open selected problem
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2" data-testid={`diagnostics-filters-${category}`}>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-40" data-testid={`diagnostics-severity-filter-${category}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Information</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" data-testid={`diagnostics-status-filter-${category}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All evidence states</SelectItem>
              <SelectItem value="working">Working</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="degraded">Degraded</SelectItem>
              <SelectItem value="disabled_by_configuration">Disabled by configuration</SelectItem>
              <SelectItem value="not_exercised">Not exercised</SelectItem>
              <SelectItem value="not_applicable">Not applicable</SelectItem>
            </SelectContent>
          </Select>
          <Select value={evidenceFilter} onValueChange={setEvidenceFilter}>
            <SelectTrigger className="w-48" data-testid={`diagnostics-evidence-filter-${category}`}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="current">Current findings</SelectItem><SelectItem value="expected_configuration">Expected configuration</SelectItem><SelectItem value="historical">History</SelectItem><SelectItem value="all">All evidence</SelectItem></SelectContent>
          </Select>
          <span className="self-center text-xs text-muted-foreground" data-testid={`diagnostics-visible-count-${category}`}>
            {visibleFindings.length} of {findings.length} findings
          </span>
        </div>
        {loading ? <p className="text-sm text-muted-foreground" data-testid={`diagnostics-loading-${category}`}>Loading observed evidence...</p> : null}
        {error ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid={`diagnostics-error-${category}`}>
            <span>{error}</span>
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button>
          </div>
        ) : null}
        {!loading && !error && visibleFindings.length === 0 && localEvents.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid={`diagnostics-empty-${category}`}>
            No evidence has been recorded for this workspace. This means not exercised, not automatically healthy.
          </div>
        ) : null}
        {visibleFindings.map((row) => (
          <div key={row.id} className="rounded-md border p-3" data-testid={`diagnostic-finding-${row.code}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox
                checked={selectedFindingIds.includes(row.id)}
                onCheckedChange={(checked) => setSelectedFindingIds((current) => checked ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id))}
                aria-label={`Select ${row.title}`}
              />
              <Badge variant={row.severity === "critical" || row.severity === "error" ? "destructive" : "outline"}>{row.severity}</Badge>
              <Badge variant="secondary" className="capitalize">{statusLabel(row.status)}</Badge>
              <Badge variant="outline" className="capitalize">{row.evidenceState.replaceAll("_", " ")}</Badge>
              <span className="font-medium">{row.title}</span>
              {row.occurrences > 1 ? <span className="text-xs text-muted-foreground">{row.occurrences} occurrences</span> : null}
              <span className="text-xs text-muted-foreground">Last seen {new Date(row.lastSeen).toLocaleString()}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{row.message}</p>
            {row.affectedRoute || row.affectedAction ? <p className="mt-1 text-xs text-muted-foreground">{row.affectedAction ?? "Action"} {row.affectedRoute ?? ""}</p> : null}
            {row.requestId ? <p className="mt-1 text-xs text-muted-foreground">Request ID: {row.requestId}</p> : null}
            {row.remediation ? <p className="mt-2 text-sm"><span className="font-medium">Next step:</span> {row.remediation}</p> : null}
            {findingTargetRoute(row) ? (
              <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => {
                const target = findingTargetRoute(row);
                if (target?.startsWith("/")) window.location.assign(target);
              }}>
                <ExternalLink className="mr-2 h-4 w-4" /> Open problem tab
              </Button>
            ) : null}
          </div>
        ))}
        {localEvents.map((event) => (
          <div key={`client-${event.id}`} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={event.severity === "critical" || event.severity === "error" ? "destructive" : "outline"}>{event.severity}</Badge>
              <Badge variant="secondary">observed in browser</Badge>
              <span className="font-medium">{event.title}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{event.message}</p>
            <p className="mt-1 text-xs text-muted-foreground">{event.method ?? ""} {event.endpoint ?? event.route ?? ""}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type DiagnosticsGuidance = {
  title: string;
  description: string;
  automatic: string[];
  manual: string[];
  links: Array<{ label: string; href: string }>;
};

const DIAGNOSTICS_GUIDANCE: Record<ScanCategory, DiagnosticsGuidance> = {
  database: {
    title: "Database repair guidance",
    description: "Checks the app settings record and core inventory indexes used by the live inventory screens.",
    automatic: ["Initialize missing app settings.", "Create safe inventory indexes when PostgreSQL allows it."],
    manual: ["If this still reports issues, confirm the database connection settings and run the migration/check scripts in Codespaces."],
    links: [
      { label: "Open setup", href: "/admin/settings" },
      { label: "Open diagnostics", href: "/admin/system-diagnostics" },
    ],
  },
  configuration: {
    title: "Configuration guidance",
    description: "Shows hosted-service settings that cannot be safely invented by the app.",
    automatic: ["Records the guidance result so the issue is visible in diagnostics history."],
    manual: [
      "Set Stripe and email environment variables in the hosting environment.",
      "Restart the Codespace/app after changing environment variables.",
    ],
    links: [
      { label: "Open settings", href: "/admin/settings" },
      { label: "Open integrations", href: "/admin/integrations" },
    ],
  },
  data: {
    title: "Data consistency repair guidance",
    description:
      "Repairs safe setup drift first, then leaves locked commercial documents unchanged for review.",
    automatic: [
      "Rename duplicate SKUs and reset negative stock when negative inventory is disabled.",
      "Set missing supplier default currencies from the active Master Data currency list.",
      "Apply supplier default carriers to active inbound shipments that do not already have a carrier.",
    ],
    manual: [
      "Review supplier currency mismatches on locked POs, invoices, and receipts before changing historical records.",
      "Use Master Data for currencies/carriers and Suppliers for supplier-specific defaults.",
    ],
    links: [
      { label: "Open suppliers", href: "/procurement/suppliers" },
      { label: "Open currencies", href: "/admin/master-data/currencies" },
      { label: "Open carriers", href: "/admin/master-data/carriers" },
      { label: "Open warehouse ops", href: "/inventory/warehouse-operations" },
    ],
  },
  system: {
    title: "System guidance",
    description: "Covers browser/device permissions and local storage issues that need operator action.",
    automatic: ["Records the guidance result so support can see the attempted remediation."],
    manual: [
      "Grant browser camera permissions for barcode scanning.",
      "Clear stale site storage if the UI state is stuck after a deployment.",
    ],
    links: [
      { label: "Open barcode scanner", href: "/inventory/barcodes" },
      { label: "Open profile", href: "/profile" },
    ],
  },
};

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
  const [events, setEvents] = useState<DiagnosticEvent[]>(() => getDiagnosticEvents());
  const [activeWorkspace, setActiveWorkspace] = useState<DiagnosticCategory>(diagnosticsWorkspaceFromUrl);
  const [scan, setScan] = useState<DiagnosticsScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanRunning, setScanRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshotResult | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [fixingCategory, setFixingCategory] = useState<string | null>(null);
  const [pendingFixCategory, setPendingFixCategory] = useState<string | null>(null);
  const findingsQuery = useQuery({
    queryKey: ["/api/diagnostics/findings", activeWorkspace],
    queryFn: () => requestJson<{ category: DiagnosticCategory; generatedAt: string; findings: DiagnosticFinding[] }>("GET", `/api/diagnostics/findings?category=${encodeURIComponent(activeWorkspace)}`),
    throwOnError: false,
  });
  const summaryQuery = useQuery({
    queryKey: ["/api/diagnostics/summary"],
    queryFn: () => requestJson<DiagnosticsSummary>("GET", "/api/diagnostics/summary"),
    throwOnError: false,
  });
  const probesMutation = useMutation({
    mutationFn: () => requestJson<{ summary: DiagnosticsSummary; findings: DiagnosticFinding[] }>("POST", "/api/diagnostics/probes/run", {}),
    onSuccess: async (result) => {
      toast({ title: "Safe probes complete", description: `${result.summary.total} finding(s); ${result.summary.openCount} require attention.` });
      await Promise.all([findingsQuery.refetch(), summaryQuery.refetch()]);
    },
    onError: (error: Error) => toast({ title: "Safe probes failed", description: error.message, variant: "destructive" }),
  });
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

  useEffect(() => subscribeToDiagnostics((next) => setEvents(next)), []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", activeWorkspace);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [activeWorkspace]);

  const busy = readyPending || setupPending || readinessFetching || setupFetching;
  const refetchReady = refetchReadiness;
  const refetchSetup = () => void retrySetupStatus();

  const copyDiagnosticsBundle = async () => {
    try {
      await copyDiagnosticsSummary(reportContext);
      toast({ title: "Copied", description: "Diagnostics summary is on the clipboard." });
    } catch {
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      });
    }
  };

  const runScan = async () => {
    setScanRunning(true);
    setScanError(null);
    try {
      const [scanResult, snapshotResult] = await Promise.all([
        fetchDiagnosticsScan(),
        fetchDiagnosticsSnapshot().catch((error: unknown) => {
          setSnapshotError(error instanceof Error ? error.message : String(error));
          return null;
        }),
      ]);
      setScan(scanResult);
      if (snapshotResult) setSnapshot(snapshotResult);
      addDiagnosticEvent({
        severity: "info",
        source: "diagnostics",
        title: "Diagnostics scan completed",
        message: "Existing diagnostics scan completed.",
        details: scanResult,
      });
      toast({ title: "Diagnostics scan complete" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setScanError(message);
      addDiagnosticEvent({
        severity: "error",
        source: "diagnostics",
        title: "Diagnostics scan failed",
        message,
        details: error,
      });
      toast({ title: "Diagnostics scan failed", description: message, variant: "destructive" });
    } finally {
      setScanRunning(false);
    }
  };

  const runFix = async (category: string) => {
    setPendingFixCategory(null);
    setFixingCategory(category);
    try {
      const result = await fixDiagnostics(category);
      addDiagnosticEvent({
        severity: result.success ? "info" : "warning",
        source: "diagnostics",
        title: `Diagnostics fix: ${category}`,
        message: result.message ?? (result.success ? "Fix completed." : "No automatic fix was applied."),
        details: result,
      });
      toast({ title: `Fix ${result.success ? "complete" : "reported"}`, description: result.message ?? result.fixed?.join(", ") });
      await runScan();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addDiagnosticEvent({ severity: "error", source: "diagnostics", title: "Diagnostics fix failed", message, details: error });
      toast({ title: "Diagnostics fix failed", description: message, variant: "destructive" });
    } finally {
      setFixingCategory(null);
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
  const selfChecks = useMemo(() => runDiagnosticsSelfChecks(), []);
  const recentCutoff = Date.now() - 10 * 60 * 1000;
  const recentEvents = events.filter((event) => new Date(event.timestamp).getTime() >= recentCutoff);
  const recentUnresolved = recentEvents.filter((event) => !event.resolved);
  const workspaceLocalEvents = useMemo(() => {
    if (activeWorkspace === "frontend") {
      return events.filter((event) => ["react", "route", "network", "console"].includes(event.source)).slice(0, 50);
    }
    if (activeWorkspace === "user-errors") {
      return events.filter((event) => !event.resolved && (event.source === "api" || event.source === "auth") && (event.severity === "error" || Number(event.status ?? 0) >= 400)).slice(0, 50);
    }
    if (activeWorkspace === "integrations") {
      return events.filter((event) => /export|email|stripe|websocket|camera/i.test(`${event.title} ${event.endpoint ?? ""}`)).slice(0, 30);
    }
    return [];
  }, [activeWorkspace, events]);
  const scanIssueCount = scan
    ? Object.values(scan).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0)
    : 0;
  const critical = recentUnresolved.filter((event) => event.severity === "critical").length;
  const errors = recentUnresolved.filter((event) => event.severity === "error").length;
  const warnings = recentUnresolved.filter((event) => event.severity === "warning").length;
  const slowRequests = recentUnresolved.filter((event) => (event.durationMs ?? 0) >= 3_000).length;
  const healthLevel: "Healthy" | "Needs attention" | "Critical" =
    critical > 0 || ready?.dbReady === false || ready?.schemaReady === false
      ? "Critical"
      : errors > 0 || warnings > 0 || slowRequests > 0 || scanIssueCount > 0 || selfChecks.failed > 0
        ? "Needs attention"
        : "Healthy";
  const reportContext: DiagnosticsReportContext = {
    ready: ready as ReadinessStatus | undefined,
    setup: setup ?? null,
    scan,
    serverSnapshot: snapshot,
    selfChecks,
  };
  const scanCategories: ScanCategory[] = ["database", "configuration", "data", "system"];
  const pendingCategory = pendingFixCategory as ScanCategory | null;
  const pendingGuidance = pendingCategory ? DIAGNOSTICS_GUIDANCE[pendingCategory] : null;
  const pendingIssues = pendingCategory ? scan?.[pendingCategory] ?? [] : [];
  const pendingFixDescription =
    pendingFixCategory === "data"
      ? "This safe repair can clean inventory drift, supplier default currencies, and active inbound shipment carrier defaults."
      : pendingFixCategory
        ? `Run safe diagnostics guidance for ${pendingFixCategory}.`
        : "";

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6" data-testid="system-diagnostics-page">
      <PageHeader
        title="System diagnostics command center"
        titleTestId="page-title"
        subtitle="Runtime errors, API failures, route warnings, health checks, diagnostics scans, and exportable support reports"
        breadcrumb={<span>Admin / Diagnostics</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              data-testid="diagnostics-run-scan-button"
              disabled={scanRunning}
              onClick={() => void runScan()}
            >
              <PlayCircle className={`mr-2 h-4 w-4 ${scanRunning ? "animate-spin" : ""}`} />
              Run scan
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Copy diagnostics JSON summary"
              onClick={() => void copyDiagnosticsBundle()}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy summary
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

      <ModuleTrainingPanel moduleId="system-diagnostics" />

      <Tabs value={activeWorkspace} onValueChange={(value) => setActiveWorkspace(value as DiagnosticCategory)} className="space-y-4" data-testid="diagnostics-tabs">
        <TabsList className="grid h-auto grid-cols-2 gap-1 md:grid-cols-5">
          {diagnosticCategories.map((category) => (
            <TabsTrigger key={category} value={category} data-testid={`diagnostics-tab-${category}`}>
              {DIAGNOSTIC_WORKSPACES[category].label}
              {summaryQuery.data?.byCategory[category] ? <span className="ml-1 text-xs">({summaryQuery.data.byCategory[category]})</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {diagnosticCategories.map((category) => (
          <TabsContent key={category} value={category}>
            <DiagnosticsWorkspacePanel
              category={category}
              findings={category === activeWorkspace ? findingsQuery.data?.findings ?? [] : []}
              localEvents={category === activeWorkspace ? workspaceLocalEvents : []}
              loading={category === activeWorkspace && findingsQuery.isPending}
              error={category === activeWorkspace && findingsQuery.error ? findingsQuery.error.message : null}
              probing={probesMutation.isPending}
              onRunProbes={() => probesMutation.mutate()}
              onRetry={() => void findingsQuery.refetch()}
            />
          </TabsContent>
        ))}
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <Badge variant={healthLevel === "Critical" ? "destructive" : healthLevel === "Needs attention" ? "outline" : "secondary"}>
          {healthLevel}
        </Badge>
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

      <Card data-testid="diagnostics-health-summary">
        <CardHeader>
          <CardTitle className="text-base">Overall health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile label="Derived phase">{phase}</SummaryTile>
            <SummaryTile label="Current route">{window.location.pathname}</SummaryTile>
            <SummaryTile label="/api/ready">{ready?.dbReady && ready?.schemaReady ? "Ready" : "Degraded or loading"}</SummaryTile>
            <SummaryTile label="Server uptime">{snapshot?.uptimeSeconds != null ? `${snapshot.uptimeSeconds}s` : "—"}</SummaryTile>
            <SummaryTile label="Updated (client)">{clientSnap?.updatedAt ?? "—"}</SummaryTile>
            <SummaryTile label="/api/ready observer">
              {readinessProbeFailed ? "Failed (no successful body yet)" : "Ok or not queried"}
            </SummaryTile>
            <SummaryTile label="/api/setup/status observer">
              {setupProbeFailed ? "Failed or empty after fetch" : "Ok or loading"}
            </SummaryTile>
            <SummaryTile label="Last scan">{scan ? "Current session" : "Not run yet"}</SummaryTile>
            <SummaryTile label="Self-checks">{selfChecks.failed === 0 ? "Pass" : `${selfChecks.failed} failed`}</SummaryTile>
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

      <details className="rounded-lg border bg-card" data-testid="diagnostics-advanced-evidence">
        <summary className="cursor-pointer px-4 py-3 font-medium sm:px-6">
          Advanced browser diagnostics and support evidence
          <span className="ml-2 text-xs font-normal text-muted-foreground">Open only when deeper troubleshooting is needed</span>
        </summary>
        <div className="space-y-6 border-t p-4 sm:p-6">
      <Card data-testid="diagnostics-live-events">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Live error monitor</CardTitle>
          <Button type="button" size="sm" variant="outline" data-testid="diagnostics-clear-events" onClick={() => clearDiagnosticEvents()}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clear events
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <SummaryTile label="Critical">{critical}</SummaryTile>
            <SummaryTile label="Errors">{errors}</SummaryTile>
            <SummaryTile label="Warnings">{warnings}</SummaryTile>
            <SummaryTile label="Slow requests">{slowRequests}</SummaryTile>
          </div>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No live diagnostics events captured in this browser yet.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Showing the 20 most recent unresolved events. Resolved history is omitted from this operational view.</p>
              <div className="max-h-[420px] space-y-2 overflow-auto">
              {events.filter((event) => !event.resolved).slice(0, 20).map((event) => (
                <div key={event.id} data-testid="diagnostics-event-row" className="rounded-lg border bg-muted/20 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={event.severity === "critical" || event.severity === "error" ? "destructive" : "outline"}>
                          {event.severity}
                        </Badge>
                        <Badge variant="secondary">{event.source}</Badge>
                        <span className="font-medium">{event.title}</span>
                      </div>
                      <p className="mt-1 text-muted-foreground">{event.message}</p>
                    </div>
                    <Button type="button" size="sm" variant="ghost" onClick={() => markDiagnosticResolved(event.id)}>
                      {event.resolved ? "Resolved" : "Mark resolved"}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {new Date(event.timestamp).toLocaleString()} {event.route ? `· ${event.route}` : ""}{" "}
                    {event.endpoint ? `· ${event.method ?? "GET"} ${event.endpoint}` : ""}{" "}
                    {event.durationMs != null ? `· ${Math.round(event.durationMs)}ms` : ""}
                  </p>
                </div>
              ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="diagnostics-scan-results">
        <CardHeader>
          <CardTitle className="text-base">Diagnostics scan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {scanError ? <p className="text-sm text-destructive">{scanError}</p> : null}
          <div className="grid gap-3 md:grid-cols-4">
            {scanCategories.map((category) => {
              const rows = scan?.[category] ?? [];
              return (
                <div key={category} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="font-medium capitalize">{category}</h3>
                    <Badge variant={rows.length > 0 ? "destructive" : "secondary"}>{rows.length}</Badge>
                  </div>
                  {rows.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                      {rows.map((row) => <li key={row}>{row}</li>)}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">{scan ? "No issues." : "Run scan."}</p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    data-testid="diagnostics-fix-button"
                    disabled={fixingCategory === category || !scan}
                    onClick={() => setPendingFixCategory(category)}
                  >
                    {fixingCategory === category ? "Fixing…" : "Fix / guidance"}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Internal calculation/filter self-checks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant={selfChecks.failed > 0 ? "destructive" : "secondary"}>
              {selfChecks.failed > 0 ? "Fail" : "Pass"}
            </Badge>
            <Badge variant="outline">{selfChecks.passed} passed</Badge>
            <Badge variant="outline">{selfChecks.failed} failed</Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {selfChecks.checks.map((check) => (
              <div key={check.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-center gap-2">
                  <ShieldCheck className={`h-4 w-4 ${check.ok ? "text-emerald-600" : "text-destructive"}`} />
                  <span className="font-medium">{check.name}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{check.message}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            These are lightweight runtime checks for shared helpers. Run <code>npm run test:diagnostics</code>,{" "}
            <code>npm run test:functional-audit</code>, and E2E locally for broader proof.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Functional audit status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            This browser can run internal self-checks, but full functional audit results come from local/CI commands and
            documented reports. Use <code>docs/FUNCTIONAL-QA-AUDIT.md</code> and run{" "}
            <code>npm run verify:core</code> for current pass/fail evidence.
          </p>
          <p>Known limitation: the browser cannot read arbitrary local Playwright output unless the server exposes it safely.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export report</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" data-testid="diagnostics-export-json" onClick={() => downloadDiagnosticsJson(reportContext)}>
            <Download className="mr-2 h-4 w-4" />
            Export JSON
          </Button>
          <Button type="button" variant="outline" data-testid="diagnostics-export-markdown" onClick={() => downloadDiagnosticsMarkdown(reportContext)}>
            <Download className="mr-2 h-4 w-4" />
            Export Markdown
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label="Copy diagnostics summary"
            data-testid="diagnostics-copy-summary"
            onClick={() => void copyDiagnosticsBundle()}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy summary
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operator recovery guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="text-foreground font-medium">Setup status fails but pages load:</span> confirm the API
              process is running, the configured database connection points at a live Postgres instance, and migrations
              have been applied (
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

        </div>
      </details>

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

      <AlertDialog open={pendingFixCategory != null} onOpenChange={(open) => !open && setPendingFixCategory(null)}>
        <AlertDialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingGuidance?.title ?? "Run diagnostics fix?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingGuidance?.description ?? pendingFixDescription} The result will be logged in diagnostics and the scan will refresh afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingGuidance ? (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="font-medium text-foreground">Current findings</h3>
                {pendingIssues.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                    {pendingIssues.slice(0, 8).map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-muted-foreground">No active findings in this category right now.</p>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <h3 className="font-medium text-foreground">Automatic repair</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                    {pendingGuidance.automatic.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border p-3">
                  <h3 className="font-medium text-foreground">Manual follow-up</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                    {pendingGuidance.manual.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {pendingGuidance.links.map((link) => (
                  <Button
                    key={link.href}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => window.location.assign(link.href)}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {link.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingFixCategory) void runFix(pendingFixCategory);
              }}
            >
              Run fix
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
