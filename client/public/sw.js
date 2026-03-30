/* Minimal offline shell: caches static assets only; API calls stay network-first. */
const CACHE = "invtrack-shell-v2";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(["/", "/manifest.webmanifest", "/favicon.ico"]).catch(() => undefined),
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
    caches.match(req).then((cached) => cached || fetch(req).then((res) => res)),
  );
});
