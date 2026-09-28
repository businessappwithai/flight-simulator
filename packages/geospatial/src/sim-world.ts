/**
 * The deterministic simulation world: the only geography that physics, sensors, safety and the AI pilot may read.
 *
 * Rendering can stream whatever it likes, whenever it arrives. The simulation world instead holds an explicit set of
 * simplified tiles at one fixed zoom (a coarse elevation grid in whole decimetres, obstacle boxes, runway surfaces),
 * and every query depends only on *which* tiles are present, never on load order or timing. Its manifest (tile keys
 * + per-tile SHA-256) is what a replay or an ExperienceForest record stores, so a replay rebuilds the same world.
 */
import { type GeoPosition, destinationPoint, haversineDistance } from "./geodesy.ts";
import type { RunwayGeometry } from "./airports.ts";
import type { TerrainTile } from "./terrain.ts";
import { type LonLatBounds, type TileId, lonLatToTile, lonLatToTileFraction, parseTileKey, tileKey } from "./tiles.ts";

/** z12 tiles are ~9.8 km at the equator; with 97 samples that is a ~100 m grid (less towards the poles). */
export const SIM_ZOOM = 12;
export const SIM_GRID = 97;

export interface ObstacleVolume { id: string; bounds: LonLatBounds; baseMslM: number; topMslM: number }
export interface SimulationTile {
  tile: TileId;
  /** SIM_GRID × SIM_GRID elevations in decimetres, row-major from the tile's north-west corner, corners inclusive. */
  elevationDm: Int32Array;
  obstacles: ObstacleVolume[];
  runways: RunwayGeometry[];
}
export interface SerializedSimulationTile { tile: string; elevationDm: number[]; obstacles: ObstacleVolume[]; runways: RunwayGeometry[] }
export interface ManifestEntry { tile: string; sha256: string }

/** Tile coordinates of grid sample (i, j): corners inclusive, so neighbouring tiles share their edge samples exactly. */
function samplePosition(t: TileId, i: number, j: number) {
  const n = 2 ** t.z, x = t.x + i / (SIM_GRID - 1), y = t.y + j / (SIM_GRID - 1);
  return { lon: (x / n) * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180 / Math.PI };
}

/**
 * Down-sample a DEM tile to a simulation tile. `sample` is any elevation lookup covering the tile (usually a
 * `TerrainTile` at the same or a deeper zoom, or a function stitching several).
 */
export function extractSimulationTile(tile: TileId, sample: TerrainTile | ((lat: number, lon: number) => number), extras: { obstacles?: ObstacleVolume[]; runways?: RunwayGeometry[] } = {}): SimulationTile {
  if (tile.z !== SIM_ZOOM) throw new Error(`simulation tiles are z${SIM_ZOOM}, got ${tileKey(tile)}`);
  const f = typeof sample === "function" ? sample : (lat: number, lon: number) => sample.sample(lat, lon);
  const elevationDm = new Int32Array(SIM_GRID * SIM_GRID);
  for (let j = 0; j < SIM_GRID; j++) for (let i = 0; i < SIM_GRID; i++) {
    const p = samplePosition(tile, i, j);
    elevationDm[j * SIM_GRID + i] = Math.round(f(p.lat, p.lon) * 10);
  }
  return { tile, elevationDm, obstacles: [...(extras.obstacles ?? [])].sort(byId), runways: [...(extras.runways ?? [])].sort(byRunway) };
}
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byRunway = (a: RunwayGeometry, b: RunwayGeometry) => `${a.airport}:${a.ident}`.localeCompare(`${b.airport}:${b.ident}`);

/** Axis-aligned (lon/lat) obstacle box for a building footprint extruded to `heightM` above `baseMslM`. */
export function buildingVolume(id: string, footprint: readonly { lat: number; lon: number }[], baseMslM: number, heightM: number): ObstacleVolume {
  if (!footprint.length) throw new Error(`building ${id}: empty footprint`);
  const lats = footprint.map(p => p.lat), lons = footprint.map(p => p.lon);
  return { id, bounds: { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) }, baseMslM, topMslM: baseMslM + Math.max(0, heightM) };
}

