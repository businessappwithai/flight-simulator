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
import type { AircraftState, EntityState, FeaturePatch, GeoAirportMarker, GeoRouteStatus, GeoStatus, TerrainPatch, Vec3Tuple, WorldSnapshot, WorldStreamSample } from "@flight/protocol";
import { type Airport, type AirportIndex, type RunwayGeometry, airportDetail, runwayGeometry } from "./airports.ts";
import { AnchorFrame, type RunwayAnchor, type SimVector, airfieldBlend, runwayAnchor, surveyedRunwayAnchor } from "./anchor.ts";
import { attributionFor } from "./attribution.ts";
import { type MeshContext, aerowaysMesh, buildingsMesh } from "./feature-mesh.ts";
import { FEATURE_ZOOM, FeatureWorld, featureTile } from "./features-world.ts";
import { type GeoPosition, crossTrackDistance, destinationPoint, haversineDistance, initialBearing, normalizeBearing } from "./geodesy.ts";
import { GreatCircleRoute } from "./route.ts";
import { routePackTiles } from "./offline.ts";
import { SIM_ZOOM, SimulationWorld, extractSimulationTile } from "./sim-world.ts";
import { type TileSource, WorldStreamer } from "./streamer.ts";
import type { TerrainTile } from "./terrain.ts";
import { type TileId, lonLatToTile, tileKey, tilesInRadius } from "./tiles.ts";
import type { VectorFeatures, VectorSources } from "./vector.ts";

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
  /** Buildings and airport surfaces (vector tiles). Without it the world has terrain only. */
  features?: VectorSources;
  /** New and dropped building / airport-surface meshes (debounced). */
  onFeatures?: (add: FeaturePatch[], remove: string[]) => void;
  /** How long the surveyed-runway lookup may take before the synthesized runway is used (ms). */
  surveyTimeoutMs?: number;
  /** Destination airport ident and runway end for a cross-country flight. */
  destination?: string;
  destinationRunway?: string;
  /** Cruise altitude (m MSL) for the route autopilot; it climbs higher over terrain. Default 2,400 m. */
  cruiseAltM?: number;
  /** Re-anchor the local frame once the aircraft is this far from its origin (m). Default 25 km. */
  rebaseDistanceM?: number;
  /** Called after the local frame moved (the worker clears and re-sends meshes). */
  onRebase?: (epoch: number) => void;
}

