import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Download } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { DataState } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQueryState } from "@/hooks/use-query-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { Can } from "@/components/auth/can";
import { EntityActivityPanel } from "@/components/activity/entity-activity-panel";
import { useToast } from "@/hooks/use-toast";
import { downloadCsv } from "@/lib/csv-download";
import { formatMutationError, requestJson } from "@/lib/queryClient";
import {
  addExceptionComment,
  assignException,
  fetchException,
  fetchExceptionsPageEnvelope,
  updateExceptionStatus,
  type OperationalException,
} from "@/api/client";
import type { FallbackKind } from "@/components/ui/data-state";
import {
  hasExceptionAssigneeChanged,
  normalizeExceptionAssigneeInput,
  shouldSubmitExceptionQuickUpdate,
} from "@/pages/exceptions-workflow";

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function ExceptionsV1ExclusionNotice() {
  return (
    <Alert className="border-amber-200 bg-amber-50 text-amber-950">
      <AlertTriangle className="h-4 w-4" aria-hidden />
      <AlertTitle>Operational review route</AlertTitle>
      <AlertDescription>
        This queue uses live operational exception records for review, triage, and linked-record navigation. Status,
        assignment, and comment actions remain role-gated, and production change approval still depends on attached
        disposable-database workflow evidence.
      </AlertDescription>
    </Alert>
  );
}

function exceptionsListFiltersNormalized(q: { severity: string; status: string; type: string }) {
  return {
    severity: String(q.severity ?? "").trim(),
    status: String(q.status ?? "").trim(),
    type: String(q.type ?? "").trim(),
  };
}

