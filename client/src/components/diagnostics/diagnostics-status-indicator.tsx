import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import {
  getDiagnosticEvents,
  subscribeToDiagnostics,
  type DiagnosticEvent,
} from "@/lib/diagnostics/diagnostics-store";

export function DiagnosticsStatusIndicator() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [events, setEvents] = useState<DiagnosticEvent[]>(() => getDiagnosticEvents());

  useEffect(() => subscribeToDiagnostics((next) => setEvents(next)), []);

  const counts = useMemo(() => {
    const latestCompletedScan = events.reduce((latest, event) => {
      if (event.source !== "diagnostics" || event.title !== "Diagnostics scan completed") return latest;
      return Math.max(latest, new Date(event.timestamp).getTime());
    }, 0);
    const cutoff = Math.max(Date.now() - 10 * 60 * 1000, latestCompletedScan);
    return events.reduce(
      (acc, event) => {
        if (event.resolved) return acc;
        if (new Date(event.timestamp).getTime() < cutoff) return acc;
        if (event.severity === "critical") acc.critical += 1;
        if (event.severity === "error") acc.error += 1;
        return acc;
      },
      { critical: 0, error: 0 },
    );
  }, [events]);

  if (user?.role !== "admin") return null;
  const total = counts.critical + counts.error;
  if (total === 0) return null;

  return (
    <div className="fixed bottom-20 right-6 z-50">
      <Button
        type="button"
        size="sm"
        variant={counts.critical > 0 ? "destructive" : "outline"}
        className="gap-2 shadow-lg"
        data-testid="diagnostics-status-indicator"
        onClick={() => setLocation(APP_ROUTES.admin.systemDiagnostics)}
      >
        <AlertTriangle className="h-4 w-4" />
        Diagnostics {total}
      </Button>
    </div>
  );
}
