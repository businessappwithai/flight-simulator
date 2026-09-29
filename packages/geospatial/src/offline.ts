/**
 * Offline route packs: a persistent byte store for tile responses (the browser's Cache API in the simulator worker,
 * memory in tests) behind a drop-in `fetch`, and the list of tiles a route needs so it can be fetched before the
 * flight. Tiles are stored exactly as served, so the same bytes (and the same flight) come back offline.
 */
import { destinationPoint, type GeoPosition } from "./geodesy.ts";
import type { GreatCircleRoute } from "./route.ts";
import { FEATURE_ZOOM } from "./features-world.ts";
import { SIM_ZOOM } from "./sim-world.ts";
import { type TileId, lonLatToTile, tileKey, tilesInRadius } from "./tiles.ts";

export interface TileByteStore {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
}

export class MemoryTileStore implements TileByteStore {
  readonly #m = new Map<string, Uint8Array>();
  async get(k: string) { return this.#m.get(k); }
  async put(k: string, b: Uint8Array) { this.#m.set(k, b); }
  async clear() { this.#m.clear(); }
  async count() { return this.#m.size; }
}

/** The Cache API (browsers and their workers, secure contexts only); undefined where it is not available. */
export function cacheApiStore(name = "flight-world-tiles-v1"): TileByteStore | undefined {
  const c = (globalThis as { caches?: CacheStorage }).caches;
  if (!c) return undefined;
  const open = () => c.open(name);
  const req = (k: string) => new Request(`https://tiles.flight-world.invalid/${encodeURIComponent(k)}`);
  return {
    async get(k) { const r = await (await open()).match(req(k)); return r ? new Uint8Array(await r.arrayBuffer()) : undefined; },
    async put(k, b) { await (await open()).put(req(k), new Response(b as Uint8Array<ArrayBuffer>)); },
    async clear() { await c.delete(name); },
    async count() { return (await (await open()).keys()).length; },
  };
}

export interface CachingFetchStats { hits: number; misses: number; stored: number; errors: number }
/**
 * A `fetch` that answers GET requests (including HTTP Range requests, keyed by range) from `store`, and stores every
 * successful response it had to fetch. Failures to read or write the store fall through to the network.
 */
export function cachingFetch(store: TileByteStore, base: typeof fetch = fetch): typeof fetch & { stats: CachingFetchStats } {
  const stats: CachingFetchStats = { hits: 0, misses: 0, stored: 0, errors: 0 };
  const f = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET") return base(input, init);
    const range = new Headers(init?.headers).get("range");
    const key = range ? `${url}#${range}` : url;
    try {
      const hit = await store.get(key);
      if (hit) { stats.hits++; return new Response(hit as Uint8Array<ArrayBuffer>, { status: 200 }); }
    } catch { stats.errors++; }
    stats.misses++;
    const res = await base(input, init);
    if (!res.ok || res.status === 204) return res;
    const bytes = new Uint8Array(await res.arrayBuffer());
    try { await store.put(key, bytes); stats.stored++; } catch { stats.errors++; }
    return new Response(bytes, { status: res.status, headers: res.headers });
  };
  return Object.assign(f as typeof fetch, { stats });
}

/**
 * Tiles a route needs offline: the physics neighbourhood (3×3 z12 terrain, and 3×3 z14 features when `features`)
 * everywhere along it, as the hold rule will ask for them, plus render terrain in a corridor (z10) and around both
 * ends (z13 within 6 km).
 */
export function routePackTiles(route: GreatCircleRoute, o: { features?: boolean; stepM?: number; renderCorridorM?: number } = {}) {
  const step = o.stepM ?? 1500, terrain = new Map<string, TileId>(), features = new Map<string, TileId>();
  const add = (m: Map<string, TileId>, t: TileId) => m.set(tileKey(t), t);
  const block = (m: Map<string, TileId>, p: GeoPosition, z: number) => {
    const c = lonLatToTile(p.lon, p.lat, z), n = 2 ** z;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const y = c.y + dy; if (y >= 0 && y < n) add(m, { z, x: (c.x + dx + n) % n, y }); }
  };
  for (let d = 0; d <= route.totalM + step; d += step) {
    const p = route.pointAt(Math.min(route.totalM, d));
    block(terrain, p, SIM_ZOOM);
    if (o.features) block(features, p, FEATURE_ZOOM);
    for (const side of [-1, 1]) { const q = destinationPoint(p, 90, side * (o.renderCorridorM ?? 15_000)); add(terrain, lonLatToTile(q.lon, q.lat, 10)); }
    add(terrain, lonLatToTile(p.lon, p.lat, 10));
  }
  for (const end of [route.origin, route.destination]) for (const t of tilesInRadius(end, 6000, 13)) add(terrain, t);
  return { terrain: [...terrain.values()], features: [...features.values()] };
}
