import type { ReactNode } from "react";
import { Link, Redirect, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { fetchReadinessStatus } from "@/app/app-readiness-banner";
import { requestJson } from "@/lib/queryClient";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type SetupStatusPayload = {
  deploymentMode: string;
  runtimeProfile: string;
  skipProductOnboarding: boolean;
  allowSetupSkip?: boolean;
  onboarding: {
    completedAt: string | null;
    required: boolean;
    adminMayContinue: boolean;
    checkpoint: unknown;
  };
  productBootstrap?: { organizationCount: number; needsFirstRunOnboarding: boolean } | null;
  organization: { id: number; name: string; slug: string | null } | null;
  uploads?: { pathReady: boolean; path?: string; writable?: boolean };
  exports?: { pathReady: boolean; path?: string; writable?: boolean };
  diagnostics?: {
    drizzleMigrationCount: number | null;
    lastExportFailure: { id: number; lastError: string; updatedAt: string } | null;
  };
};

function isAuthPath(path: string): boolean {
  return path === APP_ROUTES.auth || path.startsWith(`${APP_ROUTES.auth}?`);
}

function setupAllowedPath(path: string): boolean {
  if (isAuthPath(path)) return true;
  if (path === APP_ROUTES.setup.product) return true;
  if (path === APP_ROUTES.admin.systemDiagnostics) return true;
  if (path === APP_ROUTES.admin.onboarding) return true;
  return false;
}

async function fetchSetupStatus(): Promise<SetupStatusPayload> {
  return requestJson<SetupStatusPayload>("GET", "/api/setup/status");
}

export function ProductOnboardingGate({ children }: { children: ReactNode }) {
  const [path] = useLocation();

  const { data: ready, isLoading: readyLoading } = useQuery({
    queryKey: ["/api/ready"],
    queryFn: fetchReadinessStatus,
    staleTime: 15_000,
    retry: false,
  });

  const { data: setup, isLoading: setupLoading, isError: setupError } = useQuery({
    queryKey: ["/api/setup/status"],
    queryFn: fetchSetupStatus,
    staleTime: 10_000,
    retry: 1,
  });

  if (isAuthPath(path)) {
    return <>{children}</>;
  }

  if (readyLoading || (setupLoading && !setupError)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <span>Checking product setup…</span>
      </div>
    );
  }

  const needsOrg = Boolean(ready?.productBootstrap?.needsFirstRunOnboarding);
  if (needsOrg && path !== APP_ROUTES.admin.onboarding) {
    return <Redirect to={APP_ROUTES.admin.onboarding} />;
  }

  if (setupError || !setup) {
    return <>{children}</>;
  }

  if (setup.skipProductOnboarding || !setup.onboarding.required) {
    if (setup.skipProductOnboarding && !setup.onboarding.completedAt) {
      return (
        <>
          <Alert className="mx-4 mt-4 max-w-4xl border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertTitle>Product onboarding bypassed</AlertTitle>
            <AlertDescription className="text-sm">
              <code className="rounded bg-muted px-1 py-0.5 text-xs">SKIP_PRODUCT_ONBOARDING</code> is enabled but the
              wizard has not been completed in the database. For upgrades, see{" "}
              <span className="font-mono text-xs">docs/CHANGELOG-INSTALLABLE-PRODUCT.md</span> in your deployment bundle
              for SQL options, or finish setup at{" "}
              <Link href={APP_ROUTES.setup.product} className="font-medium underline">
                {APP_ROUTES.setup.product}
              </Link>
              .
            </AlertDescription>
          </Alert>
          {children}
        </>
      );
    }
    return <>{children}</>;
  }

  if (!setupAllowedPath(path)) {
    return <Redirect to={APP_ROUTES.setup.product} />;
  }

  return <>{children}</>;
}
