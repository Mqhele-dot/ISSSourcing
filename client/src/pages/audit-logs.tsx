import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { requestJson } from "@/lib/queryClient";
import { downloadCsv } from "@/lib/csv-download";
import { Download } from "lucide-react";

type ActivityLog = {
  id: number;
  createdAt: string | null;
  actor: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: Record<string, unknown> | null;
};

type ActivityPage = {
  items: ActivityLog[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
};

type ActivityFilters = {
  entityType: string;
  entityId: string;
  actor: string;
  action: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: ActivityFilters = {
  entityType: "",
  entityId: "",
  actor: "",
  action: "",
  from: "",
  to: "",
};
const EMPTY_ACTIVITY_LOGS: ActivityLog[] = [];

const ENTITY_TYPE_PRESETS = [
  { value: "any", label: "Any entity" },
  { value: "purchase_order", label: "Purchase order" },
  { value: "shipment", label: "Shipment" },
  { value: "invoice", label: "Invoice" },
  { value: "requisition", label: "Requisition" },
  { value: "supplier", label: "Supplier" },
];

export default function AuditLogsPage() {
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [actor, setActor] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [customEntityTypeMode, setCustomEntityTypeMode] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<ActivityFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ["/api/v2/activity", appliedFilters, page, pageSize],
    queryFn: () => {
      const search = new URLSearchParams();
      search.set("page", String(page));
      search.set("pageSize", String(pageSize));
      if (appliedFilters.entityType) search.set("entity_type", appliedFilters.entityType);
      if (appliedFilters.entityId) search.set("entity_id", appliedFilters.entityId);
      if (appliedFilters.actor) search.set("actor", appliedFilters.actor);
      if (appliedFilters.action) search.set("action", appliedFilters.action);
      if (appliedFilters.from) search.set("from", appliedFilters.from);
      if (appliedFilters.to) search.set("to", appliedFilters.to);
      return requestJson<ActivityPage>("GET", `/api/v2/activity?${search.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const logs = data?.items ?? EMPTY_ACTIVITY_LOGS;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const applyFilters = () => {
    setAppliedFilters({
      entityType: entityType.trim(),
      entityId: entityId.trim(),
      actor: actor.trim(),
      action: actionFilter.trim(),
      from: fromDate.trim(),
      to: toDate.trim(),
    });
    setPage(1);
  };

  const rows = useMemo(
    () =>
      logs.map((log) => [
        String(log.id),
        log.createdAt ?? "",
        log.actor ?? "",
        log.entityType ?? "",
        log.entityId ?? "",
        log.action ?? "",
        log.summary ? JSON.stringify(log.summary) : "",
      ]),
    [logs],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Audit Logs"
        subtitle="Operational activity stream (ops_activity): filter by entity, actor, action substring, and date range. Export CSV."
      />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="audit-entity-type">Entity type</Label>
            <Select
              value={
                customEntityTypeMode
                  ? "__custom__"
                  : entityType.trim() === ""
                  ? "any"
                  : ENTITY_TYPE_PRESETS.some((p) => p.value === entityType)
                    ? entityType
                    : "__custom__"
              }
              onValueChange={(v) => {
                if (v === "any") {
                  setCustomEntityTypeMode(false);
                  setEntityType("");
                }
                else if (v === "__custom__") {
                  setCustomEntityTypeMode(true);
                  setEntityType("");
                } else {
                  setCustomEntityTypeMode(false);
                  setEntityType(v);
                }
              }}
            >
              <SelectTrigger id="audit-entity-type">
                <SelectValue placeholder="Filter entity" />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPE_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value="__custom__">Custom…</SelectItem>
              </SelectContent>
            </Select>
            {customEntityTypeMode ? (
              <Input
                aria-label="Custom entity type"
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                placeholder="Type entity_type"
                className="mt-2"
              />
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-entity-id">Entity ID</Label>
            <Input
              id="audit-entity-id"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="e.g. PO-2025-001 or 123"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-actor">Actor</Label>
            <Input
              id="audit-actor"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="username/email/system"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-action">Action contains</Label>
            <Input
              id="audit-action"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              placeholder="e.g. transition, receive, invoice"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-from">From</Label>
            <Input id="audit-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-to">To</Label>
            <Input id="audit-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button className="shrink-0" onClick={applyFilters}>Apply</Button>
            <Button
              variant="outline"
              className="whitespace-nowrap"
              onClick={() =>
                downloadCsv("audit-logs.csv", [
                  ["id", "created_at", "actor", "entity_type", "entity_id", "action", "summary"],
                  ...rows,
                ])
              }
              disabled={logs.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Export current page CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entries ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading audit logs...</div>
          ) : isError ? (
            <div className="space-y-3 text-sm">
              <p className="text-destructive">Audit logs could not be loaded.</p>
              <Button variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No audit entries match the applied filters.</div>
          ) : (
            <div className="space-y-4">
            {isFetching ? <p className="text-sm text-muted-foreground" role="status">Refreshing audit logs...</p> : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{log.createdAt ? new Date(log.createdAt).toLocaleString() : "-"}</TableCell>
                    <TableCell>{log.actor}</TableCell>
                    <TableCell>
                      {log.entityType}:{log.entityId}
                    </TableCell>
                    <TableCell>{log.action}</TableCell>
                    <TableCell className="max-w-[420px]">
                      {log.summary ? (
                        <div className="space-y-1">
                          {typeof log.summary.title === "string" ? <div className="font-medium">{log.summary.title}</div> : null}
                          <div className="line-clamp-2 text-muted-foreground">
                            {typeof log.summary.details === "string"
                              ? log.summary.details
                              : Object.entries(log.summary)
                                  .filter(([key]) => key !== "title" && key !== "details" && key !== "relatedRefs")
                                  .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
                                  .join(" · ") || "Recorded event"}
                          </div>
                        </div>
                      ) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                {total === 0 ? "0 results" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="audit-page-size" className="sr-only">Rows per page</Label>
                <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
                  <SelectTrigger id="audit-page-size" className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>{[25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} rows</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)}>First</Button>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={!data?.hasNext} onClick={() => setPage((value) => value + 1)}>Next</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>Last</Button>
              </div>
            </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
