/*
 * App-shell service worker: lets the simulator (and the Control Room next to it) open without a network, so a route
 * saved with "Save route for offline" can be flown offline. Same-origin GETs only, network first: online, every
 * request goes to the network as before (and refreshes the copy); offline, the last copy answers. Hashed bundles
 * (chunk-*.js) never change, so they are served from the cache when present. Tile data is not handled here: the
 * simulation worker keeps tiles in its own cache (packages/geospatial offline.ts).
 * Built by apps/simulator/build.ts into sw.js with the page's own files as PRECACHE.
 */
declare const PRECACHE: string[];
declare const VERSION: string;
type FetchEventLike = Event & { request: Request; respondWith(r: Promise<Response>): void };
type ExtendableEventLike = Event & { waitUntil(p: Promise<unknown>): void };
const sw = self as unknown as { addEventListener(t: string, f: (e: never) => void): void; skipWaiting(): Promise<void>; clients: { claim(): Promise<void> }; location: Location };
const CACHE = `flight-world-shell-${VERSION}`;
sw.addEventListener("install", (e: ExtendableEventLike) => {
  // Best effort: a file that fails to precache is fetched (and cached) on first use instead.
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => undefined)))).then(() => sw.skipWaiting()));
});
sw.addEventListener("activate", (e: ExtendableEventLike) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("flight-world-shell-") && k !== CACHE).map(k => caches.delete(k)))).then(() => sw.clients.claim()));
});
sw.addEventListener("fetch", (e: FetchEventLike) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== sw.location.origin || req.headers.has("range")) return;
  const immutable = /\/chunk-[\w-]+\.(js|css)$/.test(url.pathname);
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (immutable) { const hit = await cache.match(req); if (hit) return hit; }
    try {
      const res = await fetch(req);
      if (res.ok && res.type === "basic") await cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
      if (hit) return hit;
      throw err;
    }
  })());
});
