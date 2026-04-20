import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  deriveAppReadinessPhase,
  readinessProbeFailed,
  type AppReadinessPhase,
} from "@/lib/app-readiness-state";
import {
  readinessQueryOptions,
  setupStatusQueryOptions,
  type ReadinessStatus,
  type SetupStatusPayload,
} from "@/lib/setup-readiness-queries";
import { recordReadinessClientSnapshot } from "@/lib/readiness-client-snapshot";
import { useAuth } from "@/hooks/use-auth";

export type UseAppReadinessStateResult = {
  phase: AppReadinessPhase;
  /** True when /api/ready failed and we never got a JSON body (network, 5xx, etc.). */
  readinessProbeFailed: boolean;
  /** True when /api/setup/status failed or returned unusable data after fetch. */
  setupProbeFailed: boolean;
  /** User can navigate; show banner / diagnostics — not a hard gate. */
  isDegraded: boolean;
  ready: ReadinessStatus | undefined;
  setup: SetupStatusPayload | undefined;
  readyPending: boolean;
  readyError: boolean;
  setupPending: boolean;
  setupError: boolean;
  setupFetched: boolean;
  readinessFetching: boolean;
  setupFetching: boolean;
  refetchReadiness: () => void;
  refetchSetup: () => void;
  retrySetupStatus: () => void;
};

/**
 * Single client source of truth for readiness + setup status (shared React Query cache).
 */
export function useAppReadinessState(): UseAppReadinessStateResult {
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();

  /** Authenticated setup status is meaningless until session is established (avoids 401 → false "setup failed"). */
  const setupQueryActive = Boolean(user) && !authLoading;

  const readyQuery = useQuery(readinessQueryOptions);
  const setupQuery = useQuery({
    ...setupStatusQueryOptions,
    enabled: setupQueryActive,
    retry: (failureCount, err) => {
      const status = err && typeof err === "object" && "status" in err ? (err as { status?: number }).status : undefined;
      if (status === 401) return false;
      return failureCount < 1;
    },
  });

  const {
    data: ready,
    isPending: readyPending,
    isError: readyError,
    isFetching: readinessFetching,
    error: readyQueryError,
    refetch: refetchReadiness,
  } = readyQuery;

  const {
    data: setup,
    isPending: setupPending,
    isError: setupError,
    isFetched: setupFetched,
    isFetching: setupFetching,
    error: setupQueryError,
  } = setupQuery;

  const deriveInput = useMemo(
    () => ({
      readyPending,
      readyError,
      readyData: ready,
      setupQueryActive,
      setupPending,
      setupError,
      setupFetched,
      setupData: setup,
    }),
    [ready, readyError, readyPending, setupQueryActive, setup, setupError, setupFetched, setupPending],
  );

  const phase = useMemo(() => deriveAppReadinessPhase(deriveInput), [deriveInput]);

  const probeFailed = readinessProbeFailed(deriveInput);
  const setupProbeFailed =
    setupQueryActive && setupFetched && (setupError || setup == null);

  const isDegraded =
    phase === "setup_check_temporarily_failed" ||
    probeFailed ||
    phase === "backend_unreachable" ||
    setup?.database?.ok === false ||
    setup?.setupStatusHealth === "degraded";

  useEffect(() => {
    const msg = (e: unknown) => (e instanceof Error ? e.message : e != null ? String(e) : undefined);
    recordReadinessClientSnapshot({
      phase,
      readinessProbeFailed: probeFailed,
      setupProbeFailed,
      readyError,
      setupError,
      lastReadyFailureMessage: msg(readyQueryError),
      lastSetupFailureMessage: msg(setupQueryError),
      updatedAt: new Date().toISOString(),
    });
  }, [phase, probeFailed, setupProbeFailed, readyError, setupError, readyQueryError, setupQueryError]);

  const retrySetupStatus = () => void queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });

  return {
    phase,
    readinessProbeFailed: probeFailed,
    setupProbeFailed,
    isDegraded,
    ready,
    setup,
    readyPending,
    readyError,
    setupPending,
    setupError,
    setupFetched,
    readinessFetching,
    setupFetching,
    refetchReadiness: () => void refetchReadiness(),
    refetchSetup: retrySetupStatus,
    retrySetupStatus,
  };
}
