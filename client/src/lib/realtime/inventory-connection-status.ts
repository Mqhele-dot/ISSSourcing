import { useSyncExternalStore } from "react";

export type InventoryConnectionState = "disabled" | "connecting" | "connected" | "reconnecting" | "disconnected";

const states = new Map<string, InventoryConnectionState>();
const listeners = new Set<() => void>();

function snapshot(): InventoryConnectionState {
  const values = [...states.values()];
  if (values.includes("connected")) return "connected";
  if (values.includes("reconnecting")) return "reconnecting";
  if (values.includes("connecting")) return "connecting";
  if (values.includes("disconnected")) return "disconnected";
  return "disabled";
}

export function publishInventoryConnectionState(id: string, state: InventoryConnectionState): void {
  states.set(id, state);
  listeners.forEach((listener) => listener());
}

export function removeInventoryConnectionState(id: string): void {
  states.delete(id);
  listeners.forEach((listener) => listener());
}

export function useSharedInventoryConnectionState(): InventoryConnectionState {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot,
    snapshot,
  );
}
