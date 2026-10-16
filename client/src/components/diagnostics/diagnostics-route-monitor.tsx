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

    const clearFollowUp = { id: undefined as number | undefined };
    const timer = window.setTimeout(() => {
      const first = checkRouteRenderHealth(location);
      if (first.ok) return;
      clearFollowUp.id = window.setTimeout(() => {
        const second = checkRouteRenderHealth(location);
        if (second.ok) return;
        addDiagnosticEvent({
          severity: "warning",
          source: "route",
          title: "Page may not have rendered expected content",
          message: second.message,
          route: location,
          details: second,
          userAction: "Reload the page or open System Diagnostics if this route remains blank.",
        });
      }, 2_000);
    }, 8_000);

    return () => {
      window.clearTimeout(timer);
      if (clearFollowUp.id != null) window.clearTimeout(clearFollowUp.id);
    };
  }, [location]);

  return null;
}
