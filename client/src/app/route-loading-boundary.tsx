import React, { Suspense, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { routeDebug } from "@/lib/route-debug";
import { addDiagnosticEvent } from "@/lib/diagnostics/diagnostics-store";

const ROUTE_LOAD_TIMEOUT_MS = 12_000;

export function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] flex-col gap-4 p-4 md:p-6" aria-busy="true" aria-label="Loading page">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        <span>Loading page…</span>
      </div>
      <div className="grid gap-3 max-w-3xl">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 pt-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}

function RouteFallbackWithTimeout() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), ROUTE_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, []);
  if (slow) {
    return (
      <div className="flex min-h-[40vh] flex-col gap-4 p-4 md:p-6 max-w-xl">
        <Alert>
          <AlertTitle>This page is taking longer than expected</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-3 text-sm">
            <p>
              The screen did not finish loading. On slow networks or remote dev environments, chunk downloads may stall.
              Try again, or reload the tab.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" className="gap-2" onClick={() => window.location.reload()}>
                <RefreshCw className="h-4 w-4" />
                Reload
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  return <RouteFallback />;
}

type ErrorBoundaryState = { error: Error | null };

class RouteChunkErrorBoundary extends React.Component<
  { children: React.ReactNode; onRetry: () => void },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; onRetry: () => void }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const hint =
      "Lazy route failed to load or run. This is a localized error (not necessarily a full app reload). " +
      "Use Try again or Reload app; check the Network tab for failed chunk requests (often 401/502 on forwarded dev ports).";
    addDiagnosticEvent({
      severity: "critical",
      source: "route",
      title: "Route failed to load",
      message: error.message || "A lazy-loaded route failed to load or render.",
      stack: error.stack,
      details: {
        hint,
        componentStack: info.componentStack,
      },
      userAction: "Try again, reload the app, or check forwarded dev port auth/chunk requests.",
    });
    console.error("[RouteChunkErrorBoundary]", hint, error.message, info.componentStack);
    routeDebug("route.chunk-error", { message: error.message, stack: info.componentStack?.slice(0, 500) });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[40vh] flex-col items-start gap-4 p-4 md:p-6 max-w-xl">
          <Alert variant="destructive">
            <AlertTitle>Could not load this page</AlertTitle>
            <AlertDescription className="mt-2 flex flex-col gap-3 text-sm">
              <p>{this.state.error.message || "A lazy-loaded module failed to run."}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" className="gap-2" onClick={() => this.props.onRetry()}>
                  <RefreshCw className="h-4 w-4" />
                  Try again
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
                  Reload app
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    return this.props.children;
  }
}

export function RouteLoadingBoundary({ children }: { children: React.ReactNode }) {
  const [boundaryKey, setBoundaryKey] = useState(0);
  return (
    <RouteChunkErrorBoundary key={boundaryKey} onRetry={() => setBoundaryKey((k) => k + 1)}>
      <Suspense fallback={<RouteFallbackWithTimeout />}>{children}</Suspense>
    </RouteChunkErrorBoundary>
  );
}
