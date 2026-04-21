import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, Download } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQueryState } from "@/hooks/use-query-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
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
  fetchExceptionsEnvelope,
  updateExceptionStatus,
  type OperationalException,
} from "@/api/client";
import type { FallbackKind } from "@/components/ui/data-state";

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

/** Matches types emitted by runOperationalExceptionChecks / ops rules */
const EXCEPTION_TYPE_PRESETS = [
  { value: "__all__", label: "All types" },
  { value: "late_shipment", label: "Late shipment" },
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
  });

  const fetcher = useCallback(
    () =>
      fetchExceptionsEnvelope({
        severity: String(queryState.severity || ""),
        status: String(queryState.status || ""),
        type: String(queryState.type || ""),
      }),
    [queryState.severity, queryState.status, queryState.type],
  );

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

  const [quickException, setQuickException] = useState<OperationalException | null>(null);
  const [quickStatus, setQuickStatus] = useState("in_progress");
  const [quickAssignee, setQuickAssignee] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);

  useEffect(() => {
    if (data && !lastRefreshedAt) {
      markRefreshed();
    }
  }, [data, lastRefreshedAt, markRefreshed]);

  useEffect(() => {
    if (quickException) {
      setQuickAssignee(quickException.assignee?.trim() || "");
      setQuickStatus(
        ["open", "in_progress", "resolved", "closed"].includes(quickException.status)
          ? quickException.status
          : "in_progress",
      );
    }
  }, [quickException]);

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
        created: { lateShipments: number; stockShortages: number; contractViolations: number };
        touched: { lateShipments: number; stockShortages: number; contractViolations: number };
      }>("POST", "/api/exceptions/run-checks");
      const c = result?.created;
      const t = result?.touched;
      toast({
        title: "Exception checks completed",
        description: c
          ? `New: late ${c.lateShipments}, stock ${c.stockShortages}, contract ${c.contractViolations}. Scanned: late ${t?.lateShipments ?? 0}, stock ${t?.stockShortages ?? 0}, contract ${t?.contractViolations ?? 0}.`
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
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Exceptions"
        subtitle="Control tower lifecycle management"
        breadcrumb={<span>Operations / Exceptions</span>}
      />

      <div data-tour="exceptions-list" className="space-y-4">
      <div data-tour="exceptions-toolbar">
      <Toolbar
        sticky
        left={
          <>
            <Input
              value={String(queryState.severity || "")}
              onChange={(event) => setQueryState({ severity: event.target.value })}
              placeholder="Severity"
              className="w-40"
            />
            <Input
              value={String(queryState.status || "")}
              onChange={(event) => setQueryState({ status: event.target.value })}
              placeholder="Status"
              className="w-44"
            />
            <Select
              value={exceptionTypeSelectValue}
              onValueChange={(v) => {
                if (v === "__all__") setQueryState({ type: "" });
                else if (v === "__custom__") {
                  /* Keep current typed filter; only switches UI to “custom” mode */
                } else setQueryState({ type: v });
              }}
            >
              <SelectTrigger className="w-52">
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
              onChange={(event) => setQueryState({ type: event.target.value })}
              placeholder="Custom type (e.g. mismatch)"
              className="w-48"
            />
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <Button
              variant={autoRefreshEnabled ? "default" : "outline"}
              onClick={() => setAutoRefreshEnabled((current) => !current)}
            >
              Auto-refresh: {autoRefreshEnabled ? "On" : "Off"}
            </Button>
            <Button variant="outline" onClick={refreshNow}>
              Refresh
            </Button>
            <Can roles={["manager", "admin"]} reason="Requires Manager/Admin">
              <Button variant="outline" onClick={handleRunChecks}>
                Run checks
              </Button>
            </Can>
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={!data || data.length === 0}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <span className="text-xs text-muted-foreground">
              Last refreshed: {lastRefreshedLabel}
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
        emptyDescription="Exceptions are created from inventory issues or PO mismatches. Check inventory or run the demo."
        emptyAction={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="default" size="sm">
              <Link href="/inventory">View inventory</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/">Overview / Demo</Link>
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
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((exception) => (
                <TableRow
                  key={exception.id}
                  className="cursor-pointer"
                  onClick={() => setLocation(`/exceptions/${exception.id}`)}
                >
                  <TableCell className="font-medium">#{exception.id}</TableCell>
                  <TableCell>{exception.type}</TableCell>
                  <TableCell>
                    <StatusBadge status={exception.severity} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={exception.status} />
                  </TableCell>
                  <TableCell>{exception.title}</TableCell>
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
                  placeholder="User or team name"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            {quickException ? (
              <Button variant="link" className="px-0" asChild>
                <Link href={`/exceptions/${quickException.id}`}>Open full detail</Link>
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setQuickException(null)}>
                Cancel
              </Button>
              <Can roles={["planner", "admin"]} reason="Requires Planner/Admin">
                <Button
                  disabled={!quickException || quickSaving}
                  onClick={async () => {
                    if (!quickException) return;
                    setQuickSaving(true);
                    try {
                      await updateExceptionStatus(quickException.id, quickStatus);
                      if (quickAssignee.trim()) {
                        await assignException(quickException.id, quickAssignee.trim());
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
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const fetcher = useCallback(
    (): Promise<OperationalException> => fetchException(exceptionId),
    [exceptionId],
  );
  const { loading, error, data, refetch } = useAsyncResource(fetcher);

  const relatedLinks = useMemo(() => {
    if (!data) return [];
    const refs = data.relatedRefs;
    const links: Array<{ label: string; href: string }> = [];
    if (typeof refs.po_number === "string") {
      links.push({ label: `PO ${refs.po_number}`, href: `/orders/${refs.po_number}` });
    }
    if (typeof refs.shipment_id === "number") {
      links.push({ label: `Shipment ${refs.shipment_id}`, href: `/logistics/${refs.shipment_id}` });
    }
    if (typeof refs.sku === "string") {
      links.push({ label: `SKU ${refs.sku}`, href: APP_ROUTES.inventory.item(refs.sku) });
    }
    return links;
  }, [data]);

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
    <div className="mx-auto max-w-7xl space-y-4">
      <Button variant="ghost" onClick={() => setLocation(APP_ROUTES.operations.exceptions)} className="w-fit">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to exceptions
      </Button>

      <DataState
        loading={loading}
        error={error}
        data={data}
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
              <CardContent className="grid gap-4 md:grid-cols-[220px_1fr_auto]">
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
                  placeholder="Assign to user"
                />
                <div className="flex gap-2">
                  <Can roles={["planner", "admin"]} reason="Requires Planner/Admin">
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() =>
                        runWithToast(async () => {
                          await updateExceptionStatus(exception.id, nextStatus);
                        })
                      }
                    >
                      Update status
                    </Button>
                  </Can>
                  <Can roles={["planner", "admin"]} reason="Requires Planner/Admin">
                    <Button
                      disabled={saving}
                      onClick={() =>
                        runWithToast(async () => {
                          await assignException(exception.id, assignee);
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
                  <Can roles={["planner", "admin"]} reason="Requires Planner/Admin">
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

            <Card>
              <CardHeader>
                <CardTitle>Related references</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {relatedLinks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No linked records</p>
                ) : (
                  relatedLinks.map((link) => (
                    <Button
                      key={link.href}
                      variant="outline"
                      className="mr-2"
                      onClick={() => setLocation(link.href)}
                    >
                      {link.label}
                    </Button>
                  ))
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
  const [detailMatch, detailParams] = useRoute<{ id: string }>("/exceptions/:id");
  if (detailMatch && detailParams?.id) {
    return <ExceptionDetailView exceptionId={detailParams.id} />;
  }
  return <ExceptionListView />;
}
