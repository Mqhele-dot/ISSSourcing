import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type DashboardChartCardProps = {
  title: string;
  helper: string;
  testId: string;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  children: ReactNode;
};

export function DashboardChartCard({
  title,
  helper,
  testId,
  loading,
  error,
  onRetry,
  children,
}: DashboardChartCardProps) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{helper}</CardDescription>
      </CardHeader>
      <CardContent className="min-h-[220px]">
        {loading ? (
          <div className="space-y-2 pt-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">This chart could not be loaded.</p>
            <p className="mt-1 text-muted-foreground">{error.message}</p>
            {onRetry ? (
              <button
                type="button"
                className="mt-3 text-xs font-medium text-primary underline"
                onClick={() => onRetry()}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
