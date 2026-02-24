import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, Download } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { DataState } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/ui/status-badge";
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
import { useQueryState } from "@/hooks/use-query-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { Can } from "@/components/auth/can";
import { EntityActivityPanel } from "@/components/activity/entity-activity-panel";
import { useToast } from "@/hooks/use-toast";
import { formatMutationError } from "@/lib/queryClient";
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

function downloadCsv(filename: string, rows: string[][]) {
  const csv =
    "sep=,\n" +
    rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

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

  useEffect(() => {
    if (data && !lastRefreshedAt) {
      markRefreshed();
    }
  }, [data, lastRefreshedAt, markRefreshed]);

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

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Exceptions"
        subtitle="Control tower lifecycle management"
        breadcrumb={<span>Operations / Exceptions</span>}
      />

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
            <Input
              value={String(queryState.type || "")}
              onChange={(event) => setQueryState({ type: event.target.value })}
              placeholder="Type"
              className="w-60"
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Assignee</TableHead>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
          );
        }}
      </DataState>
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
      links.push({ label: `SKU ${refs.sku}`, href: `/inventory/${refs.sku}` });
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
      <Button variant="ghost" onClick={() => setLocation("/exceptions")} className="w-fit">
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
