import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, LockKeyhole } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageShell } from "@/components/page-shell";
import { requestJson } from "@/lib/queryClient";

type ProductionArea = "inventory" | "receiving" | "logistics" | "finance" | "mobile_operations";

type ReleaseScope = {
  productionRuntime: boolean;
  previewMode: boolean;
  modules: Record<string, boolean>;
  message: string;
};

export function withProductionBoundary<P extends object>(Component: ComponentType<P>, area: ProductionArea) {
  return function ProductionBoundary(props: P) {
    const scope = useQuery<ReleaseScope>({
      queryKey: ["/api/release-scope"],
      queryFn: () => requestJson("GET", "/api/release-scope"),
      staleTime: 5 * 60_000,
    });

    if (scope.isLoading) return <div className="p-8 text-center text-sm text-muted-foreground">Checking production entitlement...</div>;
    if (scope.error && import.meta.env.PROD) {
      return <PageShell><Alert variant="destructive"><LockKeyhole className="h-4 w-4" /><AlertTitle>Production entitlement could not be verified</AlertTitle><AlertDescription>This module is unavailable until the release boundary can be verified.</AlertDescription></Alert></PageShell>;
    }
    if (scope.data?.modules?.[area] === false) {
      return <PageShell data-testid="production-module-gated"><Alert><LockKeyhole className="h-4 w-4" /><AlertTitle>Not included in the procurement production release</AlertTitle><AlertDescription>{scope.data.message} This route remains in the codebase but is not an approved production workflow.</AlertDescription></Alert></PageShell>;
    }
    return <>
      {scope.data?.previewMode ? <Alert className="mb-4 border-amber-500/40 bg-amber-50/70 dark:bg-amber-950/25" data-testid="non-production-preview-banner"><AlertTriangle className="h-4 w-4" /><AlertTitle>Controlled preview</AlertTitle><AlertDescription>This module is outside the procurement-only V1 production boundary. Use it for testing, not production execution.</AlertDescription></Alert> : null}
      <Component {...props} />
    </>;
  };
}
