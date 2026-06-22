import { useEffect, useState } from "react";

function readMediaQuery(query: string): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(query).matches;
}

/**
 * `true` when `query` matches (e.g. `(min-width: 768px)` for md breakpoint).
 * Initializes from `matchMedia` synchronously on the client so the first paint matches the real viewport.
 * (A default of `false` on the first render caused desktop-only pages to redirect to `/m/home` before the effect ran.)
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => readMediaQuery(query));

  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setMatches(m.matches);
    onChange();
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
