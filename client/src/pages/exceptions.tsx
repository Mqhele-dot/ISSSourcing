import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { useQueryState } from "@/hooks/use-query-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import {
  addExceptionComment,
  assignException,
  fetchException,
  fetchExceptions,
  updateExceptionStatus,
  type OperationalException,
} from "@/api/client";

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function ExceptionListView() {
  const [, setLocation] = useLocation();
  const { queryState, setQueryState } = useQueryState({
    severity: "",
    status: "",
    type: "",
  });

  const fetcher = async (): Promise<OperationalException[]> =>
    fetchExceptions({
      severity: String(queryState.severity || ""),
      status: String(queryState.status || ""),
      type: String(queryState.type || ""),
    });

  const { loading, error, data, refetch } = useAsyncResource(fetcher);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Exceptions"
        subtitle="Control tower lifecycle management"
        breadcrumb={<span>Operations / Exceptions</span>}
      />

      <Toolbar
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
          <Button variant="outline" onClick={refetch}>
            Refresh
          </Button>
        }
      />

      <DataState
        loading={loading}
        error={error}
        data={data}
        isEmpty={(exceptions) => exceptions.length === 0}
        emptyTitle="No exceptions found"
        emptyDescription="No issues match the current filters."
        onRetry={refetch}
      >
        {(exceptions) => (
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
              {exceptions.map((exception) => (
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
        )}
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

  const fetcher = async (): Promise<OperationalException> => fetchException(exceptionId);
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

  const runWithToast = async (action: () => Promise<void>, successMessage: string) => {
    setSaving(true);
    try {
      await action();
      await refetch();
      toast({
        title: "Updated",
        description: successMessage,
      });
    } catch (updateError) {
      toast({
        title: "Update failed",
        description: updateError instanceof Error ? updateError.message : "Request failed",
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
                  <Button
                    variant="outline"
                    disabled={saving}
                    onClick={() =>
                      runWithToast(
                        async () => {
                          await updateExceptionStatus(exception.id, nextStatus);
                        },
                        `Status moved to ${nextStatus}`,
                      )
                    }
                  >
                    Update status
                  </Button>
                  <Button
                    disabled={saving}
                    onClick={() =>
                      runWithToast(
                        async () => {
                          await assignException(exception.id, assignee);
                        },
                        assignee ? `Assigned to ${assignee}` : "Assignment cleared",
                      )
                    }
                  >
                    Assign
                  </Button>
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
                  <Button
                    disabled={saving || !comment.trim()}
                    onClick={() =>
                      runWithToast(
                        async () => {
                          await addExceptionComment(exception.id, comment);
                          setComment("");
                        },
                        "Comment added",
                      )
                    }
                  >
                    Post
                  </Button>
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
