import { useEffect, useState } from "react";
import { Link, Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_ROUTES } from "@/lib/routes/app-routes";

type DevTestStatus = {
  ok: boolean;
  app: string;
  environment: string;
  authenticated: boolean;
  userEmail: string | null;
  orgId: number | null;
  recommendedEntry: string;
  recommendedLogin: string;
  routes: string[];
};

export default function DevTestPage() {
  const [status, setStatus] = useState<DevTestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/dev-test-status", { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) {
            setError(res.status === 404 ? "Dev diagnostics unavailable (not a development server or packaged build)." : `HTTP ${res.status}`);
          }
          return;
        }
        const data = (await res.json()) as DevTestStatus;
        if (!cancelled) setStatus(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Request failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!import.meta.env.DEV) {
    return <Redirect to="/" />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6" data-testid="dev-test-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">ISSSourcing — external tester landing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Development-only page. Use the public Codespaces URL or local dev server. No secrets are shown here.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button type="button" variant="secondary" size="sm" asChild>
            <a href="/dev-test-login">Start dev test session</a>
          </Button>
          <span className="text-xs text-muted-foreground">
            Server must set <code className="rounded bg-muted px-1">DEV_TEST_LOGIN_ENABLED=true</code>; uses seeded{" "}
            <code className="rounded bg-muted px-1">admin</code> only (404 if disabled).
          </span>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!status && !error ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking /dev-test-status…
        </div>
      ) : null}

      {status ? (
        <div className="space-y-4 rounded-lg border bg-card p-4 text-sm">
          <p>
            <span className="font-medium">App reachable:</span> {status.ok ? "yes" : "no"} ({status.app}, {status.environment})
          </p>
          <p>
            <span className="font-medium">Authenticated:</span> {status.authenticated ? "yes" : "no"}
          </p>
          <p>
            <span className="font-medium">User:</span> {status.userEmail ?? "—"}
          </p>
          <p>
            <span className="font-medium">Org id:</span> {status.orgId ?? "—"}
          </p>
        </div>
      ) : null}

      {status ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Quick links</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="default" size="sm" asChild>
              <a href={`${status.recommendedEntry}?redirect=${encodeURIComponent(APP_ROUTES.operations.controlTower)}`}>
                Enter control tower
              </a>
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={`${status.recommendedEntry}?redirect=${encodeURIComponent(APP_ROUTES.inventory.root)}`}>Inventory</a>
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <a
                href={`${status.recommendedEntry}?redirect=${encodeURIComponent(APP_ROUTES.procurement.orders)}`}
              >
                Procurement (POs)
              </a>
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={`${status.recommendedEntry}?redirect=${encodeURIComponent(APP_ROUTES.finance.accountsPayableIntake)}`}>
                Finance (AP)
              </a>
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={`${status.recommendedEntry}?redirect=${encodeURIComponent(APP_ROUTES.analytics.overview)}`}>
                Analytics
              </a>
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={`${status.recommendedEntry}?redirect=${encodeURIComponent(APP_ROUTES.admin.settings)}`}>Admin</a>
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <a
                href={`${status.recommendedEntry}?redirect=${encodeURIComponent(APP_ROUTES.admin.systemDiagnostics)}`}
              >
                System diagnostics
              </a>
            </Button>
          </div>

          <p className="pt-2 text-xs text-muted-foreground">
            Normal entry:{" "}
            <a className="underline" href={status.recommendedEntry}>
              {status.recommendedEntry}
            </a>
            . Optional one-click dev session (requires <code className="text-xs">DEV_TEST_LOGIN_ENABLED=true</code> on the
            server):{" "}
            <a className="underline" href={status.recommendedLogin}>
              {status.recommendedLogin}
            </a>
            .
          </p>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        In-app navigation: <Link href="/">Home</Link> · <Link href="/auth">Sign in</Link>
      </p>
    </div>
  );
}
