import { useState, useEffect } from "react";
import {
  getFallbackState,
  subscribeFallbackState,
  getSystemBadge,
  type FallbackState,
  type SystemBadge,
} from "@/lib/fallback-store";

export function useFallbackState(): FallbackState & { badge: SystemBadge } {
  const [state, setState] = useState<FallbackState>(getFallbackState);
  const [badge, setBadge] = useState<SystemBadge>(getSystemBadge);

  useEffect(() => {
    return subscribeFallbackState((s) => {
      setState(s);
      setBadge(getSystemBadge());
    });
  }, []);

  return { ...state, badge };
}
