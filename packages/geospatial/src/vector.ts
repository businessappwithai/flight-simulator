/**
 * Buildings and airport surfaces from OpenMapTiles-schema vector tiles: OpenFreeMap (default, free, no key, from
 * OpenStreetMap), any compatible `{z}/{x}/{y}.pbf` server, or a PMTiles archive baked from Overture/OSM
 * (`scripts/bake-features.ts`). Only the `building` and `aeroway` layers are read.
 */
import { type MvtPoint, decodeMvt, polygons, tileToLonLat } from "./mvt.ts";
import { PMTilesReader, decompress, httpRangeReader } from "./pmtiles.ts";
import type { TileSource } from "./streamer.ts";
import { type TileId, tileKey } from "./tiles.ts";

export type LonLat = [number, number];
export interface BuildingFeature { id: string; /** Exterior ring first, then holes (closed rings). */ rings: LonLat[][]; heightM: number; minHeightM: number }
export type AerowayKind = "runway" | "taxiway" | "apron" | "helipad";
export interface AerowayFeature { id: string; kind: AerowayKind; ref?: string; /** Centreline for runway/taxiway lines. */ line?: LonLat[]; /** Polygon rings for areas. */ rings?: LonLat[][]; widthM: number }
export interface VectorFeatures { tile: TileId; buildings: BuildingFeature[]; aeroways: AerowayFeature[]; byteLength: number }

export const DEFAULT_FEATURES_URL = "https://tiles.openfreemap.org/planet";
export const FEATURES_MAX_ZOOM = 14;
const WIDTH: Record<AerowayKind, number> = { runway: 45, taxiway: 23, apron: 0, helipad: 0 };

/** Deterministic 32-bit hash (FNV-1a) for default heights and colours: the same building always looks the same. */
export function hash32(s: string) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
/** Height when the data has none: 1–4 storeys (3.2 m each), fixed per building id. */
export const defaultBuildingHeight = (id: string) => 3.2 * (1 + (hash32(id) % 4));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function parseOpenMapTiles(tile: TileId, bytes: Uint8Array): VectorFeatures {
  const out: VectorFeatures = { tile, buildings: [], aeroways: [], byteLength: bytes.byteLength };
  for (const layer of decodeMvt(bytes)) {
    const ll = (p: MvtPoint) => tileToLonLat(tile, layer.extent, p);
    layer.features.forEach((f, i) => {
      const id = f.id !== undefined && f.id !== 0 ? `${layer.name}:${f.id}` : `${layer.name}:${tileKey(tile)}#${i}`;
      if (layer.name === "building" && f.type === 3) {
        polygons(f.geometry).forEach((rings, k) => {
          if (rings[0]!.length < 4) return;
          const bid = k ? `${id}.${k}` : id;
          const h = num(f.properties.render_height) ?? num(f.properties.height);
          out.buildings.push({ id: bid, rings: rings.map(r => r.map(ll)), heightM: Math.max(2, Math.min(830, h ?? defaultBuildingHeight(bid))), minHeightM: Math.max(0, num(f.properties.render_min_height) ?? num(f.properties.min_height) ?? 0) });
        });
      } else if (layer.name === "aeroway") {
        const cls = String(f.properties.class ?? f.properties.aeroway ?? "");
        const kind = (["runway", "taxiway", "apron", "helipad"] as const).find(k => k === cls || (k === "taxiway" && cls === "taxilane"));
        if (!kind) return;
        const ref = typeof f.properties.ref === "string" && f.properties.ref ? f.properties.ref : undefined;
        const widthM = num(f.properties.width) ?? WIDTH[kind];
        if (f.type === 2) f.geometry.forEach((line, k) => { if (line.length >= 2) out.aeroways.push({ id: k ? `${id}.${k}` : id, kind, ...(ref ? { ref } : {}), line: line.map(ll), widthM }); });
        else if (f.type === 3) polygons(f.geometry).forEach((rings, k) => out.aeroways.push({ id: k ? `${id}.${k}` : id, kind, ...(ref ? { ref } : {}), rings: rings.map(r => r.map(ll)), widthM }));
      }
    });
  }
  return out;
}

export interface VectorSourceOptions {
  /** `https://…/{z}/{x}/{y}.pbf` template, a TileJSON URL, or a `.pmtiles` archive URL (default: OpenFreeMap). */
  url?: string;
  fetch?: typeof fetch;
  maxZoom?: number;
  minZoom?: number;
}
export interface VectorSources {
  /** Shared, cached loader (one request per tile, whichever layer or physics asked). */
  load(tile: TileId, signal?: AbortSignal): Promise<VectorFeatures>;
  buildings: TileSource<VectorFeatures>;
  airports: TileSource<VectorFeatures>;
  readonly url: string;
}

/**
 * Loaders for the `buildings` and `airports` streaming layers backed by one vector-tile source. A tile the
 * source does not have is an empty tile, not an error.
 */
