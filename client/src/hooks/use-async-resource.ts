import { useCallback, useEffect, useState } from "react";

const FETCH_TIMEOUT_MS = 20000;

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

export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  options?: { immediate?: boolean },
): AsyncResourceState<T> {
  const [loading, setLoading] = useState(Boolean(options?.immediate ?? true));
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<T | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextData = await withTimeout(fetcher(), FETCH_TIMEOUT_MS);
      setData(nextData);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError : new Error("Unknown fetch error"));
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    if (options?.immediate === false) {
      setLoading(false);
      return;
    }

    refetch();
  }, [options?.immediate, refetch]);

  return { loading, error, data, refetch };
}
