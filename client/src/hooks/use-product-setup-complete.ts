import { useAppReadinessState } from "@/hooks/use-app-readiness-state";

/**
 * True when the product onboarding gate would allow normal app usage for this session
 * (wizard finished, or skip flag / completed timestamp).
 * False while probes are pending or setup status could not be loaded (safe default).
 */
export function useProductSetupComplete(): boolean {
  const { phase, setup } = useAppReadinessState();
  if (phase === "pending" || phase === "setup_check_temporarily_failed") return false;
  if (!setup) return false;
  return !setup.onboarding.required;
}
