import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

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

type BaseAsyncOptions = {
  immediate?: boolean;
  revalidateDeps?: DependencyList;
};

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Fetches data once on mount (when immediate) and when fetcher identity changes.
 * Uses a ref for the fetcher so refetch is stable and does not trigger effect loops
 * when the parent does not memoize the fetcher. Callers should pass useCallback(fn, deps)
 * so that we refetch only when deps (e.g. query params) actually change.
 *
 * Pass `{ abortable: true }` and a fetcher `(signal) => Promise<T>` to forward cancellation
 * to `fetch` / `invTrackFetch` when the effect re-runs or the component unmounts.
 */
export function useAsyncResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: BaseAsyncOptions & { abortable: true },
): AsyncResourceState<T>;
export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  options?: BaseAsyncOptions,
): AsyncResourceState<T>;
export function useAsyncResource<T>(
  fetcher: ((signal: AbortSignal) => Promise<T>) | (() => Promise<T>),
  options?: BaseAsyncOptions & { abortable?: boolean },
): AsyncResourceState<T> {
  const abortable = options?.abortable === true;
  const [loading, setLoading] = useState(Boolean(options?.immediate ?? true));
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<T | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextData = await withTimeout(
        abortable
          ? (fetcherRef.current as (s: AbortSignal) => Promise<T>)(new AbortController().signal)
          : (fetcherRef.current as () => Promise<T>)(),
        FETCH_TIMEOUT_MS,
      );
      setData(nextData);
    } catch (fetchError) {
      if (isAbortError(fetchError)) {
        return;
      }
      setError(fetchError instanceof Error ? fetchError : new Error("Unknown fetch error"));
    } finally {
      setLoading(false);
    }
  }, [abortable]);

  // Dev-only: warn if fetcher identity changes too often (e.g. non-memoized fetcher).
  const callTimesRef = useRef<number[]>([]);
  const warnedRef = useRef(false);
  const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;

  useEffect(() => {
    if (options?.immediate === false) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = abortable ? new AbortController() : null;
    const now = Date.now();
    if (isDev) {
      callTimesRef.current = callTimesRef.current.filter((t) => now - t < 2000);
      callTimesRef.current.push(now);
      if (callTimesRef.current.length > 3) {
        if (!warnedRef.current) {
          warnedRef.current = true;
          console.warn(
            "[useAsyncResource] Fetcher changed many times in 2s — check useCallback deps. Filters still refetch; fix memoization to avoid extra requests.",
          );
        }
      }
    }
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const nextData = await withTimeout(
          abortable
            ? (fetcherRef.current as (s: AbortSignal) => Promise<T>)(controller!.signal)
            : (fetcherRef.current as () => Promise<T>)(),
          FETCH_TIMEOUT_MS,
        );
        if (!cancelled) {
          setData(nextData);
        }
      } catch (fetchError) {
        if (cancelled || isAbortError(fetchError)) {
          return;
        }
        setError(fetchError instanceof Error ? fetchError : new Error("Unknown fetch error"));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [abortable, options?.immediate, isDev, ...(options?.revalidateDeps ?? [fetcher])]);

  return { loading, error, data, refetch };
}
