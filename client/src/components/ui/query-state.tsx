import type React from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export type QueryStateProps = {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void | Promise<unknown>;
  children: React.ReactNode;
  /** Optional extra action next to Retry (e.g. "Go back" link) */
  errorAction?: React.ReactNode;
};

/**
 * Renders loading spinner, or error message + Retry, or children.
 * Use with useQuery so pages don't "load forever" without error feedback.
 */
export function QueryState({
  isLoading,
  isError,
  error,
  refetch,
  children,
  errorAction,
}: QueryStateProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card p-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (isError && error) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-5 w-5" />}
        title="Something went wrong"
        description={error.message}
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => refetch()} variant="outline" size="sm">
              Retry
            </Button>
            {errorAction ?? null}
          </div>
        }
      />
    );
  }

  return <>{children}</>;
}
