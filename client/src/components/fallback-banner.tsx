import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFallbackState } from "@/hooks/use-fallback-state";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { Link } from "wouter";

export function FallbackBanner() {
  const { fallback } = useFallbackState();
  if (!fallback) return null;

  const isDegraded = fallback === "degraded";
  const title = isDegraded
    ? "Degraded mode"
    : "Operational data temporarily unavailable";
  const description = isDegraded
    ? "Operations endpoints are disabled by configuration. Some lists may be empty."
    : "The operations database is unavailable or timed out. Showing empty results. You can retry or check status.";

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 bg-amber-500/15 dark:bg-amber-600/15 border border-amber-500/40 dark:border-amber-600/40 text-amber-900 dark:text-amber-100 px-4 py-3"
    >
      <div className="flex items-center gap-3 min-w-0">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" />
        <div>
          <p className="font-medium text-sm">{title}</p>
          <p className="text-xs opacity-90">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="border-amber-600/50 text-amber-900 dark:text-amber-100 hover:bg-amber-500/20"
          onClick={() => window.location.reload()}
        >
          Try again
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={APP_ROUTES.admin.settings}>
            View status
          </Link>
        </Button>
      </div>
    </div>
  );
}
