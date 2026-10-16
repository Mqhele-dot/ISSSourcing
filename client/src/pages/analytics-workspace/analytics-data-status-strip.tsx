import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import type { AnalyticsSourceId } from "./use-analytics-workspace-queries";

export type AnalyticsSourceStatus = {
  id: AnalyticsSourceId;
  label: string;
  isLoading: boolean;
  isError: boolean;
};

type Props = {
  sources: AnalyticsSourceStatus[];
  onRetryAll: () => void;
};

export function AnalyticsDataStatusStrip({ sources, onRetryAll }: Props) {
  return (
    <div
      className="mb-4 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
      data-testid="analytics-data-status-strip"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Data feeds for this workspace</p>
        <div className="flex flex-wrap gap-1.5">
          {sources.map((s) => {
            const variant = s.isLoading ? "secondary" : s.isError ? "destructive" : "outline";
            const label = s.isLoading ? "Loading" : s.isError ? "Unavailable" : "OK";
            return (
              <Badge
                key={s.id}
                variant={variant}
                className={
                  !s.isLoading && !s.isError
                    ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
                    : undefined
                }
              >
                <span className="mr-1 font-normal text-muted-foreground">{s.label}:</span>
                {label}
              </Badge>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          “—” on a card means the feed failed, not necessarily zero. “No data” means the API responded but has no rows
          yet.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onRetryAll}>
          Retry all feeds
        </Button>
        <Button type="button" size="sm" variant="outline" asChild>
          <Link href={APP_ROUTES.admin.systemDiagnostics}>System diagnostics</Link>
        </Button>
      </div>
    </div>
  );
}
