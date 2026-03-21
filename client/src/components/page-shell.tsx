import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Top toolbar row (filters, actions) — composes with PageHeader */
export function PageToolbar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between", className)}>
      {children}
    </div>
  );
}

export function PageFilters({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function PageSection({
  className,
  title,
  description,
  children,
}: {
  className?: string;
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {title ? (
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

type PageDataStateProps = {
  isLoading: boolean;
  error: Error | null;
  isEmpty: boolean;
  loadingView?: ReactNode;
  emptyView: ReactNode;
  errorTitle?: string;
  onRetry?: () => void;
  children: ReactNode;
};

/**
 * Explicit three-state list pattern: loading / error / empty / data.
 * Prefer this over catch → [] on list pages.
 */
export function PageDataState({
  isLoading,
  error,
  isEmpty,
  loadingView,
  emptyView,
  errorTitle = "Something went wrong",
  onRetry,
  children,
}: PageDataStateProps) {
  if (isLoading) {
    return <>{loadingView ?? <div className="py-12 text-center text-muted-foreground">Loading…</div>}</>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center space-y-3">
        <p className="font-medium text-destructive">{errorTitle}</p>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }
  if (isEmpty) {
    return <>{emptyView}</>;
  }
  return <>{children}</>;
}
