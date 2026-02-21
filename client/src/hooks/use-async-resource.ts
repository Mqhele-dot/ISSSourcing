import { useCallback, useEffect, useRef, useState } from "react";

/** Align with client apiRequest (12s); server operational timeout is 8s */
const FETCH_TIMEOUT_MS = 12000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s. Check the network or try again.`)), ms),
    ),
  ]);
}

type AsyncResourceState<T> = {
  loading: boolean;
  error: Error | null;
  data: T | null;
  refetch: () => Promise<void>;
};

/**
 * Fetches data once on mount (when immediate) and when fetcher identity changes.
 * Uses a ref for the fetcher so refetch is stable and does not trigger effect loops
 * when the parent does not memoize the fetcher. Callers should pass useCallback(fn, deps)
 * so that we refetch only when deps (e.g. query params) actually change.
 */
export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  options?: { immediate?: boolean },
): AsyncResourceState<T> {
  const [loading, setLoading] = useState(Boolean(options?.immediate ?? true));
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<T | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextData = await withTimeout(fetcherRef.current(), FETCH_TIMEOUT_MS);
      setData(nextData);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError : new Error("Unknown fetch error"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Dev-only: detect refetch loops (e.g. inline fetcher causing effect to re-run every render)
  const callTimesRef = useRef<number[]>([]);
  const throttleUntilRef = useRef(0);
  const warnedRef = useRef(false);
  const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;

  useEffect(() => {
    if (options?.immediate === false) {
      setLoading(false);
      return;
    }
    const now = Date.now();
    if (isDev) {
      callTimesRef.current = callTimesRef.current.filter((t) => now - t < 2000);
      callTimesRef.current.push(now);
      if (callTimesRef.current.length > 3) {
        throttleUntilRef.current = now + 5000;
        if (!warnedRef.current) {
          warnedRef.current = true;
          console.warn(
            "[useAsyncResource] Possible refetch loop: fetcher triggered too many times in 2s. Pass a memoized fetcher (useCallback) so the effect does not re-run every render.",
          );
        }
      }
      if (now < throttleUntilRef.current) return;
    }
    refetch();
  }, [options?.immediate, refetch, fetcher, isDev]);

  return { loading, error, data, refetch };
}
