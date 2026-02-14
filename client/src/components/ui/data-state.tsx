import type React from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

type DataStateProps<T> = {
  loading: boolean;
  error: Error | null;
  data: T | null;
  isEmpty: (data: T) => boolean;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  onRetry?: () => void;
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
        description={
          import.meta.env.DEV
            ? `${error.message}`
            : "We could not load this data right now."
        }
        action={
          onRetry ? (
            <Button onClick={onRetry} variant="outline" size="sm">
              Retry
            </Button>
          ) : null
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
