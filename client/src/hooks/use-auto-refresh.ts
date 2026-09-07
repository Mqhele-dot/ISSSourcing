import { useCallback, useEffect, useMemo, useState } from "react";

type AutoRefreshOptions = {
  intervalMs?: number;
};

export function useAutoRefresh(
  refetch: () => Promise<void>,
  options: AutoRefreshOptions = {},
) {
  const [enabled, setEnabled] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const intervalMs = options.intervalMs ?? 10_000;

  const refreshNow = useCallback(async () => {
    await refetch();
    setLastRefreshedAt(new Date());
  }, [refetch]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshNow();
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs, refreshNow]);

  const lastRefreshedLabel = useMemo(() => {
    if (!lastRefreshedAt) {
      return "Never";
    }
    return lastRefreshedAt.toLocaleTimeString();
  }, [lastRefreshedAt]);

  return {
    autoRefreshEnabled: enabled,
    setAutoRefreshEnabled: setEnabled,
    lastRefreshedAt,
    lastRefreshedLabel,
    refreshNow,
    markRefreshed: () => setLastRefreshedAt(new Date()),
  };
}
