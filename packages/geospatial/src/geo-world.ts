/**
 * A flight anchored to a real runway: the bridge the simulator worker uses between its flat deterministic physics
 * and the planet-scale world.
 *
 *  - Physics: `ground(x, z)` reads only the deterministic `SimulationWorld` (z12 tiles from the DEM). Before each
 *    batch of ticks the worker calls `ensureAround`; if any tile under the aircraft is missing, the clock holds until
 *    it arrives, so every tick is computed with complete terrain and results do not depend on network timing.
 *    The airfield (within `flatRadiusM`) is flat at y = 0, blending into real terrain beyond, exactly as the
 *    procedural scenery does.
 *  - Rendering: a `WorldStreamer` keeps LOD tiles around and ahead of the aircraft; loaded tiles become
 *    `TerrainPatch` meshes in the renderer's frame (float32 vertices relative to a per-tile double-precision centre,
 *    which is the floating origin: three.js composes the offset in doubles, so vertices stay precise anywhere).
 */
import type { GeoAirportMarker, GeoStatus, TerrainPatch, Vec3Tuple } from "@flight/protocol";
import { type Airport, type AirportIndex, airportDetail, runwayGeometry } from "./airports.ts";
import { AnchorFrame, type RunwayAnchor, type SimVector, airfieldBlend, runwayAnchor } from "./anchor.ts";
import { attributionFor } from "./attribution.ts";
import { type GeoPosition, haversineDistance } from "./geodesy.ts";
import { SIM_ZOOM, SimulationWorld, extractSimulationTile } from "./sim-world.ts";
import { type TileSource, WorldStreamer } from "./streamer.ts";
import type { TerrainTile } from "./terrain.ts";
import { type TileId, lonLatToTile, tileKey } from "./tiles.ts";

export interface GeoWorldOptions {
  airports: AirportIndex;
  airport: string;
  runway?: string;
  /** Terrain source for both physics (z12) and rendering (all zooms). */
  terrain: TileSource<TerrainTile>;
  flatRadiusM?: number;
  blendM?: number;
  cacheBytes?: number;
  maxConcurrent?: number;
  meshSegments?: number;
  /** New and dropped terrain meshes (debounced). */
  onPatches?: (add: TerrainPatch[], remove: string[]) => void;
  /** Status changed: ready, error, or new physics terrain. */
  onChange?: () => void;
  patchDebounceMs?: number;
  /** Retries per physics tile before it is recorded as sea level (and the manifest says so). */
  simRetries?: number;
}
export interface AircraftPose { position: SimVector; velocity: SimVector; heading: number }

const three = (v: SimVector): Vec3Tuple => [-v.x, v.y, v.z];
const MARKER_RADIUS_M = 150_000;
/** Coarser tiles sit slightly lower, so wherever a finer tile is loaded it draws on top of its parent. */
const levelDrop = (z: number) => (z >= 14 ? 0 : 2 ** (14 - z) * 1.5);

function colour(h: number, water: boolean): [number, number, number] {
  if (water) return [38, 84, 112];
  const stops: [number, [number, number, number]][] = [[0, [96, 128, 62]], [400, [110, 132, 66]], [1200, [150, 136, 96]], [2600, [120, 112, 100]], [3800, [236, 238, 242]]];
  for (let i = 1; i < stops.length; i++) {
    const [h1, c1] = stops[i]!, [h0, c0] = stops[i - 1]!;
    if (h <= h1) { const t = Math.max(0, (h - h0) / (h1 - h0)); return [0, 1, 2].map(k => Math.round(c0[k]! + (c1[k]! - c0[k]!) * t)) as [number, number, number]; }
  }
  return stops[stops.length - 1]![1];
}

export class GeoWorld {
  readonly airport: Airport;
  readonly runway: RunwayAnchor;
  state: "LOADING" | "READY" | "ERROR" = "LOADING";
  detail: string | undefined;
  /** Set by the worker while it holds the clock for terrain. */
  holding = false;
  #frame: AnchorFrame;
  #elevation: number;
  readonly #sim = new SimulationWorld();
  readonly #simLoads = new Map<string, Promise<void>>();
  readonly #streamer: WorldStreamer;
  readonly #drawn = new Set<string>();
  readonly #flat: number;
  readonly #blend: number;
  #manifest: string | undefined;
  #markers: GeoAirportMarker[] = [];
  #last: { x: number; z: number; heading: number } | undefined;
  #patchTimer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;
  readonly #abort = new AbortController();

