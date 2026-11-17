import { useEffect } from "react";
import { flushOfflineQueueToServer } from "@/lib/offline-queue";
import MobileHubTasksPage from "@/pages/mobile-hub-tasks";

/** Mobile-first task hub (paired with bottom nav in `MobileLayout`). */
export default function MobileHubHomePage() {
  useEffect(() => {
    const onOnline = () => {
      void flushOfflineQueueToServer();
    };
    if (typeof navigator !== "undefined" && navigator.onLine) {
      void flushOfflineQueueToServer();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return <MobileHubTasksPage />;
}