function canonicalBytes(t: SimulationTile): Uint8Array<ArrayBuffer> {
  const head = new TextEncoder().encode(JSON.stringify({ tile: tileKey(t.tile), grid: SIM_GRID, obstacles: t.obstacles, runways: t.runways }));
  const out = new Uint8Array(head.length + t.elevationDm.byteLength);
  out.set(head, 0);
  const dv = new DataView(out.buffer, head.length);
  t.elevationDm.forEach((v, i) => dv.setInt32(i * 4, v, true));
  return out;
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
/** SHA-256 of a tile's canonical bytes (WebCrypto, so it runs in browser workers as well as Bun). */
export const simulationTileHash = async (t: SimulationTile) => hex(await crypto.subtle.digest("SHA-256", canonicalBytes(t)));

export class SimulationWorld {
  readonly #tiles = new Map<string, { tile: SimulationTile; hash?: Promise<string> }>();

  add(t: SimulationTile) {
    if (t.tile.z !== SIM_ZOOM || t.elevationDm.length !== SIM_GRID * SIM_GRID) throw new Error(`bad simulation tile ${tileKey(t.tile)}`);
    this.#tiles.set(tileKey(t.tile), { tile: t });
  }
  remove(tile: TileId) { return this.#tiles.delete(tileKey(tile)); }
  has(tile: TileId) { return this.#tiles.has(tileKey(tile)); }
  get size() { return this.#tiles.size; }

  /** Sorted tile keys and hashes: record this with a flight to replay it in the same world. */
  async manifest(): Promise<ManifestEntry[]> {
    const keys = [...this.#tiles.keys()].sort();
    return Promise.all(keys.map(async tile => ({ tile, sha256: await this.#hash(tile) })));
  }
  #hash(key: string) {
    const e = this.#tiles.get(key)!;
    return (e.hash ??= simulationTileHash(e.tile));
  }
  async checksum() { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(await this.manifest())))); }
  /** Tiles a replay needs but this world lacks or has different content for. */
  async missingFrom(manifest: readonly ManifestEntry[]): Promise<string[]> {
    const out: string[] = [];
    for (const m of manifest) if (!this.#tiles.has(m.tile) || (await this.#hash(m.tile)) !== m.sha256) out.push(m.tile);
    return out;
  }

  serialize(): SerializedSimulationTile[] {
    return [...this.#tiles.keys()].sort().map(key => { const t = this.#tiles.get(key)!.tile; return { tile: key, elevationDm: [...t.elevationDm], obstacles: t.obstacles, runways: t.runways }; });
  }
  static deserialize(tiles: readonly SerializedSimulationTile[]) {
    const w = new SimulationWorld();
    for (const s of tiles) w.add({ tile: parseTileKey(s.tile), elevationDm: Int32Array.from(s.elevationDm), obstacles: s.obstacles, runways: s.runways });
    return w;
  }

  /** Terrain elevation (m MSL) or `null` where no simulation tile is loaded (callers must treat that as unknown). */
  elevationAt(lat: number, lon: number): number | null {
    const t = lonLatToTile(lon, lat, SIM_ZOOM), e = this.#tiles.get(tileKey(t));
    if (!e) return null;
    const f = lonLatToTileFraction(lon, lat, SIM_ZOOM), g = SIM_GRID - 1;
    const px = Math.max(0, Math.min(g, (f.x - t.x) * g)), py = Math.max(0, Math.min(g, (f.y - t.y) * g));
    const x0 = Math.min(g - 1, Math.floor(px)), y0 = Math.min(g - 1, Math.floor(py)), tx = px - x0, ty = py - y0, h = e.tile.elevationDm;
    const at = (x: number, y: number) => h[y * SIM_GRID + x]! / 10;
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  }
  terrainClearance(p: GeoPosition): number | null {
    const e = this.elevationAt(p.lat, p.lon);
    return e === null ? null : p.altMsl - e;
  }

  /** Highest terrain along a straight line ahead, sampled every `stepM`; unknown samples are counted, not guessed. */
  terrainAhead(p: GeoPosition, trackDeg: number, distanceM: number, stepM = 500) {
    let maxM: number | null = null, atM = 0, unknown = 0, samples = 0;
    for (let d = 0; d <= distanceM; d += stepM) {
      const q = destinationPoint(p, trackDeg, d), e = this.elevationAt(q.lat, q.lon);
      samples++;
      if (e === null) { unknown++; continue; }
      if (maxM === null || e > maxM) { maxM = e; atM = d; }
    }
    return { maxElevationM: maxM, atDistanceM: atM, unknownFraction: samples ? unknown / samples : 1 };
  }

  #near(p: { lat: number; lon: number }) {
    const t = lonLatToTile(p.lon, p.lat, SIM_ZOOM), n = 2 ** SIM_ZOOM, out: SimulationTile[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const e = this.#tiles.get(`${SIM_ZOOM}/${(t.x + dx + n) % n}/${t.y + dy}`); if (e) out.push(e.tile); }
    return out;
  }
  /** Obstacle whose box contains `p` (lon/lat inside bounds, altitude between base and top), if any. */
  obstacleAt(p: GeoPosition): ObstacleVolume | undefined {
    for (const t of this.#near(p)) for (const o of t.obstacles) {
      const b = o.bounds;
      if (p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east && p.altMsl >= o.baseMslM && p.altMsl <= o.topMslM) return o;
    }
    return undefined;
  }
  /** Runway whose surface rectangle contains `p` horizontally. */
  runwayAt(p: { lat: number; lon: number }): RunwayGeometry | undefined {
    for (const t of this.#near(p)) for (const r of t.runways) {
      // Local flat frame at the runway threshold: runways are a few km long, so this is exact to centimetres.
      const kx = Math.cos(r.le.lat * Math.PI / 180) * 111_320, ky = 110_574;
      const ex = (r.he.lon - r.le.lon) * kx, ey = (r.he.lat - r.le.lat) * ky, len = Math.hypot(ex, ey);
      if (len === 0) continue;
      const px = (p.lon - r.le.lon) * kx, py = (p.lat - r.le.lat) * ky;
      const along = (px * ex + py * ey) / len, cross = Math.abs(px * ey - py * ex) / len;
      if (along >= 0 && along <= len && cross <= r.widthM / 2) return r;
    }
    return undefined;
  }
}

/** z12 tiles a flight needs: a corridor of `halfWidthM` either side of the path, sampled every `stepM`. */
export function simulationTilesForPath(path: readonly GeoPosition[], halfWidthM = 20_000, stepM = 2_000): TileId[] {
  const keys = new Set<string>();
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!, b = path[Math.min(path.length - 1, i + 1)]!, d = haversineDistance(a, b), n = Math.max(1, Math.ceil(d / stepM));
    for (let k = 0; k <= n; k++) {
      const f = k / n, q = { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
      for (const brg of [0, 90, 180, 270]) for (const r of [0, halfWidthM / 2, halfWidthM]) {
        const s = destinationPoint({ ...q, altMsl: 0 }, brg, r);
        keys.add(tileKey(lonLatToTile(s.lon, s.lat, SIM_ZOOM)));
      }
    }
  }
  return [...keys].sort().map(parseTileKey);
}
