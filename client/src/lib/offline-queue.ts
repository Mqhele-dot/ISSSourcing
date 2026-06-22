/**
 * Offline mutation queue — IndexedDB with in-memory fallback when IDB unavailable.
 */

import { buildRequestHeaders } from "./queryClient";

export type OfflineQueuedAction = {
  id: string;
  type:
    | "scan"
    | "adjustment"
    | "receive_note"
    | "generic"
    | "mobile_count_line"
    | "mobile_count_submit"
    | "mobile_count_recount"
    | "mobile_count_spot";
  payload: Record<string, unknown>;
  createdAt: string;
  retryCount?: number;
  failedAt?: string;
  ackedAt?: string;
};

const DB_NAME = "invtrack-offline";
const STORE = "queue";
const DB_VERSION = 1;

const memoryQueue: OfflineQueuedAction[] = [];

function notifyQueueChanged(pending: number, extra?: { failed?: number; lastSyncAt?: string | null }) {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage({
    type: "INVTRACK_OFFLINE_QUEUE_CHANGED",
    pending,
    failed: extra?.failed ?? 0,
    lastSyncAt: extra?.lastSyncAt ?? null,
  });
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => resolve(null);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
  });
}

export async function enqueueOfflineAction(
  type: OfflineQueuedAction["type"],
  payload: Record<string, unknown>,
): Promise<OfflineQueuedAction> {
  const item: OfflineQueuedAction = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    payload,
    createdAt: new Date().toISOString(),
  };

  const db = await openDb();
  if (!db) {
    memoryQueue.push(item);
    notifyQueueChanged(memoryQueue.length);
    return item;
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.add(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  const pending = await peekOfflineQueue();
  notifyQueueChanged(pending.length);
  return item;
}

export async function peekOfflineQueue(): Promise<readonly OfflineQueuedAction[]> {
  const db = await openDb();
  if (!db) {
    return [...memoryQueue];
  }

  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as OfflineQueuedAction[]) ?? []);
    req.onerror = () => resolve([]);
  });
}

export async function clearOfflineQueue(): Promise<void> {
  memoryQueue.length = 0;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** POST /api/sync/batch with queued actions; clears queue on success. */
export async function flushOfflineQueueToServer(): Promise<{ ok: boolean; status?: number }> {
  const items = await peekOfflineQueue();
  if (items.length === 0) return { ok: true };

  try {
    const headers = await buildRequestHeaders("POST", undefined, {
      contentType: "application/json",
    });
    const res = await fetch("/api/sync/batch", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        actions: items.map((a) => ({
          idempotencyKey: a.id,
          type: a.type,
          payload: a.payload,
        })),
      }),
    });
    if (res.ok) {
      await clearOfflineQueue();
      notifyQueueChanged(0, { lastSyncAt: new Date().toISOString() });
      return { ok: true, status: res.status };
    }
    notifyQueueChanged(items.length, { failed: items.length });
    return { ok: false, status: res.status };
  } catch {
    notifyQueueChanged(items.length, { failed: items.length });
    return { ok: false };
  }
}
