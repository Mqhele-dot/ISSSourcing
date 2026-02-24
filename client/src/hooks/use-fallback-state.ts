import { useState, useEffect } from "react";
import {
  getFallbackState,
  subscribeFallbackState,
  getSystemBadge,
  type FallbackState,
} from "@/lib/fallback-store";

export function useFallbackState(): FallbackState & { badge: "LIVE" | "DEMO" | "DEGRADED" } {
  const [state, setState] = useState<FallbackState>(getFallbackState);
  const [badge, setBadge] = useState<"LIVE" | "DEMO" | "DEGRADED">(getSystemBadge);

  useEffect(() => {
    return subscribeFallbackState((s) => {
      setState(s);
      setBadge(getSystemBadge());
    });
  }, []);

  return { ...state, badge };
}