export function vectorSources(o: VectorSourceOptions = {}): VectorSources {
  const f = o.fetch ?? fetch, url = o.url ?? DEFAULT_FEATURES_URL, maxZoom = o.maxZoom ?? FEATURES_MAX_ZOOM;
  let fetchTile: (t: TileId, signal?: AbortSignal) => Promise<Uint8Array | undefined>;
  if (/\.pmtiles(\?|$)/.test(url)) {
    const reader = new PMTilesReader(httpRangeReader(url, f));
    fetchTile = (t, signal) => reader.tile(t, signal);
  } else {
    let template: Promise<string> | undefined;
    const resolve = () => (template ??= /\{z\}/.test(url) ? Promise.resolve(url) : f(url).then(async r => {
      if (!r.ok) throw new Error(`features: TileJSON HTTP ${r.status}`);
      const j = await r.json() as { tiles?: unknown };
      const t = Array.isArray(j.tiles) ? j.tiles[0] : undefined;
      if (typeof t !== "string" || !/\{z\}/.test(t)) throw new Error("features: TileJSON has no tile URL");
      return new URL(t, url).href;
    }).catch(e => { template = undefined; throw e; }));
    fetchTile = async (t, signal) => {
      const res = await f((await resolve()).replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y)), { signal });
      if (res.status === 204 || res.status === 404) return undefined;
      if (!res.ok) throw new Error(`features ${tileKey(t)}: HTTP ${res.status}`);
      return decompress(new Uint8Array(await res.arrayBuffer()), 1);
    };
  }
  const cache = new Map<string, Promise<VectorFeatures>>();
  const load = (t: TileId, signal?: AbortSignal) => {
    if (t.z > maxZoom) throw new Error(`features: zoom ${t.z} above ${maxZoom}`);
    const k = tileKey(t);
    let p = cache.get(k);
    if (!p) {
      // Not tied to one caller's AbortSignal: physics and rendering may share the request.
      p = fetchTile(t).then(b => (b ? parseOpenMapTiles(t, b) : { tile: t, buildings: [], aeroways: [], byteLength: 0 }));
      cache.set(k, p);
      p.catch(() => cache.delete(k));
      while (cache.size > 256) cache.delete(cache.keys().next().value!);
    }
    return signal ? Promise.race([p, new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true }))]) : p;
  };
  const source = (layer: "buildings" | "airports"): TileSource<VectorFeatures> => ({
    layer, maxZoom, minZoom: o.minZoom ?? 13, load, sizeOf: v => 2048 + v.byteLength * 4,
  });
  return { load, buildings: source("buildings"), airports: source("airports"), url };
}

/** Normalised runway designator: "7" → "07", "09l" → "09L". */
export const runwayDesignator = (s: string) => { const m = /^0*(\d{1,2})([LRCT]?)$/i.exec(s.trim()); return m ? `${m[1]!.padStart(2, "0")}${m[2]!.toUpperCase()}` : s.trim().toUpperCase(); };
/** Whether an aeroway ref such as "07/25" or "09L/27R" names this runway end. */
export const refMatches = (ref: string | undefined, ident: string) => !!ref && ref.split(/[/\s-]+/).some(p => runwayDesignator(p) === runwayDesignator(ident));

/**
 * Ear-clipping triangulation of a simple polygon (holes ignored) given as flat [x0, y0, x1, y1, …]. Returns index
 * triples. Deterministic; O(n²), fine for building footprints and aprons.
 */
export function triangulate(xy: readonly number[]): number[] {
  const n = xy.length / 2, out: number[] = [];
  if (n < 3) return out;
  let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += xy[i * 2]! * xy[j * 2 + 1]! - xy[j * 2]! * xy[i * 2 + 1]!; }
  const idx = Array.from({ length: n }, (_, i) => i);
  if (area < 0) idx.reverse(); // make counter-clockwise (positive shoelace area)
  const cross = (a: number, b: number, c: number) => (xy[b * 2]! - xy[a * 2]!) * (xy[c * 2 + 1]! - xy[a * 2 + 1]!) - (xy[b * 2 + 1]! - xy[a * 2 + 1]!) * (xy[c * 2]! - xy[a * 2]!);
  const inside = (p: number, a: number, b: number, c: number) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length]!, b = idx[i]!, c = idx[(i + 1) % idx.length]!;
      if (cross(a, b, c) <= 0) continue;
      if (idx.some(p => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push(a, b, c); idx.splice(i, 1); clipped = true; break;
    }
    if (!clipped) break; // degenerate: fan the rest
  }
  for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0]!, idx[i]!, idx[i + 1]!);
  return out;
}

/** Point-in-polygon (even-odd) on lon/lat rings, holes included. */
export function pointInRings(lon: number, lat: number, rings: readonly (readonly LonLat[])[]) {
  let inside = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!, [xj, yj] = r[j]!;
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
