import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataState } from "@/components/ui/data-state";
import { Badge } from "@/components/ui/badge";
import { useAsyncResource } from "@/hooks/use-async-resource";
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
  limit?: number;
};

export function EntityActivityPanel({
  entityType,
  entityId,
  title = "Activity",
  limit = 20,
}: EntityActivityPanelProps) {
  const fetcher = async () =>
    fetchActivityEnvelope({
      limit,
      entityType,
      entityId,
    });

  const { loading, error, data: envelope, refetch } = useAsyncResource(fetcher);
  const data = envelope?.data ?? null;
  const fallback = envelope?.meta?.fallback as FallbackKind | undefined;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <DataState
          loading={loading}
          error={error}
          data={data}
          isEmpty={(items) => items.length === 0}
          emptyTitle="No activity recorded"
          emptyDescription="Actions for this record will appear here."
          fallback={fallback}
          onRetry={refetch}
        >
          {(items) => (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="rounded-md border border-border p-3">
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
