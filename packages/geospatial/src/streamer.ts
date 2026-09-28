/**
 * WorldStreamer: keeps the tiles around (and ahead of) the aircraft loaded, and lets everything else age out.
 *
 *   update(position, velocity, route) → planTiles → priority queue → ≤ maxConcurrent loads per source
 *                                                                    ↓
 *                                         LRU byte cache (wanted tiles refreshed lowest priority first,
 *                                         so tiles behind the aircraft and no-longer-wanted tiles evict first)
 *
 * On a turn sharper than `headingAbortDeg` the in-flight loads that are now behind or unwanted are aborted.
 * The streamer is asynchronous and timing-dependent, so it only feeds rendering. Deterministic consumers
 * (physics, sensors, AI) use `SimulationWorld`, which is built from an explicit, recorded tile manifest.
 */
import type { GeoPosition } from "./geodesy.ts";
import { angleDiff } from "./geodesy.ts";
import { LruByteCache, type CacheStats } from "./cache.ts";
import type { LodPolicy, WorldLayer } from "./lod.ts";
import { type GeoVelocity, type RouteLike, type TileRequest, PRIORITY, planTiles } from "./prefetch.ts";
import { type TileId, ancestorAt, tileKey } from "./tiles.ts";

export interface TileSource<T = unknown> {
  readonly layer: WorldLayer;
  /** Deepest zoom the source has. Deeper requests are served by the ancestor tile at this zoom (overzoom). */
  readonly maxZoom: number;
  readonly minZoom?: number;
  load(tile: TileId, signal: AbortSignal): Promise<T>;
  /** Approximate decoded size in bytes, for the cache budget. */
  sizeOf(value: T): number;
}

export interface LoadedTile<T = unknown> { key: string; layer: WorldLayer; tile: TileId; value: T }
export interface StreamerUpdate {
  wanted: number;
  started: string[];
  aborted: string[];
  queued: number;
  sharpTurn: boolean;
}
export interface WorldStreamerOptions {
  sources: readonly TileSource[];
  maxConcurrent?: number;
  cacheBytes?: number;
  cacheEntries?: number;
  headingAbortDeg?: number;
  /** Cap on the wanted set per update (lowest priority dropped first). */
  maxWanted?: number;
  policy?: LodPolicy;
  onTile?: (tile: LoadedTile) => void;
  onEvict?: (tile: LoadedTile) => void;
  onError?: (request: TileRequest, error: unknown) => void;
}

interface InFlight { request: TileRequest; controller: AbortController }

export class WorldStreamer {
  readonly #sources = new Map<WorldLayer, TileSource>();
  readonly #cache: LruByteCache<string, LoadedTile>;
  readonly #inFlight = new Map<string, InFlight>();
  #queue: TileRequest[] = [];
  #wanted = new Map<string, TileRequest>();
  #lastTrack: number | undefined;
  #loaded = 0;
  #failed = 0;
  #aborted = 0;
  readonly #maxConcurrent: number;
  readonly #headingAbortDeg: number;
  readonly #maxWanted: number;

  constructor(readonly options: WorldStreamerOptions) {
    for (const s of options.sources) this.#sources.set(s.layer, s);
    this.#maxConcurrent = options.maxConcurrent ?? 6;
    this.#headingAbortDeg = options.headingAbortDeg ?? 15;
    this.#maxWanted = options.maxWanted ?? 2000;
    this.#cache = new LruByteCache(options.cacheBytes ?? 512 * 1024 * 1024, options.cacheEntries ?? Number.POSITIVE_INFINITY, (_k, v) => options.onEvict?.(v));
  }

