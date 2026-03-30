/**
 * Offline mutation queue — IndexedDB with in-memory fallback when IDB unavailable.
 */

export type OfflineQueuedAction = {
  id: string;
  type: "scan" | "adjustment" | "receive_note" | "generic";
  payload: Record<string, unknown>;
  createdAt: string;
};

const DB_NAME = "invtrack-offline";
const STORE = "queue";
const DB_VERSION = 1;

const memoryQueue: OfflineQueuedAction[] = [];

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
    return item;
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.add(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

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
    const res = await fetch("/api/sync/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      return { ok: true, status: res.status };
    }
    return { ok: false, status: res.status };
  } catch {
    return { ok: false };
  }
}
