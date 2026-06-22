import { useEffect } from "react";
import { flushOfflineQueueToServer } from "@/lib/offline-queue";

/** When online, flush IndexedDB offline queue to POST /api/sync/batch (requires auth + org feature). */
export function useOfflineSyncFlush(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const run = () => {
      flushOfflineQueueToServer().catch(() => undefined);
    };

    window.addEventListener("online", run);
    const interval = window.setInterval(run, 60_000);
    run();

    return () => {
      window.removeEventListener("online", run);
      window.clearInterval(interval);
    };
  }, [enabled]);
}
