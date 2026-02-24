/**
 * Global store for InvTrack fallback/degraded state from API responses.
 * Set when any request returns X-InvTrack-Fallback or body meta.fallback;
 * cleared when a request succeeds with no fallback.
 * UI (banner, header badge) subscribes to show LIVE | DEMO | DEGRADED.
 */

export type FallbackState = {
  fallback: string | null;
  endpoint: string | null;
};

let state: FallbackState = { fallback: null, endpoint: null };
const listeners = new Set<(s: FallbackState) => void>();

export function getFallbackState(): FallbackState {
  return state;
}

export function setFallbackState(fallback: string | null, endpoint: string | null): void {
  if (state.fallback === fallback && state.endpoint === endpoint) return;
  state = { fallback, endpoint };
  listeners.forEach((fn) => fn(state));
}

export function subscribeFallbackState(fn: (s: FallbackState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

/** System mode for header badge: LIVE (no fallback), DEMO (demo data), DEGRADED (fallback) */
export function getSystemBadge(): "LIVE" | "DEMO" | "DEGRADED" {
  if (state.fallback) return "DEGRADED";
  return "LIVE";
}
