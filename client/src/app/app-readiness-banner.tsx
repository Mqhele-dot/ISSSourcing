import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { readinessQueryOptions, type ReadinessStatus } from "@/lib/setup-readiness-queries";
import { useAppReadinessState } from "@/hooks/use-app-readiness-state";

export type { ReadinessStatus };
export { fetchReadinessStatus } from "@/lib/setup-readiness-queries";

export function ReadinessBanner() {
  useQuery({
    ...readinessQueryOptions,
    refetchInterval: 30_000,
  });

  const {
    phase,
    setupQueryActive,
    readinessProbeFailed,
    setupProbeFailed,
    ready,
    refetchReadiness,
    readinessFetching,
    setupFetching,
    retrySetupStatus,
  } = useAppReadinessState();

  const setupStatusBanner =
    setupQueryActive && (phase === "setup_check_temporarily_failed" || setupProbeFailed);

  if (setupStatusBanner) {
    return (
      <div className="sticky top-0 z-40 shrink-0 p-3">
        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100">
          <AlertTitle>Product setup status unavailable</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>
              The app could not load <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/setup/status</code>.
              You can continue with limited assurance—retry or open diagnostics if this persists.
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0"
              disabled={setupFetching}
              onClick={() => void retrySetupStatus()}
            >
              Retry setup check
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (readinessProbeFailed && !ready) {
    return (
      <div className="sticky top-0 z-40 shrink-0 p-3">
        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100">
          <AlertTitle>Could not reach readiness endpoint</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>
              This is often a brief network issue. Pages may still work; retry or continue once connectivity returns.
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0"
              disabled={readinessFetching}
              onClick={() => void refetchReadiness()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!ready) return null;

  const unavailable: string[] = [];
  if (!ready.dbReady) unavailable.push("database");
  if (!ready.schemaReady) unavailable.push("schema");
  if (!ready.sessionStoreReady) unavailable.push("session store");
  if (!ready.uploadPathReady) unavailable.push("uploads path");

  if (unavailable.length > 0) {
    return (
      <div className="sticky top-0 z-40 shrink-0 p-3">
        <Alert variant="destructive">
          <AlertTitle>Limited mode: backend is not fully ready</AlertTitle>
          <AlertDescription>
            Unavailable: {unavailable.join(", ")}. Check database connectivity, run migrations, and seed demo data.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (ready.productBootstrap?.needsFirstRunOnboarding) {
    return (
      <div className="sticky top-0 z-40 shrink-0 p-3">
        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100">
          <AlertTitle>First-run setup</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              No organization record was found. Admins can create the first tenant below, or run migrations plus seed
              data for a demo environment.
            </span>
            <Button asChild size="sm" variant="secondary" className="shrink-0">
              <Link href={APP_ROUTES.admin.onboarding}>Open organization setup</Link>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return null;
}
