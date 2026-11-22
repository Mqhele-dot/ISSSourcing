import type { ReadinessStatus, SetupStatusPayload } from "@/lib/setup-readiness-queries";

/**
 * Single derived lifecycle for install / onboarding / probes.
 * `pending` is used only until initial fetches settle (or error).
 */
export type AppReadinessPhase =
  | "pending"
  | "first_run_required"
  | "setup_incomplete"
  | "setup_check_temporarily_failed"
  | "backend_unreachable"
  | "ready";

export type AppReadinessDeriveInput = {
  readyPending: boolean;
  readyError: boolean;
  readyData: ReadinessStatus | undefined;
  /** False while auth is loading or user is absent — setup query must not run; missing setup is not a failure. */
  setupQueryActive: boolean;
  setupPending: boolean;
  setupError: boolean;
  setupFetched: boolean;
  setupData: SetupStatusPayload | undefined;
};

/**
 * Derives phase from shared `/api/ready` + `/api/setup/status` query snapshots.
 * Order matters: first-run and setup-status failures take precedence over generic readiness errors.
 */
export function deriveAppReadinessPhase(input: AppReadinessDeriveInput): AppReadinessPhase {
  const {
    readyPending,
    readyError,
    readyData,
    setupQueryActive,
    setupPending,
    setupError,
    setupFetched,
    setupData,
  } = input;

  if (readyPending && !readyError) {
    return "pending";
  }

  if (setupQueryActive && setupPending && !setupError) {
    return "pending";
  }

  if (!setupQueryActive) {
    if (readyData?.productBootstrap?.needsFirstRunOnboarding) {
      return "first_run_required";
    }
    return "pending";
  }

  if (readyData?.productBootstrap?.needsFirstRunOnboarding) {
    return "first_run_required";
  }

  const setupFailed = setupFetched && (setupError || setupData == null);
  if (setupFailed) {
    return "setup_check_temporarily_failed";
  }

  if (!setupData) {
    return "pending";
  }

  if (setupData.onboarding.required && !setupData.skipProductOnboarding) {
    return "setup_incomplete";
  }

  /** Successful readiness payload reporting core services down. */
  if (
    readyData &&
    (!readyData.dbReady || !readyData.schemaReady || !readyData.sessionStoreReady)
  ) {
    return "backend_unreachable";
  }

  /**
   * Readiness probe failed but we have a trusted setup payload and past onboarding gates.
   * Still `ready` for navigation; consumers should use `readinessProbeFailed`.
   */
  return "ready";
}

export function readinessProbeFailed(input: Pick<AppReadinessDeriveInput, "readyError" | "readyData">): boolean {
  return input.readyError && input.readyData == null;
}
