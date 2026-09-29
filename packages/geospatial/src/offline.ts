/**
 * Offline route packs: a persistent byte store for tile responses (the browser's Cache API in the simulator worker,
 * memory in tests) behind a drop-in `fetch`, and the list of tiles a route needs so it can be fetched before the
 * flight. Tiles are stored exactly as served, so the same bytes (and the same flight) come back offline.
 */
import { destinationPoint, type GeoPosition } from "./geodesy.ts";
import type { GreatCircleRoute } from "./route.ts";
import { FEATURE_ZOOM } from "./features-world.ts";
import { SIM_ZOOM } from "./sim-world.ts";
import { type TileId, ancestorAt, lonLatToTile, tileKey } from "./tiles.ts";
import { planTiles } from "./prefetch.ts";
import type { WorldLayer } from "./lod.ts";
import { TERRARIUM_MAX_ZOOM } from "./terrain.ts";

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

/**
 * The Cache API (browsers and their workers, secure contexts only); undefined where it is not available. Keeps at most
 * `maxEntries` responses: every `trimEvery` writes the oldest entries beyond that are deleted (Cache API keys come
 * back in insertion order), so a browser that flies a lot does not grow its tile cache without bound.
 */
export function cacheApiStore(name = "flight-world-tiles-v1", o: { maxEntries?: number; trimEvery?: number } = {}): TileByteStore | undefined {
  const c = (globalThis as { caches?: CacheStorage }).caches;
  if (!c) return undefined;
  const max = o.maxEntries ?? 20_000, every = o.trimEvery ?? 250;
  let cache: Promise<Cache> | undefined, writes = 0;
  const open = () => (cache ??= c.open(name));
  const req = (k: string) => new Request(`https://tiles.flight-world.invalid/${encodeURIComponent(k)}`);
  const trim = async () => { const x = await open(), keys = await x.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - max))) await x.delete(k); };
  return {
    async get(k) { const r = await (await open()).match(req(k)); return r ? new Uint8Array(await r.arrayBuffer()) : undefined; },
    async put(k, b) { await (await open()).put(req(k), new Response(b as Uint8Array<ArrayBuffer>)); if (++writes % every === 0) await trim(); },
    async clear() { cache = undefined; await c.delete(name); },
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
 * Tiles a route needs offline:
 *  - physics: the 3×3 z12 terrain blocks (and 3×3 z14 feature blocks when `features`) everywhere along it, exactly
 *    what the hold rule will ask for;
 *  - rendering: what the streamer's own LOD planner (`planTiles`) asks for at points along the route, flown low near
 *    both airports and at cruise height between them, and parked at both ends. Tiles are resolved to each source's
 *    maximum zoom as the streamer does.
 */
export function routePackTiles(route: GreatCircleRoute, o: { features?: boolean; stepM?: number; renderStepM?: number; cruiseAglM?: number; speedMps?: number; terrainMaxZoom?: number; featuresMaxZoom?: number } = {}) {
  const step = o.stepM ?? 1500, terrain = new Map<string, TileId>(), features = new Map<string, TileId>();
  const block = (m: Map<string, TileId>, p: GeoPosition, z: number) => {
    const c = lonLatToTile(p.lon, p.lat, z), n = 2 ** z;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const y = c.y + dy; if (y >= 0 && y < n) { const t = { z, x: (c.x + dx + n) % n, y }; m.set(tileKey(t), t); } }
  };
  for (let d = 0; d <= route.totalM + step; d += step) {
    const p = route.pointAt(Math.min(route.totalM, d));
    block(terrain, p, SIM_ZOOM);
    if (o.features) block(features, p, FEATURE_ZOOM);
  }
  const clamp = (t: TileId, max: number) => (t.z <= max ? t : ancestorAt(t, max));
  const layers: WorldLayer[] = o.features ? ["terrain", "buildings", "airports"] : ["terrain"];
  const rStep = o.renderStepM ?? 5000;
  // Below ~900 m AGL (within ~20 km of either airport on a 3° path) the planner asks for its finest ring: sample densely there.
  const nearM = 20_000, nearStep = 1000;
  for (let d = 0; d <= route.totalM + rStep; d += Math.min(d, route.totalM - d) < nearM ? nearStep : rStep) {
    const along = Math.min(route.totalM, d), p = route.pointAt(along), near = Math.min(along, route.totalM - along) < nearM;
    const track = route.progress(p).desiredTrackDeg, agl = near ? 150 : (o.cruiseAglM ?? 2000);
    // Moving along the route (with the streamer's look-ahead), and parked at both ends (as before take-off / after landing).
    const plan = [...planTiles({ position: p, velocity: { groundSpeedMps: o.speedMps ?? 85, trackDeg: track, verticalSpeedMps: 0 }, aglM: agl, layers, route }),
      ...(along === 0 || along === route.totalM ? planTiles({ position: p, velocity: { groundSpeedMps: 0, trackDeg: track, verticalSpeedMps: 0 }, aglM: 2, layers }) : [])];
    for (const r of plan) {
      if (r.layer === "terrain") { const t = clamp(r.tile, o.terrainMaxZoom ?? TERRARIUM_MAX_ZOOM); terrain.set(tileKey(t), t); }
      else { const t = clamp(r.tile, o.featuresMaxZoom ?? FEATURE_ZOOM); features.set(tileKey(t), t); }
    }
  }
  // Departures and arrivals turn: the aircraft leaves along the runway and swings round onto the route, so cover rings
  // around both airports as well as the route line.
  for (const end of [route.origin, route.destination]) for (const radius of [3000, 6000]) for (let bearing = 0; bearing < 360; bearing += 30) {
    const p = destinationPoint(end, bearing, radius);
    for (const r of planTiles({ position: p, velocity: { groundSpeedMps: o.speedMps ?? 85, trackDeg: bearing + 90, verticalSpeedMps: 0 }, aglM: 300, layers, horizonsS: [] })) {
      if (r.level === "LOW") continue;
      if (r.layer === "terrain") { const t = clamp(r.tile, o.terrainMaxZoom ?? TERRARIUM_MAX_ZOOM); terrain.set(tileKey(t), t); }
      else { const t = clamp(r.tile, o.featuresMaxZoom ?? FEATURE_ZOOM); features.set(tileKey(t), t); }
    }
  }
  return { terrain: [...terrain.values()], features: [...features.values()] };
}
