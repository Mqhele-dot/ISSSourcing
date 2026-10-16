import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { requestJson } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type RuntimeCapabilities = { developerToolsEnabled?: boolean };

export function withDeveloperToolBoundary<P extends object>(Component: ComponentType<P>) {
  return function DeveloperToolBoundary(props: P) {
    const capabilities = useQuery<RuntimeCapabilities>({
      queryKey: ["/api/runtime-capabilities"],
      queryFn: () => requestJson("GET", "/api/runtime-capabilities"),
      staleTime: 5 * 60_000,
    });
    if (capabilities.isLoading) return <div className="p-6 text-sm text-muted-foreground" role="status">Checking developer-tool capability…</div>;
    if (capabilities.isError) return <Card className="mx-auto mt-8 max-w-xl"><CardHeader><h1 className="text-2xl font-semibold tracking-tight">Developer tools unavailable</h1><CardDescription>The deployment capability could not be verified.</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => void capabilities.refetch()}>Retry</Button></CardContent></Card>;
    if (capabilities.data?.developerToolsEnabled !== true) return <Card className="mx-auto mt-8 max-w-xl"><CardHeader><h1 className="text-2xl font-semibold tracking-tight">Developer tools disabled</h1><CardDescription>These diagnostics are available only to administrators in explicitly enabled non-production deployments.</CardDescription></CardHeader></Card>;
    return <Component {...props} />;
  };
}
