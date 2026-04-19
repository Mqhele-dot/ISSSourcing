import { useQuery } from "@tanstack/react-query";
import { setupStatusQueryOptions } from "@/lib/setup-readiness-queries";

/**
 * True when the product onboarding gate would allow normal app usage for this session
 * (wizard finished, or skip flag / completed timestamp).
 */
export function useProductSetupComplete(): boolean {
  const { data: setup } = useQuery({
    ...setupStatusQueryOptions,
    staleTime: 60_000,
  });
  if (!setup) return false;
  return !setup.onboarding.required;
}
