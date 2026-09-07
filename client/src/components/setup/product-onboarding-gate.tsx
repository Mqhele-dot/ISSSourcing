import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Link, Redirect, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAppReadinessState } from "@/hooks/use-app-readiness-state";
import type { SetupStatusPayload } from "@/lib/setup-readiness-queries";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import type { User } from "@shared/schema";
import { routeDebug } from "@/lib/route-debug";
import { pathWithoutQuery } from "@/lib/path-utils";

export type { SetupStatusPayload };

function setupAllowedPath(path: string): boolean {
  const base = pathWithoutQuery(path);
  if (base === APP_ROUTES.auth) return true;
  if (base === "/dev-test") return true;
  if (base === APP_ROUTES.training.getEducated || base.startsWith(`${APP_ROUTES.training.getEducated}/`)) return true;
  if (base === APP_ROUTES.setup.product) return true;
  if (base === APP_ROUTES.admin.systemDiagnostics) return true;
  if (base === APP_ROUTES.admin.onboarding) return true;
  return false;
}

function SetupStatusErrorPanel({
  onRetry,
  variant,
}: {
  onRetry: () => void;
  variant: "full" | "inline";
}) {
  const wrap =
    variant === "full"
      ? "mx-auto flex min-h-[40vh] max-w-lg flex-col justify-center gap-4 p-6"
      : "mx-4 mt-4 max-w-4xl";

  return (
    <div className={wrap}>
      <Alert variant="destructive">
        <AlertTitle>Could not load product setup status</AlertTitle>
        <AlertDescription className="mt-2 flex flex-col gap-3 text-sm">
          <p>
            The app cannot confirm whether first-run setup finished. This is often a short network blip or a stopped API
            process; repeated failures usually mean the database or migrations need attention. You can keep using the app
            in a limited mode—retry below or open diagnostics. Some actions may fail until the check succeeds.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => onRetry()}>
              Retry
            </Button>
            <Button type="button" size="sm" variant="outline" asChild>
              <Link href={APP_ROUTES.admin.systemDiagnostics}>Open system diagnostics</Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}

function WithNonAdminSetupBanner({
  setup,
  path,
  user,
  children,
}: {
  setup: SetupStatusPayload;
  path: string;
  user: User | null | undefined;
  children: ReactNode;
}) {
  const show =
    setup.onboarding.required &&
    user &&
    user.role !== "admin" &&
    pathWithoutQuery(path) !== APP_ROUTES.auth &&
    path !== APP_ROUTES.setup.product;

  if (!show) return <>{children}</>;

  return (
    <>
      <Alert className="mx-4 mt-3 max-w-4xl border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTitle>Setup not complete</AlertTitle>
        <AlertDescription className="text-sm">
          An administrator must finish the product wizard at{" "}
          <Link href={APP_ROUTES.setup.product} className="font-medium underline">
            {APP_ROUTES.setup.product}
          </Link>
          . If something looks stuck, open{" "}
          <Link href={APP_ROUTES.admin.systemDiagnostics} className="font-medium underline">
            system diagnostics
          </Link>
          .
        </AlertDescription>
      </Alert>
      {children}
    </>
  );
}

function ProductOnboardingGateAfterAuth({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const pathBase = pathWithoutQuery(path);
  const { user, isLoading: authLoading } = useAuth();

  const {
    phase,
    setupQueryActive,
    readinessProbeFailed,
    ready,
    setup,
    readyPending,
    readyError,
    setupPending,
    setupError,
    setupFetched,
    setupFetching,
    refetchReadiness,
    retrySetupStatus,
  } = useAppReadinessState();

  const needsFirstRunLatchRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!readyPending && !readyError && ready != null) {
      needsFirstRunLatchRef.current = Boolean(ready.productBootstrap?.needsFirstRunOnboarding);
    }
  }, [readyPending, readyError, ready]);

  const setupProbeWaiting =
    setupQueryActive && ((setupPending && !setupError) || (!setupFetched && !setupError));

  if (authLoading || (readyPending && !readyError) || setupProbeWaiting) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <span>Checking product setup…</span>
      </div>
    );
  }

  const needsOrgLive =
    !readyPending && !readyError && Boolean(ready?.productBootstrap?.needsFirstRunOnboarding);
  const needsOrg = needsFirstRunLatchRef.current === true || needsOrgLive;
  if (needsOrg && pathBase !== APP_ROUTES.admin.onboarding) {
    routeDebug("gate.redirect-onboarding", { path: pathBase, phase, needsOrgLive });
    return <Redirect to={APP_ROUTES.admin.onboarding} />;
  }

  const readinessWarning = readinessProbeFailed ? (
    <div className="mx-4 mt-3 max-w-4xl">
      <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100">
        <AlertTitle>Could not verify public readiness</AlertTitle>
        <AlertDescription className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>
            The lightweight <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/ready</code> check failed
            (often offline or a slow network). You can retry; the app will still enforce setup using{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/setup/status</code> when available.
          </span>
          <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => void refetchReadiness()}>
            Retry readiness
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  ) : null;

  const setupStatusFailed = phase === "setup_check_temporarily_failed";
  const setupFailureUi = setupStatusFailed ? (
    <SetupStatusErrorPanel variant="inline" onRetry={retrySetupStatus} />
  ) : null;

  if (setupStatusFailed) {
    return (
      <>
        {readinessWarning}
        {setupFailureUi}
        {children}
      </>
    );
  }

  /** Only treat missing setup as failure after an authenticated fetch completed (avoids false errors while query is disabled). */
  if (setupQueryActive && setupFetched && !setup) {
    return (
      <>
        {readinessWarning}
        <SetupStatusErrorPanel variant="inline" onRetry={retrySetupStatus} />
        {children}
      </>
    );
  }

  if (!setup) {
    return (
      <>
        {readinessWarning}
        {children}
      </>
    );
  }

  if (setup.skipProductOnboarding || !setup.onboarding.required) {
    if (setup.skipProductOnboarding && !setup.onboarding.completedAt) {
      return (
        <WithNonAdminSetupBanner setup={setup} path={pathBase} user={user}>
          {readinessWarning}
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
        </WithNonAdminSetupBanner>
      );
    }
    return (
      <WithNonAdminSetupBanner setup={setup} path={pathBase} user={user}>
        {readinessWarning}
        {children}
      </WithNonAdminSetupBanner>
    );
  }

  if (!setupAllowedPath(pathBase)) {
    /** Avoid redirecting while a setup refetch is in flight — reduces flicker if `onboarding.required` momentarily disagrees. */
    if (setupFetching) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          <span>Confirming product setup…</span>
        </div>
      );
    }
    routeDebug("gate.redirect-setup", { path: pathBase, phase, setupFetching });
    return <Redirect to={APP_ROUTES.setup.product} />;
  }

  return (
    <WithNonAdminSetupBanner setup={setup} path={pathBase} user={user}>
      {readinessWarning}
      {children}
    </WithNonAdminSetupBanner>
  );
}

export function ProductOnboardingGate({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const pathBase = pathWithoutQuery(path);
  if (
    pathBase === APP_ROUTES.auth ||
    pathBase === "/dev-test" ||
    pathBase === APP_ROUTES.training.getEducated ||
    pathBase.startsWith(`${APP_ROUTES.training.getEducated}/`)
  ) {
    return <>{children}</>;
  }
  return <ProductOnboardingGateAfterAuth>{children}</ProductOnboardingGateAfterAuth>;
}
