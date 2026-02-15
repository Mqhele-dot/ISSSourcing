import type React from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

function formatErrorMessage(error: Error) {
  const coded = error as Error & { code?: string; hint?: string };
  const codePart = coded.code ? `[${coded.code}] ` : "";
  const hintPart = coded.hint ? ` (${coded.hint})` : "";
  return `${codePart}${error.message}${hintPart}`;
}

type DataStateProps<T> = {
  loading: boolean;
  error: Error | null;
  data: T | null;
  isEmpty: (data: T) => boolean;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  onRetry?: () => void;
  /** Shown next to Retry when there is an error (e.g. "Go back" link) */
  errorAction?: React.ReactNode;
  children: (data: T) => React.ReactNode;
};

export function DataState<T>({
  loading,
  error,
  data,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onRetry,
  errorAction,
  children,
}: DataStateProps<T>) {
  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-card p-8">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-5 w-5" />}
        title="Something went wrong"
        description={formatErrorMessage(error)}
        action={
          <div className="flex flex-wrap gap-2">
            {onRetry ? (
              <Button onClick={onRetry} variant="outline" size="sm">
                Retry
              </Button>
            ) : null}
            {errorAction ?? null}
          </div>
        }
      />
    );
  }

  if (!data || isEmpty(data)) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return <>{children(data)}</>;
}
