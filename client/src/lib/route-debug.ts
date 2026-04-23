/**
 * Opt-in routing/session diagnostics. In dev, set localStorage INVTRACK_ROUTE_DEBUG=1 then reload.
 */
export function routeDebug(tag: string, payload: Record<string, unknown>): void {
  if (typeof window === "undefined" || !import.meta.env.DEV) return;
  try {
    if (localStorage.getItem("INVTRACK_ROUTE_DEBUG") !== "1") return;
  } catch {
    return;
  }
  console.info(`[invtrack:route-debug] ${tag}`, payload);
}
