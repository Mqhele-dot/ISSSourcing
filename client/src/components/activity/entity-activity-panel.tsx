import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataState } from "@/components/ui/data-state";
import { Badge } from "@/components/ui/badge";
import { fetchActivityEnvelope } from "@/api/client";
import type { FallbackKind } from "@/components/ui/data-state";

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function summaryText(summary: Record<string, unknown>) {
  if (typeof summary.message === "string" && summary.message.length > 0) {
    return summary.message;
  }
  if (typeof summary.details === "string" && summary.details.length > 0) {
    return summary.details;
  }
  if (typeof summary.reason === "string" && summary.reason.length > 0) {
    return summary.reason;
  }
  return JSON.stringify(summary);
}

type EntityActivityPanelProps = {
  entityType: string;
  entityId: string | number;
  title?: string;
  /** Capped server-side at 100; default 20 for entity panels */
  limit?: number;
};

export function EntityActivityPanel({
  entityType,
  entityId,
  title = "Activity",
  limit = 20,
}: EntityActivityPanelProps) {
  const entityIdStr = String(entityId ?? "").trim();
  const enabled = Boolean(entityType?.trim() && entityIdStr.length > 0);

  const { isLoading, isFetching, error, data: envelope, refetch } = useQuery({
    queryKey: ["activity", "ops", entityType.trim().toLowerCase(), entityIdStr, limit],
    queryFn: () =>
      fetchActivityEnvelope({
        limit,
        entityType: entityType.trim(),
        entityId: entityIdStr,
      }),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    gcTime: 5 * 60_000,
  });

  const data = envelope?.data ?? null;
  const fallback = envelope?.meta?.fallback as FallbackKind | undefined;
  const loading = enabled && (isLoading || isFetching);

  if (!enabled) {
    return (
      <Card data-testid="entity-activity-panel-disabled">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Activity requires a linked record reference.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="entity-activity-panel">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <DataState
          loading={loading}
          error={error instanceof Error ? error : error ? new Error(String(error)) : null}
          data={data}
          isEmpty={(items) => items.length === 0}
          emptyTitle="No activity recorded"
          emptyDescription="Actions for this record will appear here."
          emptyTestId="entity-activity-empty"
          fallback={fallback}
          onRetry={() => void refetch()}
        >
          {(items) => (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="rounded-md border border-border p-3" data-testid="entity-activity-row">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{item.action}</Badge>
                      <span className="text-sm font-medium">{item.actor || "system"}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{summaryText(item.summary)}</p>
                </div>
              ))}
            </div>
          )}
        </DataState>
      </CardContent>
    </Card>
  );
}
