import { Link } from "wouter";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { APP_ROUTES } from "@/lib/routes/app-routes";

export type ReadinessStatus = {
  dbReady: boolean;
  schemaReady: boolean;
  sessionStoreReady: boolean;
  websocketReady: boolean;
  uploadPathReady: boolean;
  emailServiceReady: boolean;
  deploymentMode?: string;
  build?: {
    version?: string;
    runtimeProfile?: string;
    deploymentMode?: string;
    commitSha?: string | null;
    buildId?: string | null;
    builtAt?: string | null;
  };
  /** Present when the API could query install state (packaged / first-run hints). */
  productBootstrap?: {
    organizationCount: number;
    needsFirstRunOnboarding: boolean;
  } | null;
};

export async function fetchReadinessStatus(): Promise<ReadinessStatus> {
  const res = await fetch("/api/ready", { credentials: "include" });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new Error("Invalid JSON from /api/ready");
  }
  if (!res.ok) {
    throw new Error(`Readiness check failed (HTTP ${res.status})`);
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    parsed !== null &&
    "ok" in parsed &&
    (parsed as { ok?: unknown }).ok === true &&
    "data" in parsed
  ) {
    return (parsed as { data: ReadinessStatus }).data;
  }
  return parsed as ReadinessStatus;
}

export function ReadinessBanner() {
  const { data, error } = useQuery<ReadinessStatus>({
    queryKey: ["/api/ready"],
    queryFn: fetchReadinessStatus,
    retry: false,
    refetchInterval: 30_000,
  });

  if (error) {
    return (
      <div className="sticky top-0 z-40 shrink-0 p-3">
        <Alert variant="destructive">
          <AlertTitle>System readiness check failed</AlertTitle>
          <AlertDescription>
            Unable to verify backend health. If pages fail to load, confirm the API server and database are running.
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
