import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";

export type QueryStateValue = string | number | boolean | null | undefined;
export type QueryState = Record<string, QueryStateValue>;

function normalizeValue(value: QueryStateValue): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : null;
  }
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

export function useQueryState<T extends QueryState>(defaults: T) {
  const [pathname, setLocation] = useLocation();
  const search = useSearch();

  const current = useMemo(() => {
    // wouter v3: `useLocation` is pathname-only; query lives in `useSearch()`.
    const params = new URLSearchParams(search);

    const parsed = { ...defaults } as Record<string, QueryStateValue>;
    for (const key of Object.keys(defaults)) {
      const rawValue = params.get(key);
      if (rawValue !== null) {
        parsed[key] = rawValue;
      }
    }
    return parsed as T;
  }, [defaults, search]);

  const updateQueryState = useCallback(
    (updates: Partial<T>) => {
      const pathOnly = pathname.split("?")[0];
      const params = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : "",
      );

      for (const [key, value] of Object.entries(updates)) {
        const normalized = normalizeValue(value);
        if (normalized === null) {
          params.delete(key);
        } else {
          params.set(key, normalized);
        }
      }

      const nextQuery = params.toString();
      setLocation(nextQuery ? `${pathOnly}?${nextQuery}` : pathOnly, { replace: true });
    },
    [pathname, setLocation],
  );

  return {
    queryState: current,
    setQueryState: updateQueryState,
  };
}
