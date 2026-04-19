import { useQuery } from "@tanstack/react-query";
import { requestJson } from "@/lib/queryClient";
import type { SetupStatusPayload } from "@/components/setup/product-onboarding-gate";

/**
 * True when the product onboarding gate would allow normal app usage for this session
 * (wizard finished, or skip flag / completed timestamp).
 */
export function useProductSetupComplete(): boolean {
  const { data: setup } = useQuery({
    queryKey: ["/api/setup/status"],
    queryFn: () => requestJson<SetupStatusPayload>("GET", "/api/setup/status"),
    staleTime: 60_000,
  });
  if (!setup) return false;
  return !setup.onboarding.required;
}
