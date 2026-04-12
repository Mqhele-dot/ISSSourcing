import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { PageShellVariant } from "@/lib/layout/layout-capabilities";
import { getFallbackState, subscribeFallbackState } from "@/lib/fallback-store";
import { cn } from "@/lib/utils";

const PAGE_SHELL_VARIANTS: Record<PageShellVariant, string> = {
  standard: "mx-auto w-full max-w-7xl space-y-6",
  "wide-table": "mx-auto w-full max-w-[min(100%,96rem)] space-y-6",
  "task-mode": "mx-auto flex w-full max-w-5xl flex-col gap-4",
  "analytics-mode": "mx-auto w-full max-w-[min(100%,90rem)] space-y-6",
};

export function PageShell({
  variant = "standard",
  className,
  children,
}: {
  variant?: PageShellVariant;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn(PAGE_SHELL_VARIANTS[variant], className)}>{children}</div>;
}

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
  /** When the list is empty and the API reported degraded mode, show a banner above the empty state (e.g. strict list pages). */
  warnEmptyWhenDegraded?: boolean;
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
  warnEmptyWhenDegraded = false,
  children,
}: PageDataStateProps) {
  const [globalFallback, setGlobalFallback] = useState<string | null>(() => getFallbackState().fallback);
  useEffect(() => subscribeFallbackState((s) => setGlobalFallback(s.fallback)), []);

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
    const showDegraded = warnEmptyWhenDegraded && globalFallback;
    return (
      <>
        {showDegraded ? (
          <Alert className="mb-4 border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/25">
            <AlertTitle>Data may be incomplete</AlertTitle>
            <AlertDescription>
              Operations are degraded ({globalFallback}). This list may be empty because the response was truncated or
              defaulted—retry or check connectivity.
            </AlertDescription>
          </Alert>
        ) : null}
        {emptyView}
      </>
    );
  }
  return <>{children}</>;
}
