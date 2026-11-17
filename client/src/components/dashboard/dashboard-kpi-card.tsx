import type { ReactNode } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type DashboardKpiStatus = "neutral" | "good" | "warn" | "critical";

type DashboardKpiCardProps = {
  title: string;
  value: ReactNode;
  description: string;
  href: string;
  testId: string;
  status?: DashboardKpiStatus;
  trendLabel?: string | null;
  icon?: ReactNode;
};

const statusRing: Record<DashboardKpiStatus, string> = {
  neutral: "border-border",
  good: "border-emerald-500/40",
  warn: "border-amber-500/50",
  critical: "border-destructive/60",
};

export function DashboardKpiCard({
  title,
  value,
  description,
  href,
  testId,
  status = "neutral",
  trendLabel,
  icon,
}: DashboardKpiCardProps) {
  return (
    <Link href={href}>
      <Card
        data-testid={testId}
        className={cn(
          "h-full cursor-pointer transition-colors hover:bg-muted/40 border-l-4",
          statusRing[status],
        )}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium leading-tight">{title}</CardTitle>
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold tabular-nums">{value}</div>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
          {trendLabel ? <p className="mt-1 text-xs font-medium text-muted-foreground">{trendLabel}</p> : null}
        </CardContent>
      </Card>
    </Link>
  );
}
