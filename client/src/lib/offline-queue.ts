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

type SyncBatchReplayResult = {
  idempotencyKey: string;
  status: "accepted" | "applied" | "duplicate" | "failed";
  message?: string;
};

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

async function replaceOfflineQueue(items: readonly OfflineQueuedAction[]): Promise<void> {
  memoryQueue.length = 0;
  memoryQueue.push(...items);

  const db = await openDb();
  if (!db) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const clearReq = store.clear();
    clearReq.onerror = () => reject(clearReq.error);
    clearReq.onsuccess = () => {
      for (const item of items) {
        store.put(item);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function resolveFailedCount(
  payload: { data?: { failed?: Array<{ idempotencyKey: string }>; results?: SyncBatchReplayResult[] } } | null,
): number {
  const failedKeys = new Set(payload?.data?.failed?.map((row) => row.idempotencyKey) ?? []);
  for (const result of payload?.data?.results ?? []) {
    if (result.status === "failed") failedKeys.add(result.idempotencyKey);
  }
  return failedKeys.size;
}

function applyFlushResults(
  items: readonly OfflineQueuedAction[],
  payload: { data?: { failed?: Array<{ idempotencyKey: string }>; results?: SyncBatchReplayResult[] } } | null,
  timestamp: string,
): OfflineQueuedAction[] {
  const results = new Map((payload?.data?.results ?? []).map((row) => [row.idempotencyKey, row] as const));
  const failedKeys = new Set(payload?.data?.failed?.map((row) => row.idempotencyKey) ?? []);

  return items.flatMap((item) => {
    const result = results.get(item.id);
    if (result?.status === "applied" || result?.status === "duplicate") {
      return [];
    }
    if (result?.status === "failed" || failedKeys.has(item.id)) {
      return [{
        ...item,
        retryCount: (item.retryCount ?? 0) + 1,
        failedAt: timestamp,
      }];
    }
    return [item];
  });
}

async function markQueueItemsFailed(items: readonly OfflineQueuedAction[], timestamp: string): Promise<OfflineQueuedAction[]> {
  const next = items.map((item) => ({
    ...item,
    retryCount: (item.retryCount ?? 0) + 1,
    failedAt: timestamp,
  }));
  await replaceOfflineQueue(next);
  return next;
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
    const payload = (await res.json().catch(() => null)) as
      | { data?: { failed?: Array<{ idempotencyKey: string; message?: string }>; results?: SyncBatchReplayResult[] } }
      | null;
    const syncTimestamp = new Date().toISOString();
    const nextItems = applyFlushResults(items, payload, syncTimestamp);
    await replaceOfflineQueue(nextItems);
    const failedCount = resolveFailedCount(payload);
    if (res.ok && nextItems.length === 0) {
      notifyQueueChanged(0, { lastSyncAt: syncTimestamp });
      return { ok: true, status: res.status };
    }
    notifyQueueChanged(nextItems.length, { failed: failedCount || nextItems.length });
    return { ok: false, status: res.status };
  } catch {
    const syncTimestamp = new Date().toISOString();
    const failedItems = await markQueueItemsFailed(items, syncTimestamp);
    notifyQueueChanged(failedItems.length, { failed: failedItems.length });
    return { ok: false };
  }
}
