import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requestJson } from "@/lib/queryClient";
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

function downloadCsv(filename: string, rows: string[][]) {
  const escaped = rows.map((row) =>
    row
      .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
      .join(","),
  );
  const csv = "sep=,\n" + escaped.join("\n");
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

export default function AuditLogsPage() {
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/activity", entityType, entityId],
    queryFn: () => {
      const search = new URLSearchParams();
      search.set("limit", "200");
      if (entityType.trim()) search.set("entity_type", entityType.trim());
      if (entityId.trim()) search.set("entity_id", entityId.trim());
      return requestJson<ActivityLog[]>("GET", `/api/activity?${search.toString()}`);
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
        subtitle="Review and export sensitive action history across entities."
      />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="audit-entity-type">Entity type</Label>
            <Input
              id="audit-entity-type"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              placeholder="e.g. purchase_order, invoice"
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
          <div className="flex items-end gap-2">
            <Button onClick={() => refetch()}>Apply</Button>
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
