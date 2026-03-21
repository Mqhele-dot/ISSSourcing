import { useEffect } from "react";

/** When route is /dashboard#analytics, scroll to #analytics (sidebar deep link). */
export function useDashboardHashScroll(location: string): void {
  useEffect(() => {
    const scrollToAnalytics = () => {
      if (typeof window !== "undefined" && window.location.hash === "#analytics") {
        const el = document.getElementById("analytics");
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    scrollToAnalytics();
    window.addEventListener("hashchange", scrollToAnalytics);
    return () => window.removeEventListener("hashchange", scrollToAnalytics);
  }, [location]);
}
