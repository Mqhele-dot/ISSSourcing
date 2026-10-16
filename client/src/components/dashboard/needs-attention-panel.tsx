import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ControlTowerDashboardData } from "@/api/types";
import { cn } from "@/lib/utils";

type NeedsAttentionPanelProps = {
  items: ControlTowerDashboardData["needsAttention"];
  areaFilter: string;
};

function severityVariant(sev: string): "default" | "secondary" | "destructive" | "outline" {
  if (sev === "high") return "destructive";
  if (sev === "medium") return "secondary";
  return "outline";
}

export function NeedsAttentionPanel({ items, areaFilter }: NeedsAttentionPanelProps) {
  const filtered =
    areaFilter === "all"
      ? items
      : items.filter((i) => i.area === areaFilter || i.area === "operations");

  return (
    <Card data-testid="dashboard-needs-attention-panel">
      <CardHeader>
        <CardTitle className="text-base">Needs attention</CardTitle>
        <p className="text-sm text-muted-foreground">
          Actionable issues ranked for triage. Follow links to resolve in the source module.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No urgent items in this view.</p>
        ) : (
          filtered.map((item) => (
            <Link key={item.id} href={item.href}>
              <div
                data-testid="dashboard-action-item"
                className={cn(
                  "flex flex-col gap-1 rounded-md border p-3 text-sm transition-colors hover:bg-muted/50",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.title}</span>
                  <Badge variant={severityVariant(item.severity)}>{item.severity}</Badge>
                  <span className="text-xs uppercase text-muted-foreground">{item.area}</span>
                </div>
                <p className="text-xs text-muted-foreground">{item.reason}</p>
              </div>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