/** The route autopilot's target, in the simulator's local frame (the shape `steerTo` in @flight/controller takes). */
export interface RouteTarget {
  mode: "TAKEOFF" | "CLIMB" | "CRUISE" | "DESCENT" | "FINAL" | "FLARE" | "ROLLOUT";
  heading: number; altitude: number; speed: number; maxBank: number; glideSlopeDeg: number; heightAboveGround: number;
  /** Target altitude above mean sea level (for display). */
  altMsl: number;
}
export const ROUTE_TUNING = { cruiseSpeed: 85, approachSpeed: 32, glideSlopeDeg: 3, finalApproachM: 12_000, touchdownM: 300, terrainClearanceM: 450, carrotM: 6000 } as const;
const RAD = Math.PI / 180;
const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
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
  /** Synthesized from OurAirports at first; replaced by the surveyed runway in `prepare` when the data has it. */
  runway: RunwayAnchor;
  state: "LOADING" | "READY" | "ERROR" = "LOADING";
  featuresState: "OFF" | "LOADING" | "READY" | "UNAVAILABLE";
  featuresDetail: string | undefined;
  readonly #features = new FeatureWorld();
  readonly #featureLoads = new Map<string, Promise<void>>();
  readonly #drawnFeatures = new Set<string>();
  detail: string | undefined;
  /** Set by the worker while it holds the clock for terrain (counted, and timed, for telemetry). */
  get holding() { return this.#holding; }
  set holding(v: boolean) {
    if (v && !this.#holding) { this.#holds++; this.#holdSince = performance.now(); }
    if (!v && this.#holding && this.#holdSince !== undefined) { this.#holdMs += performance.now() - this.#holdSince; this.#holdSince = undefined; }
    this.#holding = v;
  }
  #holding = false;
  #holds = 0;
  #holdMs = 0;
  #holdSince: number | undefined;
  #frame: AnchorFrame;
  #elevation: number;
  readonly #sim = new SimulationWorld();
  readonly #simLoads = new Map<string, Promise<void>>();
  readonly #streamer: WorldStreamer;
  readonly #drawn = new Set<string>();
  readonly #flat: number;
  readonly #blend: number;
  #manifest: string | undefined;
  #manifestGeneration = 0;
  #markers: GeoAirportMarker[] = [];
  #last: { x: number; z: number; heading: number } | undefined;
  #patchTimer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;
  // Frame re-anchoring: the departure ("home") airfield stays where it is on Earth; its place in the local frame moves.
  #epoch = 0;
  /** The local frame no longer has its origin on the home runway (so the airfield is no longer the y = 0 plane). */
  #rebased = false;
  #homeGeo: GeoPosition;
  #homeLocal = { x: 0, z: 0, yaw: 0, y: 0 };
  readonly #rebaseM: number;
  // Cross-country flight
  readonly destination: Airport | undefined;
  destinationRunway: RunwayAnchor | undefined;
  #destElevation = 0;
  #route: GreatCircleRoute | undefined;
  readonly #runwayCache = new Map<string, RunwayGeometry[]>();
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
    this.featuresState = options.features ? "LOADING" : "OFF";
    this.#homeGeo = { ...this.runway.anchor };
    this.#rebaseM = options.rebaseDistanceM ?? 25_000;
    if (options.destination) {
      const d = options.airports.find(options.destination);
      if (!d) throw new Error(`unknown destination ${options.destination}`);
      if (d.ident === a.ident) throw new Error("destination is the departure airport");
      this.destination = d;
      this.destinationRunway = this.#bestRunway(d, options.destinationRunway);
    }
    this.#streamer = new WorldStreamer({
      sources: [options.terrain, ...(options.features ? [options.features.buildings, options.features.airports] : [])],
      cacheBytes: options.cacheBytes ?? 192 * 1024 * 1024, maxConcurrent: options.maxConcurrent ?? 6,
      onTile: () => this.#schedulePatches(), onEvict: () => this.#schedulePatches(),
    });
  }
  get frame() { return this.#frame; }
  get simulationWorld() { return this.#sim; }
  get elevation() { return this.#elevation; }

  /** Loads the physics terrain around the runway and fixes the runway elevation from the DEM. */
  async prepare(): Promise<void> {
    await this.#survey();
    if (this.#disposed) return;
    try {
      const p = this.runway.anchor;
      await this.#ensureTiles(this.#neighbourhood(p));
      if (this.#disposed) return;
      const e = this.#sim.elevationAt(p.lat, p.lon);
      this.#elevation = e === null ? p.altMsl : Math.max(0, e);
      this.#frame = new AnchorFrame({ ...p, altMsl: this.#elevation }, this.runway.headingDegT);
      this.#homeGeo = { ...p, altMsl: this.#elevation };
      if (this.destination) await this.#prepareDestination();
      this.state = "READY";
      this.#last = undefined;
      if (this.featuresState === "LOADING") { await this.#ensureFeatures(this.#featureNeighbourhood(p)); this.featuresState = "READY"; }
    } catch (e) {
      this.state = "ERROR";
      this.detail = `Real terrain unavailable (${e instanceof Error ? e.message : String(e)}); flying over a flat world.`;
    }
    this.options.onChange?.();
  }

  /** Destination runway end: the named one, else the one most into the average wind-less choice (longest runway, end facing along the route). */
  #bestRunway(d: Airport, ident?: string): RunwayAnchor {
    if (ident) return runwayAnchor(d, ident, 0);
    const rw = [...d.runways].filter(r => !r.closed).sort((x, y) => (y.lengthM ?? 0) - (x.lengthM ?? 0))[0];
    if (!rw) throw new Error(`${d.ident} has no open runway`);
    const inbound = initialBearing(this.airport.position, d.position);
    const le = runwayAnchor(d, rw.le.ident, 0), he = runwayAnchor(d, rw.he.ident, 0);
    const off = (h: number) => Math.abs(((h - inbound + 540) % 360) - 180);
    return off(le.headingDegT) <= off(he.headingDegT) ? le : he;
  }
  /**
   * Before the flight: survey the destination runway (when features are on), load the terrain around it, fix its
   * elevation, and plan the route through a final-approach fix on the extended centreline. All of this is decided
   * before the clock starts, so the route autopilot's decisions never depend on network timing.
   */
  async #prepareDestination() {
    const d = this.destination!;
    let rw = this.destinationRunway!;
    const src = this.options.features;
    if (src && this.featuresState !== "UNAVAILABLE") {
      try {
        const data = await Promise.all(tilesInRadius(d.position, 4000, FEATURE_ZOOM).map(t => src.load(t, this.#abort.signal)));
        rw = surveyedRunwayAnchor(rw, d.position, data.flatMap(x => x.aeroways), 0) ?? rw;
      } catch { /* keep the catalogue runway */ }
    }
    await this.#ensureTiles(this.#neighbourhood(rw.anchor));
    const e = this.#sim.elevationAt(rw.anchor.lat, rw.anchor.lon);
    this.#destElevation = e === null ? d.position.altMsl : Math.max(0, e);
    this.destinationRunway = rw = { ...rw, anchor: { ...rw.anchor, altMsl: this.#destElevation } };
    const faf = destinationPoint(rw.anchor, rw.headingDegT + 180, ROUTE_TUNING.finalApproachM);
    this.#route = new GreatCircleRoute([{ ...this.runway.anchor, altMsl: 0 }, { ...faf, altMsl: 0 }, { ...rw.anchor, altMsl: 0 }], 10_000);
  }
  get route() { return this.#route; }

  /** Places the runway from surveyed data when the vector source has it; marks the source unavailable if unreachable. */
  async #survey() {
    const src = this.options.features;
    if (!src) return;
    // One slow or failed tile must not switch buildings off for the whole flight: only a source that answers none of the
    // tiles around the airport (before the timeout) is unavailable. Tiles that failed here are retried as the flight
    // needs them.
    const tiles = tilesInRadius(this.airport.position, 4000, FEATURE_ZOOM);
    const got: VectorFeatures[] = [];
    let lastError: unknown;
    const all = Promise.all(tiles.map(t => src.load(t, this.#abort.signal).then(v => { got.push(v); }, e => { lastError = e; })));
    await Promise.race([all, new Promise(r => setTimeout(r, this.options.surveyTimeoutMs ?? 20_000))]);
    if (this.#disposed) return;
    if (!got.length) {
      // Decided once, before the flight: every feature tile of this flight is then empty (the manifest records it).
      this.featuresState = "UNAVAILABLE";
      const why = lastError === undefined ? "timed out" : lastError instanceof Error ? lastError.message : String(lastError);
      this.featuresDetail = `Buildings and airport surfaces unavailable (${why}).`;
      return;
    }
    const surveyed = surveyedRunwayAnchor(this.runway, this.airport.position, got.flatMap(d => d.aeroways));
    if (surveyed) { this.runway = surveyed; this.#elevation = surveyed.anchor.altMsl; this.#frame = new AnchorFrame(surveyed.anchor, surveyed.headingDegT); }
  }

  #featureNeighbourhood(p: { lat: number; lon: number }): TileId[] {
    const c = lonLatToTile(p.lon, p.lat, FEATURE_ZOOM), n = 2 ** FEATURE_ZOOM, out: TileId[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const y = c.y + dy;
      if (y >= 0 && y < n) out.push({ z: FEATURE_ZOOM, x: (c.x + dx + n) % n, y });
    }
    return out;
  }
  #ensureFeatures(tiles: TileId[]): Promise<void> | null {
    if (this.featuresState === "OFF") return null;
    const missing = tiles.filter(t => !this.#features.has(t));
    if (!missing.length) return null;
    return Promise.all(missing.map(t => {
      const key = tileKey(t);
      let p = this.#featureLoads.get(key);
      if (!p) { p = this.#loadFeatureTile(t).finally(() => this.#featureLoads.delete(key)); this.#featureLoads.set(key, p); }
      return p;
    })).then(() => undefined);
  }
  async #loadFeatureTile(t: TileId): Promise<void> {
    const src = this.options.features!, retries = this.options.simRetries ?? 3;
    if (this.featuresState === "UNAVAILABLE") { this.#features.add({ tile: t, buildings: [], runways: [] }); this.#manifestChanged(); return; }
    for (let attempt = 0; ; attempt++) {
      try {
        const v = await src.load(t, this.#abort.signal);
        if (this.#disposed) return;
        this.#features.add(featureTile(v));
        break;
      } catch (e) {
        if (this.#disposed) return;
        if (attempt + 1 >= retries) {
          this.#features.add({ tile: t, buildings: [], runways: [] });
          this.featuresDetail = `Feature tile ${tileKey(t)} unavailable; treated as empty.`;
          break;
        }
        await new Promise(r => setTimeout(r, 250 * 2 ** attempt));
      }
    }
    this.#manifestChanged();
  }
  #manifestChanged() {
    // Hashes finish out of order when tiles land together: only the latest generation may set the manifest.
    const generation = ++this.#manifestGeneration;
    this.#manifest = undefined;
    void Promise.all([this.#sim.checksum(), this.#features.checksum()]).then(async ([terrain, features]) => {
      if (this.#disposed || generation !== this.#manifestGeneration) return;
      const both = this.featuresState === "OFF" ? terrain : [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${terrain}|${features}`)))].map(x => x.toString(16).padStart(2, "0")).join("");
      if (this.#disposed || generation !== this.#manifestGeneration) return;
      this.#manifest = both;
      this.options.onChange?.();
    });
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
          // Before READY a failure means real terrain is unavailable (prepare reports it); tiles still retrying after
          // that must not overwrite the explanation or add sea-level tiles to a world that is already flat.
          if (this.state !== "READY") throw e;
          // Keep flying: record the tile as sea level. The manifest hash shows it differs from the real tile.
          this.#sim.add(extractSimulationTile(t, () => 0));
          this.detail = `Terrain tile ${tileKey(t)} unavailable; treated as sea level.`;
          break;
        }
        await new Promise(r => setTimeout(r, 250 * 2 ** attempt));
      }
    }
    this.#manifestChanged();
  }

  /**
   * Starts loading any physics tile missing around (x, z) and returns a promise for it, or null when the terrain
   * there is complete and the clock may run.
   */
  ensureAround(x: number, z: number): Promise<void> | null {
    if (this.state !== "READY") return null;
    const g = this.#frame.toGeo({ x, y: 0, z });
    // Cheap enough to call every tick: once a neighbourhood is complete it stays complete (tiles are never dropped).
    const key = `${this.#epoch}|${tileKey(lonLatToTile(g.lon, g.lat, SIM_ZOOM))}|${tileKey(lonLatToTile(g.lon, g.lat, FEATURE_ZOOM))}`;
    if (key === this.#completeAt) return null;
    const a = this.#ensureTiles(this.#neighbourhood(g)), b = this.#ensureFeatures(this.#featureNeighbourhood(g));
    if (!a && !b) { this.#completeAt = key; return null; }
    return Promise.all([a, b]).then(() => undefined);
  }
  #completeAt = "";

  /** 0 on the home airfield (wherever it now is in the local frame), 1 on open terrain. */
  #blendAt(x: number, z: number) { return airfieldBlend(x - this.#homeLocal.x, z - this.#homeLocal.z, this.#flat, this.#blend); }
  /** Terrain height (no buildings) under local (x, z), relative to the local frame. */
  terrainY(x: number, z: number): number {
    if (this.state !== "READY") return 0;
    const t = this.#blendAt(x, z);
    if (t === 0 && !this.#rebased) return 0;
    const g = this.#frame.toGeo({ x, y: 0, z }), e = this.#sim.elevationAt(g.lat, g.lon);
    const terrain = e === null ? this.#elevation : Math.max(0, e);
    return this.#frame.fromGeo({ lat: g.lat, lon: g.lon, altMsl: this.#elevation + t * (terrain - this.#elevation) }).y;
  }
  /**
   * Physics surface under local (x, z): terrain plus the roof of any building there. Pure function of the loaded
   * physics tiles. The airfield is flat and free of real buildings.
   */
  readonly ground = (x: number, z: number): number => {
    const y = this.terrainY(x, z);
    if (this.#blendAt(x, z) === 0) return y;
    const g = this.#frame.toGeo({ x, y: 0, z });
    return y + this.#features.buildingTopAt(g.lon, g.lat);
  };
  /** Real runways away from the airfield: a gentle touchdown there is a landing, not terrain contact. */
  readonly landable = (x: number, z: number): boolean => {
    if (this.state !== "READY") return false;
    // Before the first re-anchoring the home airfield is the flat y = 0 plane (no terrain contact there at all).
    if (this.#blendAt(x, z) === 0) return this.#rebased;
    const g = this.#frame.toGeo({ x, y: 0, z });
    return !!this.#features.runwayAt(g.lon, g.lat) || !!this.catalogRunwayAt(g.lat, g.lon);
  };
  /**
   * Runway from the airport catalogue (surveyed thresholds when OurAirports has them, else synthesized) under a
   * point: keeps every catalogue runway landable even when buildings/aeroway data is unavailable.
   */
  catalogRunwayAt(lat: number, lon: number): RunwayGeometry | undefined {
    for (const { airport: a } of this.options.airports.within({ lat, lon }, 6000)) {
      let rws = this.#runwayCache.get(a.ident);
      if (!rws) { rws = a.runways.filter(r => !r.closed).map(r => runwayGeometry(a, r)).filter((g): g is RunwayGeometry => !!g); this.#runwayCache.set(a.ident, rws); }
      for (const r of rws) {
        const kx = Math.cos(r.le.lat * RAD) * 111_320, ky = 110_574;
        const ex = (r.he.lon - r.le.lon) * kx, ey = (r.he.lat - r.le.lat) * ky, len = Math.hypot(ex, ey);
        if (!len) continue;
        const px = (lon - r.le.lon) * kx, py = (lat - r.le.lat) * ky, along = (px * ex + py * ey) / len, cross = Math.abs(px * ey - py * ex) / len;
        if (along >= -30 && along <= len + 30 && cross <= Math.max(r.widthM, 30) / 2) return r;
      }
    }
    return undefined;
  }

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
      const onField = (v: SimVector) => this.#blendAt(v.x, v.z) === 0;
      const place = (p: GeoPosition, lift: number): Vec3Tuple => { const v = this.#frame.fromGeo({ ...p, altMsl: a.position.altMsl }); return three({ ...v, y: (onField(v) ? this.terrainY(v.x, v.z) : v.y) + lift }); };
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
    if (this.#patchTimer || this.#disposed || (!this.options.onPatches && !this.options.onFeatures)) return;
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
    if (!this.options.onFeatures) return;
    const wantF = new Map<string, { layer: string; value: VectorFeatures }>();
    for (const t of this.#streamer.visible()) if (t.layer === "buildings" || t.layer === "airports") wantF.set(`${t.layer}:${tileKey(t.tile)}`, { layer: t.layer, value: t.value as VectorFeatures });
    const addF: FeaturePatch[] = [], removeF: string[] = [];
    for (const [k, t] of wantF) {
      if (this.#drawnFeatures.has(k)) continue;
      this.#drawnFeatures.add(k);
      const p = t.layer === "buildings" ? buildingsMesh(t.value, this.#meshContext) : aerowaysMesh(t.value, this.#meshContext);
      if (p.positions.length || p.lights?.length) addF.push(p);
    }
    for (const k of [...this.#drawnFeatures]) if (!wantF.has(k)) { removeF.push(k); this.#drawnFeatures.delete(k); }
    if (addF.length || removeF.length) this.options.onFeatures(addF, removeF);
  }
  readonly #meshContext: MeshContext = {
    toLocal: (lon, lat) => this.#frame.fromGeo({ lat, lon, altMsl: this.#elevation }),
    terrainY: (x, z) => this.terrainY(x, z),
    onAirfield: (x, z) => this.#blendAt(x, z) === 0,
  };

  /** Mesh for one DEM tile in the renderer's frame (three.js x = −local x). */
  mesh(t: TerrainTile): TerrainPatch {
    const seg = this.options.meshSegments ?? (t.tile.z >= 12 ? 32 : 24), n = seg + 1, N = 2 ** t.tile.z;
    const verts: Vec3Tuple[] = [], colors = new Uint8Array(n * n * 3), drop = 0.6 + levelDrop(t.tile.z);
    for (let j = 0; j < n; j++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (t.tile.y + j / seg)) / N))) * 180 / Math.PI;
      for (let i = 0; i < n; i++) {
        const lon = ((t.tile.x + i / seg) / N) * 360 - 180, h = t.sample(lat, lon), water = h <= 0.5, alt = Math.max(0, h);
        let v = this.#frame.fromGeo({ lat, lon, altMsl: alt });
        const b = this.#blendAt(v.x, v.z);
        if (b < 1) v = { ...v, y: v.y + (this.#elevation + b * (alt - this.#elevation) - alt) };
        const y = v.y - drop; // on the airfield v.y is the airfield plane (0 before any re-anchoring)
        verts.push(three({ ...v, y }));
        colors.set(colour(alt, water), (j * n + i) * 3);
      }
    }
    // Skirts: each edge is repeated once at the surface and once `skirt` metres lower, joined by a vertical strip facing
    // outwards. Neighbouring tiles (another zoom, or the same one rounded differently in float32) never meet exactly, and
    // without skirts the sky shows through as dotted white lines along tile edges. The surface copy keeps the strip out
    // of the top surface's vertex normals.
    const skirt = 30 + 2 * levelDrop(t.tile.z), edges = [[...Array(n).keys()].map(i => i), [...Array(n).keys()].map(j => j * n + seg), [...Array(n).keys()].map(i => seg * n + seg - i), [...Array(n).keys()].map(j => (seg - j) * n)];
    const skirtColors: number[] = [], skirtTris: number[] = [];
    const mid = verts[Math.floor(n / 2) * n + Math.floor(n / 2)]!;
    for (const edge of edges) for (let s = 0; s < seg; s++) {
      const p = edge[s]!, q = edge[s + 1]!, base = verts.length;
      verts.push(verts[p]!, verts[q]!, [verts[p]![0], verts[p]![1] - skirt, verts[p]![2]], [verts[q]![0], verts[q]![1] - skirt, verts[q]![2]]);
      for (const v of [p, q, p, q]) skirtColors.push(colors[v * 3]!, colors[v * 3 + 1]!, colors[v * 3 + 2]!);
      // Wind the strip so its face points away from the tile's middle (three.js's mirrored x makes this easiest to test).
      const [P, Q] = [verts[p]!, verts[q]!], ex = Q[0] - P[0], ez = Q[2] - P[2], ox = (P[0] + Q[0]) / 2 - mid[0], oz = (P[2] + Q[2]) / 2 - mid[2];
      // Normal of (P, P↓, Q) is (P↓−P)×(Q−P) = (0,−1,0)×(ex,·,ez) = (−ez, 0, ex).
      skirtTris.push(...(-ez * ox + ex * oz >= 0 ? [base, base + 2, base + 1, base + 1, base + 2, base + 3] : [base, base + 1, base + 2, base + 1, base + 3, base + 2]));
    }
    const c = mid, positions = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => positions.set([v[0] - c[0], v[1] - c[1], v[2] - c[2]], i * 3));
    const allColors = new Uint8Array(verts.length * 3);
    allColors.set(colors); allColors.set(skirtColors, colors.length);
    const indices = new Uint16Array(seg * seg * 6 + skirtTris.length);
    let k = 0;
    // three.js x is mirrored, so the winding is flipped to keep faces pointing up.
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * n + i, b = a + 1, d = a + n, e = d + 1; indices.set([a, d, b, b, d, e], k); k += 6; }
    indices.set(skirtTris, k);
    return { key: tileKey(t.tile), z: t.tile.z, center: c, positions, colors: allColors, indices };
  }

  // ---- Cross-country: route autopilot target, re-anchoring, arrival

  /**
   * What the route autopilot should fly now (pure function of the world snapshot and data loaded before the
   * flight or guaranteed by the hold rule): take off, climb and cruise along the great circle at a terrain-safe
   * altitude, descend on a 3° profile, then intercept the destination centreline, glide, flare and roll out.
   */
  routeTarget(w: WorldSnapshot): RouteTarget | undefined {
    const route = this.#route, rw = this.destinationRunway;
    if (!route || !rw || this.state !== "READY") return undefined;
    const T = ROUTE_TUNING, a = w.aircraft, p = a.position, hag = p.y - this.ground(p.x, p.z);
    const g = this.#frame.toGeo(p), speed = Math.hypot(a.velocity.x, a.velocity.z);
    // Runway geometry in the local frame.
    const th = this.#frame.fromGeo(rw.anchor), ahead = this.#frame.fromGeo({ ...destinationPoint(rw.anchor, rw.headingDegT, 1000), altMsl: rw.anchor.altMsl });
    const ux = (ahead.x - th.x) / 1000, uz = (ahead.z - th.z) / 1000, rwHeading = Math.atan2(ux, uz);
    const along = (p.x - th.x) * ux + (p.z - th.z) * uz, cross = (p.x - th.x) * uz - (p.z - th.z) * ux;
    const toTouchdown = T.touchdownM - along;
    const localAlt = (msl: number) => this.#frame.fromGeo({ lat: g.lat, lon: g.lon, altMsl: msl }).y;
    const make = (mode: RouteTarget["mode"], heading: number, altMsl: number, spd: number, maxBank: number, altitude = localAlt(altMsl)): RouteTarget =>
      ({ mode, heading, altitude, speed: spd, maxBank, glideSlopeDeg: T.glideSlopeDeg, heightAboveGround: hag, altMsl });
    const onDestination = along > -200 && along < (rw.lengthM ?? 2500) + 200 && Math.abs(cross) < 60;
    // Down (or skimming the runway below flare speed after touchdown): roll out, even where the runway slopes away.
    if ((a.grounded || hag < 0.5) && onDestination && along > -150) return make("ROLLOUT", rwHeading - Math.max(-.2, Math.min(.2, cross * .01)), this.#destElevation, 0, .05, p.y);
    if ((a.grounded || hag < 2.5) && speed < 30 && !onDestination) return make("TAKEOFF", a.heading, g.altMsl + 80, T.cruiseSpeed, .05, p.y + 80);
    const aligned = Math.abs(wrapPi(a.heading - rwHeading)) < .6 && Math.abs(cross) < 1500 && along > -T.finalApproachM - 3000 && along < T.touchdownM + 500;
    if (aligned) {
      const glideMsl = this.#destElevation + Math.max(0, toTouchdown) * Math.tan(T.glideSlopeDeg * RAD);
      const heading = rwHeading - Math.max(-.35, Math.min(.35, cross * .004));
      if (hag < 1.5 && Math.abs(cross) < 60 && along > -150) return make("FLARE", heading, this.#destElevation, T.approachSpeed - 6, .05);
      return make("FINAL", heading, glideMsl, toTouchdown < 2500 ? T.approachSpeed : Math.min(T.cruiseSpeed, 55), hag < 20 ? .12 : .35);
    }
    // En route: fly towards a carrot on the great circle; the route runs through the final-approach fix, so the carrot
    // leads onto the extended centreline.
    const pr = route.progress(g), carrot = this.#frame.fromGeo({ ...route.pointAt(Math.min(route.totalM, pr.alongM + T.carrotM)), altMsl: 0 });
    const heading = Math.atan2(carrot.x - p.x, carrot.z - p.z);
    const safe = this.#terrainAhead(g, this.#frame.bearing(heading)) + T.terrainClearanceM;
    const cruise = Math.max(this.options.cruiseAltM ?? 2400, safe);
    const profile = this.#destElevation + (route.totalM - pr.alongM + T.touchdownM) * Math.tan(T.glideSlopeDeg * RAD) + 150;
    const target = Math.max(Math.min(cruise, profile), safe);
    const mode = target > g.altMsl + 30 ? "CLIMB" : target < g.altMsl - 30 ? "DESCENT" : "CRUISE";
    return make(mode, heading, target, T.cruiseSpeed, .5);
  }

  /**
   * Re-anchors the local frame under the aircraft once it is `rebaseDistanceM` from the origin, transforming the
   * aircraft and entities exactly (through WGS84) so the physics sees a level local "up" and small coordinates on
   * long flights. Deterministic: decided from the snapshot alone. Returns the transformed snapshot, or undefined.
   */
  maybeRebase<S extends { aircraft: AircraftState; entities: readonly EntityState[] }>(s: S): S | undefined {
    if (this.state !== "READY") return undefined;
    const p = s.aircraft.position;
    if (Math.hypot(p.x, p.z) <= this.#rebaseM) return undefined;
    const old = this.#frame, g = old.toGeo({ x: p.x, y: 0, z: p.z });
    const next = new AnchorFrame({ lat: g.lat, lon: g.lon, altMsl: this.#elevation }, old.headingDeg);
    const point = (v: { x: number; y: number; z: number }) => next.fromGeo(old.toGeo(v));
    const dir = (at: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, scale = 1) => {
      const a = point(at), b = point({ x: at.x + d.x * scale, y: at.y + d.y * scale, z: at.z + d.z * scale });
      return { x: (b.x - a.x) / scale, y: (b.y - a.y) / scale, z: (b.z - a.z) / scale };
    };
    const a = s.aircraft, f = dir(p, { x: Math.sin(a.heading) * Math.cos(a.pitch), y: Math.sin(a.pitch), z: Math.cos(a.heading) * Math.cos(a.pitch) }, 100);
    const heading = a.heading + wrapPi(Math.atan2(f.x, f.z) - a.heading), pitch = Math.asin(Math.max(-1, Math.min(1, f.y / Math.hypot(f.x, f.y, f.z))));
    const aircraft: AircraftState = { ...a, position: point(p), velocity: dir(p, a.velocity, 10), heading, pitch };
    const entities = s.entities.map(e => ({ ...e, position: point(e.position), velocity: dir(e.position, e.velocity, 10) }));
    this.#setFrame(next, true);
    return { ...s, aircraft, entities };
  }
  /** Back to the frame anchored on the home runway (a new flight starts there). No-op unless the flight re-anchored. */
  resetFrame() {
    if (!this.#rebased) return;
    this.#setFrame(new AnchorFrame(this.#homeGeo, this.runway.headingDegT), false);
  }
  #setFrame(next: AnchorFrame, rebased: boolean) {
    this.#frame = next;
    this.#rebased = rebased;
    this.#epoch++;
    const home = next.fromGeo(this.#homeGeo), homeAhead = next.fromGeo({ ...destinationPoint(this.#homeGeo, this.runway.headingDegT, 1000), altMsl: this.#homeGeo.altMsl });
    this.#homeLocal = rebased ? { x: home.x, z: home.z, y: home.y, yaw: Math.atan2(homeAhead.x - home.x, homeAhead.z - home.z) } : { x: 0, z: 0, y: 0, yaw: 0 };
    this.#last = undefined;
    this.#drawn.clear();
    this.#drawnFeatures.clear();
    this.options.onRebase?.(this.#epoch);
    this.#schedulePatches();
  }
  get frameEpoch() { return this.#epoch; }
  #matrix: { frame: AnchorFrame; m: number[] } | undefined;
  #frameMatrix() { if (this.#matrix?.frame !== this.#frame) this.#matrix = { frame: this.#frame, m: this.#frame.ecefToThree() }; return this.#matrix.m; }
  /**
   * Highest terrain in a 2 km-wide corridor ahead, as far as the hold rule guarantees tiles are loaded (one z12 tile
   * width, ≤ 8 km), so the route autopilot's altitude is a pure function of the state.
   */
  #terrainAhead(g: GeoPosition, trackDeg: number): number {
    const reach = Math.min(8000, 40_075_016 * Math.cos(g.lat * RAD) / 2 ** SIM_ZOOM);
    let max = 0;
    for (const side of [-1000, 0, 1000]) {
      const start = side ? destinationPoint(g, trackDeg + 90, side) : g;
      for (let d = 0; d <= reach; d += 500) {
        const q = d ? destinationPoint(start, trackDeg, d) : start, e = this.#sim.elevationAt(q.lat, q.lon);
        if (e !== null && e > max) max = e;
      }
    }
    return max;
  }

  #routeStatus(pose: AircraftPose, w?: WorldSnapshot): GeoRouteStatus | undefined {
    const route = this.#route, rw = this.destinationRunway, d = this.destination;
    if (!route || !rw || !d) return undefined;
    const g = this.#frame.toGeo(pose.position), dist = haversineDistance(g, rw.anchor), gs = Math.hypot(pose.velocity.x, pose.velocity.z);
    const target = w ? this.routeTarget(w) : undefined;
    const path = [...route.waypoints].map(q => { const v = this.#frame.fromGeo({ ...q, altMsl: this.#elevation }); return three({ ...v, y: v.y }); });
    return {
      destination: d.ident, name: d.name, runway: rw.runway, runwayHeadingDeg: rw.headingDegT, surveyed: !rw.synthesized,
      distanceM: dist, bearingDeg: initialBearing(g, rw.anchor), crossTrackM: route.progress(g).crossTrackM, totalM: route.totalM,
      etaS: gs > 5 ? dist / gs : null, phase: target?.mode ?? "—", targetAltMsl: target?.altMsl ?? 0, path,
    };
  }

  status(pose: AircraftPose, w?: WorldSnapshot): GeoStatus {
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
      airports: this.#markers,
      attribution: [...attributionFor(this.featuresState === "OFF" ? ["terrain", "airports"] : ["terrain", "airports", "buildings"]),
        ...(this.options.features && /openfreemap\.org/.test(this.options.features.url) ? ["Vector tiles: OpenFreeMap · © OpenMapTiles"] : [])],
      features: { state: this.featuresState, tiles: this.#features.size, buildings: this.#features.buildingCount, ...(this.featuresDetail ? { detail: this.featuresDetail } : {}) },
      surveyed: !this.runway.synthesized,
      runwayBelow: this.state === "READY" && this.#blendAt(p.x, p.z) > 0 ? this.#runwayRef(geo) : null,
      surface: this.#surface(p, geo),
      frameEpoch: this.#epoch,
      frame: { lat: this.#frame.anchor.lat, lon: this.#frame.anchor.lon, altMsl: this.#frame.anchor.altMsl, headingDeg: this.#frame.headingDeg, ecefToThree: this.#frameMatrix() },
      home: { position: [-this.#homeLocal.x, this.#homeLocal.y, this.#homeLocal.z], rotationY: -this.#homeLocal.yaw },
      ...(this.#routeStatus(pose, w) ? { route: this.#routeStatus(pose, w)! } : {}),
      ...(this.#arrived(pose, w) ? { arrived: this.destination!.ident } : {}),
      catalogSize: this.options.airports.size,
    };
  }
  get featureWorld() { return this.#features; }
  /**
   * Offline route pack: loads every tile the route will need (`routePackTiles`) through the terrain and feature
   * sources, so a caching fetch behind them stores the lot. Resolves with the counts; never touches the physics world.
   */
  async packRoute(onProgress?: (p: { done: number; total: number; failed: number }) => void, concurrency = 6) {
    const route = this.#route;
    if (!route) throw new Error("no route to pack (set a destination)");
    const src = this.options.features, withFeatures = !!src && this.featuresState !== "UNAVAILABLE" && this.featuresState !== "OFF";
    const { terrain, features } = routePackTiles(route, { features: withFeatures, terrainMaxZoom: this.options.terrain.maxZoom });
    const jobs: (() => Promise<unknown>)[] = [...terrain.map(t => () => this.options.terrain.load(t, this.#abort.signal)), ...(withFeatures ? features.map(t => () => src!.load(t, this.#abort.signal)) : [])];
    let next = 0, done = 0, failed = 0;
    const worker = async () => {
      while (next < jobs.length && !this.#disposed) {
        const job = jobs[next++]!;
        try { await job(); } catch { failed++; }
        done++;
        onProgress?.({ done, total: jobs.length, failed });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
    return { done, total: jobs.length, failed };
  }
  /**
   * GeoTelemetry: what the physics has (and is missing) around the aircraft, how the render streamer is doing,
   * and whether the destination is ready. Observation only (timings are wall-clock); recorded in flight traces.
   */
  streamSample(pose: AircraftPose): WorldStreamSample {
    const g = this.#frame.toGeo(pose.position), s = this.#streamer.stats(), ready = this.state === "READY";
    const featuresOn = this.featuresState === "READY" || this.featuresState === "LOADING";
    const missing = ready ? this.#neighbourhood(g).filter(t => !this.#sim.has(t)).length + (featuresOn ? this.#featureNeighbourhood(g).filter(t => !this.#features.has(t)).length : 0) : 0;
    const d = this.destination, rw = this.destinationRunway;
    const dest = d && rw ? {
      ident: d.ident, distanceKm: Math.round(haversineDistance(g, rw.anchor) / 100) / 10,
      terrainReady: this.#neighbourhood(rw.anchor).every(t => this.#sim.has(t)),
      featuresReady: featuresOn ? this.#featureNeighbourhood(rw.anchor).every(t => this.#features.has(t)) : null,
    } : undefined;
    const holdMs = this.#holdMs + (this.#holding && this.#holdSince !== undefined ? performance.now() - this.#holdSince : 0);
    return {
      airport: this.airport.ident, state: this.state, frameEpoch: this.#epoch,
      position: { lat: Math.round(g.lat * 1e5) / 1e5, lon: Math.round(g.lon * 1e5) / 1e5, altMsl: Math.round(g.altMsl) },
      physics: { terrainTiles: this.#sim.size, featureTiles: this.#features.size, missingAround: missing, holding: this.#holding, holds: this.#holds, holdMs: Math.round(holdMs), ...(this.#manifest ? { manifest: this.#manifest } : {}) },
      render: {
        wanted: s.wanted, queued: s.queued, inFlight: s.inFlight, loaded: s.loaded, failed: s.failed, aborted: s.aborted, evictions: s.cache.evictions,
        cacheEntries: s.cache.entries, cacheMB: Math.round(s.cache.bytes / 1e5) / 10,
        hitRate: s.cache.hits + s.cache.misses ? Math.round(s.cache.hits / (s.cache.hits + s.cache.misses) * 1000) / 1000 : null,
        latencyP50Ms: s.latencyP50Ms === null ? null : Math.round(s.latencyP50Ms), latencyP95Ms: s.latencyP95Ms === null ? null : Math.round(s.latencyP95Ms),
      },
      features: this.featuresState,
      ...(dest ? { destination: dest } : {}),
    };
  }
  #surface(p: SimVector, g: GeoPosition): GeoStatus["surface"] {
    if (this.state !== "READY" || this.#blendAt(p.x, p.z) === 0) return "AIRFIELD";
    if (this.#features.buildingTopAt(g.lon, g.lat) > 0) return "BUILDING";
    return this.landable(p.x, p.z) ? "RUNWAY" : "TERRAIN";
  }
  #runwayRef(g: GeoPosition): string | null {
    const f = this.#features.runwayAt(g.lon, g.lat);
    if (f) return f.ref ?? "runway";
    const c = this.catalogRunwayAt(g.lat, g.lon);
    return c ? `${c.airport} ${c.ident}` : null;
  }
  /** Landed and slowed on the destination's runways (a pure function of the snapshot and the preloaded data). */
  arrived(w: { aircraft: AircraftState }) { return this.#arrived({ position: w.aircraft.position, velocity: w.aircraft.velocity, heading: w.aircraft.heading }, w as WorldSnapshot); }
  #arrived(pose: AircraftPose, w?: WorldSnapshot) {
    const d = this.destination;
    if (!d || !w?.aircraft.grounded || w.aircraft.crashed || Math.hypot(pose.velocity.x, pose.velocity.z) > 8) return false;
    const g = this.#frame.toGeo(pose.position), c = this.catalogRunwayAt(g.lat, g.lon);
    return (c?.airport === d.ident) || (!!this.#features.runwayAt(g.lon, g.lat) && haversineDistance(g, d.position) < 6000);
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
