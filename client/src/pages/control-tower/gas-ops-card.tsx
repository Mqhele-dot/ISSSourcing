import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Loader2 } from "lucide-react";
import {
  ApiError,
  fetchGasDashboardSummaryEnvelope,
  runGasComplianceAlerts,
} from "@/api/client";
import type { GasDashboardSummary } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

type GasQueryResult =
  | { status: "disabled" }
  | { status: "ok"; summary: GasDashboardSummary }
  | { status: "error"; message: string };

const GAS_SUMMARY_TIMEOUT_MS = 4_000;

function withGasTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Gas operations summary timed out.")), GAS_SUMMARY_TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

/**
 * Shown when org has `gas` feature enabled; hidden when FEATURE_DISABLED.
 */
export function GasOpsCard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const canRunAlerts = user?.role === "admin" || user?.role === "manager";

  const gasState = useQuery({
    queryKey: ["/api/gas/dashboard-summary"],
    queryFn: async (): Promise<GasQueryResult> => {
      try {
        const { data } = await withGasTimeout(fetchGasDashboardSummaryEnvelope());
        return { status: "ok", summary: data };
      } catch (e) {
        if (e instanceof ApiError && e.code === "FEATURE_DISABLED") {
          return { status: "disabled" };
        }
        return {
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        };
      }
    },
    retry: false,
    throwOnError: false,
  });

  const alertMutation = useMutation({
    mutationFn: runGasComplianceAlerts,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["/api/gas/dashboard-summary"] });
      void qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({
        title: "Gas compliance alerts",
        description:
          r.notificationsSent > 0
            ? `Sent ${r.notificationsSent} notification(s). Due (30d): ${r.dueWithin30d}, blocked: ${r.blocked}.`
            : "No due or blocked profiles to notify about.",
      });
    },
    onError: (e: Error) => {
      toast({
        title: "Could not run alerts",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  if (gasState.isLoading) {
    return (
      <Card className="border-dashed">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Flame className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">Gas operations</CardTitle>
          <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />
        </CardHeader>
      </Card>
    );
  }

  if (gasState.data?.status === "error") {
    return (
      <Card className="border-dashed" data-testid="gas-ops-unavailable">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Flame className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">Gas operations unavailable</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{gasState.data.message || "The gas extension did not respond. Core control tower data remains available."}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void gasState.refetch()}>
            Retry gas summary
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (gasState.data?.status === "disabled") {
    return null;
  }

  if (gasState.data?.status !== "ok") {
    return null;
  }

  const s = gasState.data.summary;

  return (
    <Card data-tour="control-tower-gas">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Flame className="h-4 w-4 text-orange-600" />
          Gas operations
        </CardTitle>
        {canRunAlerts ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={alertMutation.isPending}
            onClick={() => alertMutation.mutate()}
          >
            {alertMutation.isPending ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Sending…
              </>
            ) : (
              "Notify due / blocked"
            )}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Products</p>
          <p className="text-lg font-semibold tabular-nums">{s.productCount}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Open exchanges</p>
          <p className="text-lg font-semibold tabular-nums">{s.openExchanges}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Profiles due (30d)</p>
          <p className="text-lg font-semibold tabular-nums">{s.profilesDueForTest30d}</p>
        </div>
      </CardContent>
    </Card>
  );
}
