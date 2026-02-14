import { useCallback, useMemo } from "react";
import { useLocation } from "wouter";

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
  const [location, setLocation] = useLocation();

  const current = useMemo(() => {
    const params = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );

    const parsed = { ...defaults } as Record<string, QueryStateValue>;
    for (const key of Object.keys(defaults)) {
      const rawValue = params.get(key);
      if (rawValue !== null) {
        parsed[key] = rawValue;
      }
    }
    return parsed as T;
  }, [defaults, location]);

  const updateQueryState = useCallback(
    (updates: Partial<T>) => {
      const pathname = location.split("?")[0];
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
      setLocation(nextQuery ? `${pathname}?${nextQuery}` : pathname, { replace: true });
    },
    [location, setLocation],
  );

  return {
    queryState: current,
    setQueryState: updateQueryState,
  };
}