  /** Source key for a request: deeper-than-available zooms collapse onto the source's ancestor tile. */
  #resolve(r: TileRequest): TileRequest | undefined {
    const s = this.#sources.get(r.layer);
    if (!s || r.tile.z < (s.minZoom ?? 0)) return undefined;
    if (r.tile.z <= s.maxZoom) return r;
    const tile = ancestorAt(r.tile, s.maxZoom);
    return { ...r, tile, key: `${r.layer}:${tileKey(tile)}` };
  }

  update(position: GeoPosition, velocity: GeoVelocity, route?: RouteLike, aglM?: number): StreamerUpdate {
    const sharpTurn = this.#lastTrack !== undefined && velocity.groundSpeedMps > 1 && Math.abs(angleDiff(this.#lastTrack, velocity.trackDeg)) > this.#headingAbortDeg;
    if (this.#lastTrack === undefined || sharpTurn) this.#lastTrack = velocity.trackDeg;

    const plan = planTiles({ position, velocity, route, aglM, policy: this.options.policy, layers: [...this.#sources.keys()] });
    const wanted = new Map<string, TileRequest>();
    for (const r of plan) {
      const s = this.#resolve(r);
      if (!s) continue;
      const old = wanted.get(s.key);
      if (!old || old.priority < s.priority) wanted.set(s.key, s);
      if (wanted.size >= this.#maxWanted) break;
    }
    this.#wanted = wanted;

    const aborted: string[] = [];
    if (sharpTurn) for (const [key, f] of this.#inFlight) {
      const now = wanted.get(key);
      if (!now || now.priority < PRIORITY.IN_RANGE) { f.controller.abort(); this.#inFlight.delete(key); aborted.push(key); this.#aborted++; }
    }

    // Refresh cached wanted tiles lowest priority first, so the highest priority ones are the most recent.
    const ordered = [...wanted.values()];
    for (let i = ordered.length - 1; i >= 0; i--) this.#cache.touch(ordered[i]!.key);
    this.#queue = ordered.filter(r => !this.#cache.has(r.key) && !this.#inFlight.has(r.key));
    const started = this.#pump();
    return { wanted: wanted.size, started, aborted, queued: this.#queue.length, sharpTurn };
  }

  #pump(): string[] {
    const started: string[] = [];
    while (this.#inFlight.size < this.#maxConcurrent && this.#queue.length) {
      const r = this.#queue.shift()!;
      if (this.#cache.has(r.key) || this.#inFlight.has(r.key)) continue;
      const source = this.#sources.get(r.layer)!, controller = new AbortController();
      this.#inFlight.set(r.key, { request: r, controller });
      started.push(r.key);
      source.load(r.tile, controller.signal).then(value => {
        if (this.#inFlight.get(r.key)?.controller !== controller) return; // aborted or superseded
        this.#inFlight.delete(r.key);
        const loaded: LoadedTile = { key: r.key, layer: r.layer, tile: r.tile, value };
        if (this.#cache.set(r.key, loaded, source.sizeOf(value))) { this.#loaded++; this.options.onTile?.(loaded); }
        this.#pump();
      }, error => {
        if (this.#inFlight.get(r.key)?.controller !== controller) return;
        this.#inFlight.delete(r.key);
        this.#failed++;
        this.options.onError?.(r, error);
        this.#pump();
      });
    }
    return started;
  }

  get<T = unknown>(layer: WorldLayer, tile: TileId): T | undefined {
    const s = this.#sources.get(layer);
    if (!s) return undefined;
    const t = tile.z > s.maxZoom ? ancestorAt(tile, s.maxZoom) : tile;
    return this.#cache.get(`${layer}:${tileKey(t)}`)?.value as T | undefined;
  }
  /** Loaded tiles that are currently wanted, highest priority first (what a renderer should draw). */
  visible(): LoadedTile[] {
    const out: LoadedTile[] = [];
    for (const r of this.#wanted.values()) { const t = this.#cache.peek(r.key); if (t) out.push(t); }
    return out;
  }
  wanted(): TileRequest[] { return [...this.#wanted.values()]; }
  inFlight(): string[] { return [...this.#inFlight.keys()]; }
  /** Resolves when nothing is loading or queued (tests, pre-flight warm-up). */
  async idle(pollMs = 0) { while (this.#inFlight.size || this.#queue.length) await new Promise(r => setTimeout(r, pollMs)); }
  dispose() { for (const f of this.#inFlight.values()) f.controller.abort(); this.#inFlight.clear(); this.#queue = []; this.#cache.clear(); }
  stats(): { cache: CacheStats; inFlight: number; queued: number; wanted: number; loaded: number; failed: number; aborted: number } {
    return { cache: this.#cache.stats(), inFlight: this.#inFlight.size, queued: this.#queue.length, wanted: this.#wanted.size, loaded: this.#loaded, failed: this.#failed, aborted: this.#aborted };
  }
}
