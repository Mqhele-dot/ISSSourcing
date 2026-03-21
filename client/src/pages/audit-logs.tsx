import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";

type ActivityLog = {
  id: number;
  createdAt: string | null;
  actor: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: Record<string, unknown> | null;
};

const ENTITY_TYPE_PRESETS = [
  { value: "any", label: "Any entity" },
  { value: "purchase_order", label: "Purchase order" },
  { value: "shipment", label: "Shipment" },
  { value: "invoice", label: "Invoice" },
  { value: "requisition", label: "Requisition" },
  { value: "supplier", label: "Supplier" },
];

export default function AuditLogsPage() {
  const { toast } = useToast();
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [actor, setActor] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/activity", entityType, entityId, actor, actionFilter, fromDate, toDate],
    queryFn: () => {
      const search = new URLSearchParams();
      search.set("limit", "200");
      if (entityType.trim()) search.set("entity_type", entityType.trim());
      if (entityId.trim()) search.set("entity_id", entityId.trim());
      if (actor.trim()) search.set("actor", actor.trim());
      if (actionFilter.trim()) search.set("action", actionFilter.trim());
      if (fromDate.trim()) search.set("from", fromDate.trim());
      if (toDate.trim()) search.set("to", toDate.trim());
      return requestJson<ActivityLog[]>("GET", `/api/activity?${search.toString()}`);
    },
  });

  const runComplianceReminders = useMutation({
    mutationFn: () => requestJson("POST", "/api/compliance/run-reminders"),
    onSuccess: (result: any) => {
      toast({
        title: "Compliance reminders run",
        description: `Suppliers: ${result.insuranceExpiring}, Contracts: ${result.contractsExpiring}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Compliance reminders failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

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
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="audit-entity-type">Entity type</Label>
            <Select
              value={
                entityType.trim() === ""
                  ? "any"
                  : ENTITY_TYPE_PRESETS.some((p) => p.value === entityType)
                    ? entityType
                    : "__custom__"
              }
              onValueChange={(v) => {
                if (v === "any") setEntityType("");
                else if (v === "__custom__") {
                  /* Preserve manual entity_type; do not clear */
                } else setEntityType(v);
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
            <Input
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              placeholder="Or type entity_type manually"
              className="mt-1"
            />
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
          <div className="flex items-end gap-2">
            <Button onClick={() => refetch()}>Apply</Button>
            <Button
              variant="outline"
              onClick={() => runComplianceReminders.mutate()}
              disabled={runComplianceReminders.isPending}
            >
              Run reminders
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv("audit-logs.csv", [
                  ["id", "created_at", "actor", "entity_type", "entity_id", "action", "summary"],
                  ...rows,
                ])
              }
              disabled={logs.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entries ({logs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading audit logs...</div>
          ) : (
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
                    <TableCell className="max-w-[420px] truncate">
                      {log.summary ? JSON.stringify(log.summary) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
