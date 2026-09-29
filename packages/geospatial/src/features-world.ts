/**
 * Deterministic buildings and runways for physics, in z14 tiles (the vector data's full-detail zoom).
 *
 * Footprints are quantised to 1e-7° and sorted, so a tile's content — and its SHA-256 — depends only on the
 * data, never on load order. Queries (`buildingTopAt`, `runwayAt`) look only at tiles already added; the worker
 * holds the clock until the tiles around the aircraft are in, exactly as for terrain.
 */
import type { BuildingFeature, LonLat, VectorFeatures } from "./vector.ts";
import { pointInRings } from "./vector.ts";
import { type TileId, lonLatToTile, tileKey } from "./tiles.ts";

export const FEATURE_ZOOM = 14;
const Q = 1e7, GRID = 16;
const q = (v: number) => Math.round(v * Q) / Q;

export interface ObstacleBuilding { id: string; west: number; south: number; east: number; north: number; rings: LonLat[][]; heightM: number }
export interface RunwaySurface { id: string; ref?: string; /** Centreline segment ends, lon/lat. */ a: LonLat; b: LonLat; widthM: number }
export interface FeatureTile { tile: TileId; buildings: ObstacleBuilding[]; runways: RunwaySurface[] }

/** Physics view of one z14 vector tile: buildings whose footprint centre lies in the tile, runway centreline segments. */
export function featureTile(v: VectorFeatures): FeatureTile {
  if (v.tile.z !== FEATURE_ZOOM) throw new Error(`feature tiles are z${FEATURE_ZOOM}, got ${tileKey(v.tile)}`);
  const buildings: ObstacleBuilding[] = [];
  for (const b of v.buildings) {
    const c = centroid(b);
    const t = lonLatToTile(c[0], c[1], FEATURE_ZOOM);
    // Tiles repeat edge-crossing features (buffers): keep each building in the tile that owns its centre.
    if (t.x !== v.tile.x || t.y !== v.tile.y) continue;
    const rings = b.rings.map(r => r.map(([lon, lat]) => [q(lon), q(lat)] as LonLat));
    const outer = rings[0]!;
    buildings.push({ id: b.id, west: Math.min(...outer.map(p => p[0])), east: Math.max(...outer.map(p => p[0])), south: Math.min(...outer.map(p => p[1])), north: Math.max(...outer.map(p => p[1])), rings, heightM: Math.round(b.heightM * 10) / 10 });
  }
  const runways: RunwaySurface[] = [];
  for (const a of v.aeroways) {
    if (a.kind !== "runway" || !a.line) continue;
    for (let i = 1; i < a.line.length; i++) {
      const p = a.line[i - 1]!, r = a.line[i]!;
      runways.push({ id: `${a.id}:${i}`, ...(a.ref ? { ref: a.ref } : {}), a: [q(p[0]), q(p[1])], b: [q(r[0]), q(r[1])], widthM: a.widthM });
    }
  }
  const byId = (x: { id: string }, y: { id: string }) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  return { tile: v.tile, buildings: buildings.sort(byId), runways: runways.sort(byId) };
}
function centroid(b: BuildingFeature): LonLat {
  const r = b.rings[0]!, n = r.length > 1 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1] ? r.length - 1 : r.length;
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) { x += r[i]![0]; y += r[i]![1]; }
  return [x / n, y / n];
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

interface Indexed { tile: FeatureTile; grid: Map<number, ObstacleBuilding[]>; hash?: Promise<string> }

export class FeatureWorld {
  readonly #tiles = new Map<string, Indexed>();
  add(t: FeatureTile) {
    const grid = new Map<number, ObstacleBuilding[]>(), n = 2 ** FEATURE_ZOOM;
    const cell = (lon: number, lat: number) => {
      const x = ((lon + 180) / 360) * n, φ = lat * Math.PI / 180, y = ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * n;
      return [Math.max(0, Math.min(GRID - 1, Math.floor((x - t.tile.x) * GRID))), Math.max(0, Math.min(GRID - 1, Math.floor((y - t.tile.y) * GRID)))] as const;
    };
    for (const b of t.buildings) {
      const [x0, y0] = cell(b.west, b.north), [x1, y1] = cell(b.east, b.south);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = y * GRID + x; (grid.get(k) ?? grid.set(k, []).get(k)!).push(b); }
    }
    this.#tiles.set(tileKey(t.tile), { tile: t, grid });
  }
  has(t: TileId) { return this.#tiles.has(tileKey(t)); }
  get size() { return this.#tiles.size; }
  get buildingCount() { let n = 0; for (const t of this.#tiles.values()) n += t.tile.buildings.length; return n; }

  #near(lon: number, lat: number) {
    const t = lonLatToTile(lon, lat, FEATURE_ZOOM), n = 2 ** FEATURE_ZOOM, out: Indexed[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const e = this.#tiles.get(`${FEATURE_ZOOM}/${(t.x + dx + n) % n}/${t.y + dy}`); if (e) out.push(e); }
    return out;
  }
  /** Height (m above ground) of the tallest building whose footprint contains the point, or 0. */
  buildingTopAt(lon: number, lat: number): number {
    let top = 0;
    for (const e of this.#near(lon, lat)) {
      const n = 2 ** FEATURE_ZOOM, x = ((lon + 180) / 360) * n, φ = lat * Math.PI / 180, y = ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * n;
      const cx = Math.floor((x - e.tile.tile.x) * GRID), cy = Math.floor((y - e.tile.tile.y) * GRID);
      if (cx < 0 || cy < 0 || cx >= GRID || cy >= GRID) continue;
      for (const b of e.grid.get(cy * GRID + cx) ?? []) {
        if (b.heightM <= top || lon < b.west || lon > b.east || lat < b.south || lat > b.north) continue;
        if (pointInRings(lon, lat, b.rings)) top = b.heightM;
      }
    }
    return top;
  }
  /** Runway surface under the point (within half its width of a centreline segment), if any. */
  runwayAt(lon: number, lat: number): RunwaySurface | undefined {
    const kx = Math.cos(lat * Math.PI / 180) * 111_320, ky = 110_574;
    for (const e of this.#near(lon, lat)) for (const r of e.tile.runways) {
      const ax = (r.a[0] - lon) * kx, ay = (r.a[1] - lat) * ky, bx = (r.b[0] - lon) * kx, by = (r.b[1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      if (Math.hypot(ax + dx * t, ay + dy * t) <= r.widthM / 2) return r;
    }
    return undefined;
  }
  async manifest() {
    const keys = [...this.#tiles.keys()].sort();
    return Promise.all(keys.map(async k => { const e = this.#tiles.get(k)!; return { tile: k, sha256: await (e.hash ??= sha(JSON.stringify(e.tile))) }; }));
  }
  async checksum() { return sha(JSON.stringify(await this.manifest())); }
}
