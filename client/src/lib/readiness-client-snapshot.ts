import type { AppReadinessPhase } from "@/lib/app-readiness-state";

export type ReadinessClientSnapshot = {
  phase: AppReadinessPhase;
  readinessProbeFailed: boolean;
  setupProbeFailed: boolean;
  readyError: boolean;
  setupError: boolean;
  /** Last known error message from the /api/ready query observer (if any). */
  lastReadyFailureMessage?: string;
  /** Last known error message from the /api/setup/status query observer (if any). */
  lastSetupFailureMessage?: string;
  updatedAt: string;
};

let latest: ReadinessClientSnapshot | null = null;

/** Updated from useAppReadinessState on each relevant change (for diagnostics). */
export function recordReadinessClientSnapshot(snapshot: ReadinessClientSnapshot): void {
  latest = snapshot;
}

export function getReadinessClientSnapshot(): ReadinessClientSnapshot | null {
  return latest;
}