  constructor(readonly options: GeoWorldOptions) {
    const a = options.airports.find(options.airport);
    if (!a) throw new Error(`unknown airport ${options.airport}`);
    this.airport = a;
    this.runway = runwayAnchor(a, options.runway);
    this.#elevation = this.runway.anchor.altMsl;
    this.#frame = new AnchorFrame(this.runway.anchor, this.runway.headingDegT);
    this.#flat = options.flatRadiusM ?? 3200;
    this.#blend = options.blendM ?? 2600;
    this.#streamer = new WorldStreamer({
      sources: [options.terrain], cacheBytes: options.cacheBytes ?? 192 * 1024 * 1024, maxConcurrent: options.maxConcurrent ?? 6,
      onTile: () => this.#schedulePatches(), onEvict: () => this.#schedulePatches(),
    });
  }
  get frame() { return this.#frame; }
  get simulationWorld() { return this.#sim; }
  get elevation() { return this.#elevation; }

  /** Loads the physics terrain around the runway and fixes the runway elevation from the DEM. */
  async prepare(): Promise<void> {
    try {
      const p = this.runway.anchor;
      await this.#ensureTiles(this.#neighbourhood(p));
      if (this.#disposed) return;
      const e = this.#sim.elevationAt(p.lat, p.lon);
      this.#elevation = e === null ? p.altMsl : Math.max(0, e);
      this.#frame = new AnchorFrame({ ...p, altMsl: this.#elevation }, this.runway.headingDegT);
      this.state = "READY";
      this.#last = undefined;
    } catch (e) {
      this.state = "ERROR";
      this.detail = `Real terrain unavailable (${e instanceof Error ? e.message : String(e)}); flying over a flat world.`;
    }
    this.options.onChange?.();
  }

  #neighbourhood(p: { lat: number; lon: number }): TileId[] {
    const c = lonLatToTile(p.lon, p.lat, SIM_ZOOM), n = 2 ** SIM_ZOOM, out: TileId[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const y = c.y + dy;
      if (y >= 0 && y < n) out.push({ z: SIM_ZOOM, x: (c.x + dx + n) % n, y });
    }
    return out;
  }
  #ensureTiles(tiles: TileId[]): Promise<void> | null {
    const missing = tiles.filter(t => !this.#sim.has(t));
    if (!missing.length) return null;
    return Promise.all(missing.map(t => {
      const key = tileKey(t);
      let p = this.#simLoads.get(key);
      if (!p) {
        p = this.#loadSimTile(t).finally(() => this.#simLoads.delete(key));
        this.#simLoads.set(key, p);
      }
      return p;
    })).then(() => undefined);
  }
  async #loadSimTile(t: TileId): Promise<void> {
    const retries = this.options.simRetries ?? 3;
    for (let attempt = 0; ; attempt++) {
      try {
        const dem = await this.options.terrain.load(t, this.#abort.signal);
        if (this.#disposed) return;
        this.#sim.add(extractSimulationTile(t, (lat, lon) => Math.max(0, dem.sample(lat, lon))));
        break;
      } catch (e) {
        if (this.#disposed) return;
        if (attempt + 1 >= retries) {
          if (this.state === "LOADING") throw e;
          // Keep flying: record the tile as sea level. The manifest hash shows it differs from the real tile.
          this.#sim.add(extractSimulationTile(t, () => 0));
          this.detail = `Terrain tile ${tileKey(t)} unavailable; treated as sea level.`;
          break;
        }
        await new Promise(r => setTimeout(r, 250 * 2 ** attempt));
      }
    }
    this.#manifest = undefined;
    void this.#sim.checksum().then(c => { if (!this.#disposed) { this.#manifest = c; this.options.onChange?.(); } });
  }

  /**
   * Starts loading any physics tile missing around (x, z) and returns a promise for it, or null when the terrain
   * there is complete and the clock may run.
   */
  ensureAround(x: number, z: number): Promise<void> | null {
    if (this.state !== "READY") return null;
    return this.#ensureTiles(this.#neighbourhood(this.#frame.toGeo({ x, y: 0, z })));
  }

  /** Terrain height under local (x, z), relative to the runway. Pure function of the loaded physics tiles. */
  readonly ground = (x: number, z: number): number => {
    if (this.state !== "READY") return 0;
    const t = airfieldBlend(x, z, this.#flat, this.#blend);
    if (t === 0) return 0;
    const g = this.#frame.toGeo({ x, y: 0, z }), e = this.#sim.elevationAt(g.lat, g.lon);
    const terrain = e === null ? this.#elevation : Math.max(0, e);
    return this.#frame.fromGeo({ lat: g.lat, lon: g.lon, altMsl: this.#elevation + t * (terrain - this.#elevation) }).y;
  };

  /** Streams render tiles for the aircraft's pose (cheap to call every step: it only re-plans after real movement). */
  update(pose: AircraftPose) {
    if (this.state !== "READY" || this.#disposed) return;
    const { position: p, velocity: v } = pose, last = this.#last;
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 150 && Math.abs(pose.heading - last.heading) < 0.09) return;
    this.#last = { x: p.x, z: p.z, heading: pose.heading };
    const geo = this.#frame.toGeo(p), agl = p.y - this.ground(p.x, p.z);
    this.#streamer.update(geo, { groundSpeedMps: Math.hypot(v.x, v.z), trackDeg: this.#frame.bearing(pose.heading), verticalSpeedMps: v.y }, undefined, agl);
    this.#markers = this.#airportMarkers(geo);
    this.#schedulePatches();
  }

  #airportMarkers(geo: GeoPosition): GeoAirportMarker[] {
    return this.options.airports.within(geo, MARKER_RADIUS_M).map(({ airport: a, distanceM }) => {
      const onField = (v: SimVector) => airfieldBlend(v.x, v.z, this.#flat, this.#blend) === 0;
      const place = (p: GeoPosition, lift: number): Vec3Tuple => { const v = this.#frame.fromGeo({ ...p, altMsl: a.position.altMsl }); return three({ ...v, y: onField(v) ? lift : v.y + lift }); };
      const detail = airportDetail(distanceM);
      const runways = detail === "METADATA" || detail === "MARKER" ? [] : a.runways.flatMap(r => {
        const g = !r.closed && runwayGeometry(a, r);
        // The runway being flown is drawn by the simulator's own airfield.
        if (!g || (a.ident === this.airport.ident && (r.le.ident === this.runway.runway || r.he.ident === this.runway.runway))) return [];
        return [{ ident: `${r.le.ident}/${r.he.ident}`, le: place(g.le, 0.12), he: place(g.he, 0.12), widthM: g.widthM }];
      });
      return { ident: a.ident, name: a.name, position: place(a.position, 0), distanceM, detail, runways };
    });
  }

  #schedulePatches() {
    if (this.#patchTimer || this.#disposed || !this.options.onPatches) return;
    this.#patchTimer = setTimeout(() => { this.#patchTimer = undefined; this.#flushPatches(); }, this.options.patchDebounceMs ?? 60);
  }
  /** Loaded tiles minus those fully hidden by loaded descendants. */
  drawnTiles(): Map<string, TerrainTile> {
    const loaded = new Map<string, TerrainTile>();
    for (const t of this.#streamer.visible()) if (t.layer === "terrain") loaded.set(tileKey(t.tile), t.value as TerrainTile);
    const memo = new Map<string, boolean>();
    const covered = (t: TileId): boolean => {
      if (t.z >= 15) return false;
      const k = tileKey(t);
      if (memo.has(k)) return memo.get(k)!;
      const z = t.z + 1, x = t.x * 2, y = t.y * 2;
      const r = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].every(([cx, cy]) => { const c = { z, x: cx!, y: cy! }; return loaded.has(tileKey(c)) || covered(c); });
      memo.set(k, r);
      return r;
    };
    for (const [k, t] of [...loaded]) if (covered(t.tile)) loaded.delete(k);
    return loaded;
  }
  #flushPatches() {
    if (this.#disposed) return;
    const want = this.drawnTiles(), add: TerrainPatch[] = [], remove: string[] = [];
    for (const [k, t] of want) if (!this.#drawn.has(k)) { add.push(this.mesh(t)); this.#drawn.add(k); }
    for (const k of [...this.#drawn]) if (!want.has(k)) { remove.push(k); this.#drawn.delete(k); }
    if (add.length || remove.length) this.options.onPatches?.(add, remove);
  }

  /** Mesh for one DEM tile in the renderer's frame (three.js x = −local x). */
  mesh(t: TerrainTile): TerrainPatch {
    const seg = this.options.meshSegments ?? (t.tile.z >= 12 ? 32 : 24), n = seg + 1, N = 2 ** t.tile.z;
    const verts: Vec3Tuple[] = [], colors = new Uint8Array(n * n * 3), drop = 0.6 + levelDrop(t.tile.z);
    for (let j = 0; j < n; j++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (t.tile.y + j / seg)) / N))) * 180 / Math.PI;
      for (let i = 0; i < n; i++) {
        const lon = ((t.tile.x + i / seg) / N) * 360 - 180, h = t.sample(lat, lon), water = h <= 0.5, alt = Math.max(0, h);
        let v = this.#frame.fromGeo({ lat, lon, altMsl: alt });
        const b = airfieldBlend(v.x, v.z, this.#flat, this.#blend);
        if (b < 1) v = { ...v, y: v.y + (this.#elevation + b * (alt - this.#elevation) - alt) };
        const y = b === 0 ? Math.min(v.y, 0) - drop : v.y - drop;
        verts.push(three({ ...v, y }));
        colors.set(colour(alt, water), (j * n + i) * 3);
      }
    }
    const c = verts[Math.floor(n / 2) * n + Math.floor(n / 2)]!, positions = new Float32Array(n * n * 3);
    verts.forEach((v, i) => positions.set([v[0] - c[0], v[1] - c[1], v[2] - c[2]], i * 3));
    const indices = new Uint16Array(seg * seg * 6);
    let k = 0;
    // three.js x is mirrored, so the winding is flipped to keep faces pointing up.
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * n + i, b = a + 1, d = a + n, e = d + 1; indices.set([a, d, b, b, d, e], k); k += 6; }
    return { key: tileKey(t.tile), z: t.tile.z, center: c, positions, colors, indices };
  }

  status(pose: AircraftPose): GeoStatus {
    const p = pose.position, geo = this.#frame.toGeo(p), s = this.#streamer.stats();
    const elev = this.state === "READY" ? this.#sim.elevationAt(geo.lat, geo.lon) : null;
    return {
      airport: this.airport.ident, name: this.airport.name, runway: this.runway.runway, headingDeg: this.runway.headingDegT, state: this.state,
      ...(this.detail ? { detail: this.detail } : {}),
      anchor: { lat: this.runway.anchor.lat, lon: this.runway.anchor.lon, elevationM: this.#elevation },
      position: { lat: geo.lat, lon: geo.lon, altMsl: geo.altMsl }, trackDeg: this.#frame.bearing(pose.heading),
      terrainElevationM: elev === null ? null : Math.max(0, elev), aglM: this.state === "READY" ? p.y - this.ground(p.x, p.z) : null,
      holding: this.holding, simTiles: this.#sim.size, ...(this.#manifest ? { manifest: this.#manifest } : {}),
      streaming: { wanted: s.wanted, loaded: s.cache.entries, inFlight: s.inFlight, cacheMB: Math.round(s.cache.bytes / 1e5) / 10 },
      airports: this.#markers, attribution: attributionFor(["terrain", "airports"]),
    };
  }
  /** Distance from the anchored runway to an airport (m), for the page's airport list. */
  distanceTo(a: Airport) { return haversineDistance(this.runway.anchor, a.position); }

  dispose() {
    this.#disposed = true;
    clearTimeout(this.#patchTimer);
    this.#abort.abort();
    this.#streamer.dispose();
  }
}