function readExceptionInvtrack(refs: Record<string, unknown>): Record<string, unknown> {
  const raw = refs._invtrack;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function slaStatusLabel(s: string | undefined) {
  switch (s) {
    case "breached":
      return "Breached";
    case "due":
      return "Due soon";
    case "ok":
      return "Within SLA";
    default:
      return "—";
  }
}

function exceptionStatusNeedsNote(status: string) {
  return status === "resolved" || status === "closed";
}

/** Matches types emitted by runOperationalExceptionChecks / ops rules */
const EXCEPTION_TYPE_PRESETS = [
  { value: "__all__", label: "All types" },
  { value: "late_shipment", label: "Late shipment" },
  { value: "shipment_no_eta", label: "Shipment — no ETA" },
  { value: "stock_shortage", label: "Stock shortage" },
  { value: "inventory_shortage", label: "Inventory shortage" },
  { value: "contract_violation", label: "Contract violation" },
  { value: "po_mismatch", label: "PO mismatch" },
];

function ExceptionListView() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { queryState, setQueryState } = useQueryState({
    severity: "",
    status: "",
    type: "",
    page: "1",
    pageSize: "25",
    sort: "created_desc",
  });
  const debouncedQuery = useDebouncedValue(queryState, 350);
  const debouncedNorm = exceptionsListFiltersNormalized(debouncedQuery);
  const page = Math.max(1, Number(queryState.page) || 1);
  const pageSize = ([25, 50, 100].includes(Number(queryState.pageSize)) ? Number(queryState.pageSize) : 25) as 25 | 50 | 100;
  const sort = (["created_desc", "created_asc", "severity_desc"].includes(String(queryState.sort))
    ? String(queryState.sort)
    : "created_desc") as "created_desc" | "created_asc" | "severity_desc";

  const {
    data: envelope,
    isLoading: loading,
    isError,
    error: queryError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["/api/v2/exceptions", debouncedNorm.severity, debouncedNorm.status, debouncedNorm.type, page, pageSize, sort],
    queryFn: () =>
      fetchExceptionsPageEnvelope({
        page,
        pageSize,
        sort,
        severity: debouncedNorm.severity || undefined,
        status: debouncedNorm.status || undefined,
        type: debouncedNorm.type || undefined,
      }),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });

  const error = isError ? (queryError instanceof Error ? queryError : new Error(String(queryError))) : null;
  const exceptionPage = envelope?.data ?? null;
  const data = exceptionPage?.items ?? null;
  const fallback = envelope?.meta?.fallback as FallbackKind | undefined;
  const {
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    lastRefreshedAt,
    lastRefreshedLabel,
    refreshNow,
    markRefreshed,
  } = useAutoRefresh(useCallback(async () => {
    await refetch();
  }, [refetch]));

  const [quickException, setQuickException] = useState<OperationalException | null>(null);
  const [quickStatus, setQuickStatus] = useState("in_progress");
  const [quickAssignee, setQuickAssignee] = useState("");
  const [quickNote, setQuickNote] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);

  useEffect(() => {
    if (data && !lastRefreshedAt) {
      markRefreshed();
    }
  }, [data, lastRefreshedAt, markRefreshed]);

  useEffect(() => {
    if (quickException) {
      setQuickAssignee(quickException.assignee?.trim() || "");
      setQuickNote("");
      setQuickStatus(
        ["open", "in_progress", "resolved", "closed"].includes(quickException.status)
          ? quickException.status
          : "in_progress",
      );
    }
  }, [quickException]);

  const exceptionDetailPath = useCallback(
    (id: number) => `${APP_ROUTES.operations.exceptions}/${id}`,
    [],
  );
  const quickStatusRequiresNote = exceptionStatusNeedsNote(quickStatus);
  const quickAssigneeChanged = quickException
    ? hasExceptionAssigneeChanged(quickException.assignee, quickAssignee)
    : false;
  const quickCanSubmit = quickException
    ? shouldSubmitExceptionQuickUpdate({
        currentStatus: quickException.status,
        nextStatus: quickStatus,
        currentAssignee: quickException.assignee,
        nextAssigneeInput: quickAssignee,
        note: quickNote,
        statusRequiresNote: quickStatusRequiresNote,
      })
    : false;

  const handleExportCsv = () => {
    try {
      const exceptions = data ?? [];
      const rows: string[][] = [
        ["id", "type", "severity", "status", "title", "assignee", "created_at", "updated_at"],
        ...exceptions.map((exception) => [
          String(exception.id),
          exception.type,
          exception.severity,
          exception.status,
          exception.title,
          exception.assignee || "",
          exception.createdAt || "",
          exception.updatedAt || "",
        ]),
      ];
      downloadCsv("exceptions-export.csv", rows);
      toast({ title: "Export complete", description: "exceptions-export.csv downloaded." });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Failed to export CSV",
        variant: "destructive",
      });
    }
  };

  const exceptionTypeFilter = String(queryState.type || "");
  const exceptionTypeSelectValue =
    exceptionTypeFilter === ""
      ? "__all__"
      : EXCEPTION_TYPE_PRESETS.some((p) => p.value === exceptionTypeFilter)
        ? exceptionTypeFilter
        : "__custom__";

  const handleRunChecks = async () => {
    try {
      const result = await requestJson<{
        created: {
          lateShipments: number;
          noEtaShipments: number;
          stockShortages: number;
          contractViolations: number;
        };
        updated: {
          lateShipments: number;
          noEtaShipments: number;
          stockShortages: number;
          contractViolations: number;
        };
        skippedDuplicates: {
          lateShipments: number;
          noEtaShipments: number;
          stockShortages: number;
          contractViolations: number;
        };
        checksRun: readonly string[];
        generatedAt: string;
      }>("POST", "/api/exceptions/run-checks");
      const c = result?.created;
      const u = result?.updated;
      const s = result?.skippedDuplicates;
      toast({
        title: "Exception checks completed",
        description: c
          ? `New: late ${c.lateShipments}, no ETA ${c.noEtaShipments}, stock ${c.stockShortages}, contract ${c.contractViolations}. Updated: late ${u?.lateShipments ?? 0}, no ETA ${u?.noEtaShipments ?? 0}, stock ${u?.stockShortages ?? 0}, contract ${u?.contractViolations ?? 0}. Skipped dupes: ${(s?.lateShipments ?? 0) + (s?.noEtaShipments ?? 0) + (s?.stockShortages ?? 0) + (s?.contractViolations ?? 0)}.`
          : "Scan finished.",
      });
      await refreshNow();
    } catch (error) {
      toast({
        title: "Failed to run exception checks",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <div data-testid="exceptions-page" className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Exceptions"
        subtitle="Control tower lifecycle management"
        breadcrumb={<span>Operations / Exceptions</span>}
      />
      <ExceptionsV1ExclusionNotice />

      <div data-tour="exceptions-list" className="space-y-4">
      <div data-tour="exceptions-toolbar">
      <Toolbar
        sticky
        left={
          <>
            <Input
              data-testid="exception-filter-severity"
              value={String(queryState.severity || "")}
              onChange={(event) => setQueryState({ severity: event.target.value, page: "1" })}
              placeholder="Severity"
              className="w-40"
            />
            <Input
              data-testid="exception-filter-status"
              value={String(queryState.status || "")}
              onChange={(event) => setQueryState({ status: event.target.value, page: "1" })}
              placeholder="Status"
              className="w-44"
            />
            <Select
              value={exceptionTypeSelectValue}
              onValueChange={(v) => {
                if (v === "__all__") setQueryState({ type: "", page: "1" });
                else if (v === "__custom__") {
                  /* Keep current typed filter; only switches UI to “custom” mode */
                } else setQueryState({ type: v, page: "1" });
              }}
            >
              <SelectTrigger data-testid="exception-filter-type" className="w-52">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                {EXCEPTION_TYPE_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value="__custom__">Custom…</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={String(queryState.type || "")}
              onChange={(event) => setQueryState({ type: event.target.value, page: "1" })}
              placeholder="Custom type (e.g. mismatch)"
              className="w-48"
            />
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <Button
              variant={autoRefreshEnabled ? "default" : "outline"}
              data-testid="exceptions-auto-refresh"
              onClick={() => setAutoRefreshEnabled((current) => !current)}
            >
              Auto-refresh: {autoRefreshEnabled ? "On" : "Off"}
            </Button>
            <Button variant="outline" data-testid="exceptions-refresh" onClick={refreshNow}>
              Refresh
            </Button>
            <Can resource="inventory" permissionType="execute" reason="Requires inventory:execute permission">
              <Button variant="outline" data-testid="exceptions-run-checks" onClick={handleRunChecks}>
                Run checks
              </Button>
            </Can>
            <Button
              variant="outline"
              data-testid="exceptions-export-csv"
              onClick={handleExportCsv}
              disabled={!data || data.length === 0}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export current page CSV
            </Button>
            <Select value={String(pageSize)} onValueChange={(value) => setQueryState({ pageSize: value, page: "1" })}>
              <SelectTrigger className="w-24" aria-label="Exceptions page size"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 rows</SelectItem>
                <SelectItem value="50">50 rows</SelectItem>
                <SelectItem value="100">100 rows</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              Last refreshed: {lastRefreshedLabel}
              {isFetching ? " · updating…" : ""}
            </span>
          </div>
        }
      />
      </div>

      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={(exceptions) => (Array.isArray(exceptions) ? exceptions : []).length === 0}
        emptyTitle="No exceptions found"
        emptyDescription="Exceptions are created from inventory issues, PO mismatches, receiving tolerances, and AP match failures. Review inventory, procurement, or system diagnostics to create real exceptions."
        emptyAction={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="default" size="sm">
              <Link href={APP_ROUTES.inventory.root}>View inventory</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={APP_ROUTES.admin.systemDiagnostics}>Open diagnostics</Link>
            </Button>
          </div>
        }
        fallback={fallback}
        onRetry={refreshNow}
      >
        {(exceptions) => {
          const list = Array.isArray(exceptions) ? exceptions : [];
          return (
          <div data-tour="exceptions-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Related</TableHead>
                <TableHead className="tabular-nums">Aged (h)</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((exception) => (
                <TableRow
                  key={exception.id}
                  data-testid="exception-list-row"
                  className="cursor-pointer"
                  onClick={() => setLocation(exceptionDetailPath(exception.id))}
                >
                  <TableCell className="font-medium">#{exception.id}</TableCell>
                  <TableCell>{exception.area ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{exception.exceptionCode ?? exception.type}</TableCell>
                  <TableCell>{exception.type}</TableCell>
                  <TableCell>
                    <StatusBadge status={exception.severity} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={exception.status} />
                  </TableCell>
                  <TableCell>{exception.title}</TableCell>
                  <TableCell className="max-w-[160px] truncate text-sm text-muted-foreground">
                    {exception.relatedSummary ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">{exception.agedHours ?? "—"}</TableCell>
                  <TableCell className="text-sm">{slaStatusLabel(exception.slaStatus)}</TableCell>
                  <TableCell>{exception.assignee || "-"}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setQuickException(exception);
                      }}
                    >
                      Update
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          );
        }}
      </DataState>

      {exceptionPage && exceptionPage.total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Exception pagination">
          <span className="text-muted-foreground">
            {(exceptionPage.page - 1) * exceptionPage.pageSize + 1}–{Math.min(exceptionPage.total, exceptionPage.page * exceptionPage.pageSize)} of {exceptionPage.total} exceptions
          </span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={exceptionPage.page <= 1} onClick={() => setQueryState({ page: "1" })}>First</Button>
            <Button type="button" size="sm" variant="outline" disabled={exceptionPage.page <= 1} onClick={() => setQueryState({ page: String(exceptionPage.page - 1) })}>Previous</Button>
            <Button type="button" size="sm" variant="outline" disabled={!exceptionPage.hasNext} onClick={() => setQueryState({ page: String(exceptionPage.page + 1) })}>Next</Button>
            <Button type="button" size="sm" variant="outline" disabled={!exceptionPage.hasNext} onClick={() => setQueryState({ page: String(Math.max(1, Math.ceil(exceptionPage.total / exceptionPage.pageSize))) })}>Last</Button>
          </div>
        </div>
      ) : null}

      <Dialog open={!!quickException} onOpenChange={(open) => !open && setQuickException(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Quick update
              {quickException ? ` — #${quickException.id}` : ""}
            </DialogTitle>
          </DialogHeader>
          {quickException ? (
            <div className="grid gap-3 py-2">
              <p className="text-sm text-muted-foreground line-clamp-2">{quickException.title}</p>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={quickStatus} onValueChange={setQuickStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">open</SelectItem>
                    <SelectItem value="in_progress">in_progress</SelectItem>
                    <SelectItem value="resolved">resolved</SelectItem>
                    <SelectItem value="closed">closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-assignee">Assignee</Label>
                <Input
                  id="quick-assignee"
                  value={quickAssignee}
                  onChange={(e) => setQuickAssignee(e.target.value)}
                  placeholder="User or team name (leave blank to clear)"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-note">
                  {quickStatusRequiresNote ? "Resolution note" : "Status note"}
                </Label>
                <Input
                  id="quick-note"
                  value={quickNote}
                  onChange={(e) => setQuickNote(e.target.value)}
                  placeholder={
                    quickStatusRequiresNote
                      ? "Required when resolving or closing"
                      : "Optional handoff or context note"
                  }
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            {quickException ? (
              <Button variant="link" className="px-0" asChild>
                <Link href={exceptionDetailPath(quickException.id)}>Open full detail</Link>
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setQuickException(null)}>
                Cancel
              </Button>
              <Can resource="inventory" permissionType="update" reason="Requires inventory:update permission">
                <Button
                  disabled={
                    !quickException ||
                    quickSaving ||
                    !quickCanSubmit
                  }
                  onClick={async () => {
                    if (!quickException) return;
                    setQuickSaving(true);
                    try {
                      if (quickException.status !== quickStatus) {
                        await updateExceptionStatus(quickException.id, quickStatus, quickNote.trim() || undefined);
                      }
                      if (quickAssigneeChanged) {
                        await assignException(
                          quickException.id,
                          normalizeExceptionAssigneeInput(quickAssignee) ?? "",
                        );
                      }
                      toast({ title: "Exception updated" });
                      setQuickException(null);
                      await refreshNow();
                    } catch (err) {
                      toast({
                        title: "Update failed",
                        description: err instanceof Error ? err.message : String(err),
                        variant: "destructive",
                      });
                    } finally {
                      setQuickSaving(false);
                    }
                  }}
                >
                  Save
                </Button>
              </Can>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

function ExceptionDetailView({ exceptionId }: { exceptionId: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [nextStatus, setNextStatus] = useState("in_progress");
  const [assignee, setAssignee] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const {
    data,
    isLoading: loading,
    isError,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ["/api/exceptions/detail", exceptionId],
    queryFn: () => fetchException(exceptionId),
  });
  const error = isError ? (queryError instanceof Error ? queryError : new Error(String(queryError))) : null;

  useEffect(() => {
    if (!data) return;
    setAssignee(data.assignee?.trim() || "");
    setStatusNote("");
    setNextStatus(
      ["open", "in_progress", "resolved", "closed"].includes(data.status) ? data.status : "in_progress",
    );
  }, [data]);

  const relatedLinks = useMemo(() => {
    if (!data) return [];
    const refs = data.relatedRefs;
    const links: Array<{ label: string; href: string }> = [];
    if (typeof refs.po_number === "string") {
      links.push({ label: `PO ${refs.po_number}`, href: APP_ROUTES.procurement.order(refs.po_number) });
    }
    if (typeof refs.shipment_id === "number") {
      links.push({
        label: `Shipment ${refs.shipment_id}`,
        href: APP_ROUTES.operations.shipment(refs.shipment_id),
      });
    }
    if (typeof refs.sku === "string") {
      links.push({ label: `SKU ${refs.sku}`, href: APP_ROUTES.inventory.item(refs.sku) });
    }
    return links;
  }, [data]);
  const detailStatusRequiresNote = exceptionStatusNeedsNote(nextStatus);
  const detailAssigneeChanged = hasExceptionAssigneeChanged(data?.assignee, assignee);

  const runWithToast = async (action: () => Promise<void>) => {
    setSaving(true);
    try {
      await action();
      await refetch();
    } catch (updateError) {
      const err = updateError as Error & { status?: number };
      toast({
        title: "Update failed",
        description: formatMutationError("Exception update", "PATCH", `/api/exceptions/${exceptionId}`, err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="exception-detail-page" className="mx-auto max-w-7xl space-y-4">
      <Button variant="ghost" onClick={() => setLocation(APP_ROUTES.operations.exceptions)} className="w-fit">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to exceptions
      </Button>

      <DataState
        loading={loading}
        error={error}
        data={data ?? null}
        isEmpty={() => false}
        emptyTitle="Exception detail unavailable"
        onRetry={refetch}
      >
        {(exception) => (
          <>
            <PageHeader
              title={`Exception #${exception.id}`}
              subtitle={exception.title}
              breadcrumb={<span>Operations / Exceptions / {exception.id}</span>}
            />
            <ExceptionsV1ExclusionNotice />

            <div className="grid gap-4 md:grid-cols-2">
              <Card data-testid="exception-detail-incident">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Incident summary</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {exception.description?.trim() ? exception.description : "No description recorded."}
                </CardContent>
              </Card>
              <Card data-testid="exception-detail-sla">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Aging & SLA</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <div>Area: {exception.area ?? "—"}</div>
                  <div>Code: {exception.exceptionCode ?? exception.type}</div>
                  <div>Aged: {exception.agedHours != null ? `${exception.agedHours} h` : "—"}</div>
                  <div>
                    SLA status: {slaStatusLabel(exception.slaStatus)} ({exception.slaHours}h target)
                  </div>
                  {(() => {
                    const inv = readExceptionInvtrack(exception.relatedRefs);
                    return inv.rootCause ? (
                      <div className="text-muted-foreground">Root cause: {String(inv.rootCause)}</div>
                    ) : null;
                  })()}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Type</CardTitle>
                </CardHeader>
                <CardContent>{exception.type}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Severity</CardTitle>
                </CardHeader>
                <CardContent>
                  <StatusBadge status={exception.severity} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <StatusBadge status={exception.status} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">SLA</CardTitle>
                </CardHeader>
                <CardContent>{exception.slaHours}h</CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Lifecycle actions</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[220px_1fr] lg:grid-cols-[220px_1fr_1fr_auto]">
                <Select value={nextStatus} onValueChange={setNextStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_progress">in_progress</SelectItem>
                    <SelectItem value="resolved">resolved</SelectItem>
                    <SelectItem value="closed">closed</SelectItem>
                    <SelectItem value="open">open</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={assignee}
                  onChange={(event) => setAssignee(event.target.value)}
                  placeholder="Assign to user (leave blank to clear)"
                />
                <Input
                  value={statusNote}
                  onChange={(event) => setStatusNote(event.target.value)}
                  placeholder={
                    detailStatusRequiresNote
                      ? "Resolution note required for resolve/close"
                      : "Optional status note"
                  }
                />
                <div className="flex gap-2">
                  <Can resource="inventory" permissionType="update" reason="Requires inventory:update permission">
                    <Button
                      variant="outline"
                      disabled={
                        saving ||
                        nextStatus === exception.status ||
                        (detailStatusRequiresNote && !statusNote.trim())
                      }
                      onClick={() =>
                        runWithToast(async () => {
                          await updateExceptionStatus(exception.id, nextStatus, statusNote.trim() || undefined);
                          setStatusNote("");
                        })
                      }
                    >
                      Update status
                    </Button>
                  </Can>
                  <Can resource="inventory" permissionType="update" reason="Requires inventory:update permission">
                    <Button
                      disabled={saving || !detailAssigneeChanged}
                      onClick={() =>
                        runWithToast(async () => {
                          await assignException(exception.id, normalizeExceptionAssigneeInput(assignee) ?? "");
                        })
                      }
                    >
                      Assign
                    </Button>
                  </Can>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Comment timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Add comment"
                  />
                  <Can resource="inventory" permissionType="update" reason="Requires inventory:update permission">
                    <Button
                      disabled={saving || !comment.trim()}
                      onClick={() =>
                        runWithToast(async () => {
                          await addExceptionComment(exception.id, comment);
                          setComment("");
                        })
                      }
                    >
                      Post
                    </Button>
                  </Can>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Author</TableHead>
                      <TableHead>Comment</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exception.comments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-sm text-muted-foreground">
                          No comments yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      exception.comments.map((entry, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{String(entry.author ?? "-")}</TableCell>
                          <TableCell>{String(entry.comment ?? "-")}</TableCell>
                          <TableCell>{formatDate(String(entry.at ?? null))}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card data-testid="exception-detail-related">
              <CardHeader>
                <CardTitle>Related records</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {relatedLinks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No linked records</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {relatedLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Created {formatDate(exception.createdAt)} • Updated {formatDate(exception.updatedAt)}
                </p>
              </CardContent>
            </Card>

            <EntityActivityPanel entityType="exception" entityId={exception.id} />
          </>
        )}
      </DataState>
    </div>
  );
}

export default function ExceptionsPage() {
  const [detailMatch, detailParams] = useRoute<{ id: string }>(`${APP_ROUTES.operations.exceptions}/:id`);
  if (detailMatch && detailParams?.id) {
    return <ExceptionDetailView exceptionId={detailParams.id} />;
  }
  return <ExceptionListView />;
}
