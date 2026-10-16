import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { normalizeApiList, requestJson } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type HistoryRow = {
  id: number;
  action: string;
  level: number;
  performedBy: number;
  comment: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  performedAt: string;
};

type UserRow = { id: number; username: string; fullName?: string | null; role?: string | null };

export function ApprovalHistoryCard({
  entityType,
  entityId,
  title = "Approval history",
}: {
  entityType: string;
  entityId: number;
  title?: string;
}) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["/api/approval-history", entityType, entityId],
    queryFn: () =>
      requestJson<HistoryRow[]>("GET", `/api/approval-history/${entityType}/${entityId}`),
    enabled: entityId > 0 && Boolean(entityType),
  });

  const { data: usersRaw } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/users");
      return normalizeApiList<UserRow>(raw);
    },
    enabled: entityId > 0,
  });

  const userLabel = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of usersRaw ?? []) {
      const label = [u.fullName, u.username].filter(Boolean).join(" · ") || `User #${u.id}`;
      map.set(u.id, label);
    }
    return map;
  }, [usersRaw]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">
          Policy-driven approvals write here when you approve or reject in the app (Postgres).
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading history…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approval events recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Comment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows
                .slice()
                .sort((a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime())
                .map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(row.performedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{row.action}</TableCell>
                    <TableCell>{row.level}</TableCell>
                    <TableCell>{userLabel.get(row.performedBy) ?? `#${row.performedBy}`}</TableCell>
                    <TableCell className="text-xs">
                      {row.previousStatus ?? "—"} → {row.newStatus ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {row.comment ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
