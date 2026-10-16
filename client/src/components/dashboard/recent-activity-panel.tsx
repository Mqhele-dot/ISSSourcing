import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ControlTowerDashboardData } from "@/api/types";

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

type RecentActivityPanelProps = {
  items: ControlTowerDashboardData["recentActivity"];
};

export function RecentActivityPanel({ items }: RecentActivityPanelProps) {
  return (
    <Card data-testid="dashboard-recent-activity-panel">
      <CardHeader>
        <CardTitle className="text-base">Recent activity</CardTitle>
        <p className="text-sm text-muted-foreground">
          Latest operational events (limited load; not a full audit trail).
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity rows.</p>
        ) : (
          items.map((row) => (
            <div
              key={row.id}
              data-testid="dashboard-activity-row"
              className="rounded-md border p-3 text-sm space-y-1"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{row.action}</Badge>
                <span className="text-xs font-medium text-muted-foreground">
                  {row.entityType} · {row.entityId}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{row.summary || "—"}</p>
              <p className="text-[11px] text-muted-foreground">
                {row.actor} · {formatTime(row.createdAt)}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
