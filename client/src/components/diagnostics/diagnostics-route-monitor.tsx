import { useEffect } from "react";
import { useLocation } from "wouter";
import { addDiagnosticEvent } from "@/lib/diagnostics/diagnostics-store";
import { checkRouteRenderHealth } from "@/lib/diagnostics/route-diagnostics";

export function DiagnosticsRouteMonitor() {
  const [location] = useLocation();

  useEffect(() => {
    addDiagnosticEvent({
      severity: "info",
      source: "route",
      title: "Route changed",
      message: `Navigated to ${location}`,
      route: location,
    });

    const timer = window.setTimeout(() => {
      const result = checkRouteRenderHealth(location);
      if (!result.ok) {
        addDiagnosticEvent({
          severity: "warning",
          source: "route",
          title: "Page may not have rendered expected content",
          message: result.message,
          route: location,
          details: result,
          userAction: "Reload the page or open System Diagnostics if this route remains blank.",
        });
      }
    }, 8_000);

    return () => window.clearTimeout(timer);
  }, [location]);

  return null;
}
