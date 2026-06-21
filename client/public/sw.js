/* Offline-aware shell: caches app/mobile shells; API mutations stay in IndexedDB and replay via /api/sync/batch. */
const CACHE = "invtrack-shell-v3";
const SHELL_URLS = [
  "/",
  "/m/home",
  "/m/counts",
  "/m/scan",
  "/manifest.webmanifest",
  "/favicon.ico",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(SHELL_URLS).catch(() => undefined),
    ),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  if (req.url.includes("/api/")) return;
  event.respondWith(
    caches.match(req).then((cached) =>
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => cached || caches.match("/")),
    ),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type !== "INVTRACK_OFFLINE_QUEUE_CHANGED") return;
  self.clients.matchAll({ type: "window" }).then((clients) => {
    for (const client of clients) {
      client.postMessage({
        type: "INVTRACK_OFFLINE_QUEUE_STATUS",
        pending: event.data.pending ?? 0,
        failed: event.data.failed ?? 0,
        lastSyncAt: event.data.lastSyncAt ?? null,
      });
    }
  });
});
