import { Link } from "wouter";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { readinessQueryOptions, type ReadinessStatus } from "@/lib/setup-readiness-queries";

export type { ReadinessStatus };
export { fetchReadinessStatus } from "@/lib/setup-readiness-queries";

export function ReadinessBanner() {
  const { data, error, failureCount, refetch, isFetching } = useQuery({
    ...readinessQueryOptions,
    refetchInterval: 30_000,
  });

  if (error && !data) {
    const repeated = failureCount >= 2;
    return (
      <div className="sticky top-0 z-40 shrink-0 p-3">
        <Alert variant={repeated ? "destructive" : "default"} className={repeated ? "" : "border-amber-500/50 bg-amber-500/10"}>
          <AlertTitle>{repeated ? "Readiness check still failing" : "Could not reach readiness endpoint"}</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>
              {repeated
                ? "After multiple attempts, /api/ready is still unavailable. Confirm the API and database are running."
                : "This is often a brief network issue. Pages may still work; retry or continue once connectivity returns."}
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data) return null;

  const unavailable: string[] = [];
  if (!data.dbReady) unavailable.push("database");
  if (!data.schemaReady) unavailable.push("schema");
  if (!data.sessionStoreReady) unavailable.push("session store");
  if (!data.uploadPathReady) unavailable.push("uploads path");

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

  if (data.productBootstrap?.needsFirstRunOnboarding) {
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
