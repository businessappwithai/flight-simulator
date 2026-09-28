/** Web-Mercator ("slippy map") tile maths shared by Terrarium DEM tiles, PMTiles/MVT archives and XYZ servers. */
import { EARTH_RADIUS_M, destinationPoint, haversineDistance, normalizeLon } from "./geodesy.ts";

export interface TileId { z: number; x: number; y: number }
export interface LonLatBounds { west: number; south: number; east: number; north: number }
export const MAX_MERCATOR_LAT = 85.0511287798066;
const EQUATOR_M = 2 * Math.PI * 6378137;

export const tileKey = (t: TileId) => `${t.z}/${t.x}/${t.y}`;
export function parseTileKey(key: string): TileId {
  const m = /^(\d+)\/(\d+)\/(\d+)$/.exec(key);
  if (!m) throw new Error(`bad tile key: ${key}`);
  const t = { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
  if (!isValidTile(t)) throw new Error(`tile out of range: ${key}`);
  return t;
}
export function isValidTile(t: TileId) {
  const n = 2 ** t.z;
  return Number.isInteger(t.z) && t.z >= 0 && t.z <= 30 && Number.isInteger(t.x) && Number.isInteger(t.y) && t.x >= 0 && t.x < n && t.y >= 0 && t.y < n;
}

/** Fractional tile coordinates of a lon/lat at zoom z (latitude clamped to the Mercator limit). */
export function lonLatToTileFraction(lon: number, lat: number, z: number) {
  const n = 2 ** z, φ = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * Math.PI / 180;
  const x = ((normalizeLon(lon) + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * n;
  return { x: Math.min(n - 1e-9, Math.max(0, x)), y: Math.min(n - 1e-9, Math.max(0, y)) };
}
export function lonLatToTile(lon: number, lat: number, z: number): TileId {
  const f = lonLatToTileFraction(lon, lat, z);
  return { z, x: Math.floor(f.x), y: Math.floor(f.y) };
}
const tileXToLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileYToLat = (y: number, z: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180 / Math.PI;
export function tileBounds(t: TileId): LonLatBounds {
  return { west: tileXToLon(t.x, t.z), east: tileXToLon(t.x + 1, t.z), north: tileYToLat(t.y, t.z), south: tileYToLat(t.y + 1, t.z) };
}
export function tileCenter(t: TileId) {
  return { lon: tileXToLon(t.x + 0.5, t.z), lat: tileYToLat(t.y + 0.5, t.z) };
}
/** Ground width of one tile at latitude `lat`. */
export const tileSizeMeters = (z: number, lat: number) => (EQUATOR_M * Math.cos(lat * Math.PI / 180)) / 2 ** z;

export const parentTile = (t: TileId): TileId => ({ z: t.z - 1, x: t.x >> 1, y: t.y >> 1 });
export function ancestorAt(t: TileId, z: number): TileId {
  if (z > t.z) throw new Error(`zoom ${z} is below tile ${tileKey(t)}`);
  const s = t.z - z;
  return { z, x: t.x >> s, y: t.y >> s };
}
export function childTiles(t: TileId): TileId[] {
  const z = t.z + 1, x = t.x * 2, y = t.y * 2;
  return [{ z, x, y }, { z, x: x + 1, y }, { z, x, y: y + 1 }, { z, x: x + 1, y: y + 1 }];
}
/** Tile containing (lon, lat) plus its 8 neighbours (wrapping in x, clipped in y). */
export function tileNeighbourhood(lon: number, lat: number, z: number): TileId[] {
  const c = lonLatToTile(lon, lat, z), n = 2 ** z, out: TileId[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const y = c.y + dy;
    if (y >= 0 && y < n) out.push({ z, x: (((c.x + dx) % n) + n) % n, y });
  }
  return out;
}

/** Shortest great-circle distance from a point to a tile's lon/lat rectangle (0 when inside). */
export function distanceToTile(p: { lat: number; lon: number }, t: TileId) {
  const b = tileBounds(t);
  const lat = Math.max(b.south, Math.min(b.north, p.lat));
  // Longitude: pick the nearest edge taking wrap-around into account.
  const rel = (l: number) => ((((l - b.west) % 360) + 360) % 360);
  const width = b.east - b.west, r = rel(p.lon);
  const lon = r <= width ? p.lon : (r - width < 360 - r ? b.east : b.west);
  return haversineDistance(p, { lat, lon });
}

/**
 * Tiles at zoom z whose rectangle intersects the circle (center, radius). The candidate range comes from the
 * circle's bounding box, so it is exact at tile resolution and handles the antimeridian and the poles.
 */
export function tilesInRadius(center: { lat: number; lon: number }, radiusM: number, z: number): TileId[] {
  const n = 2 ** z, p = { ...center, altMsl: 0 };
  const north = Math.min(MAX_MERCATOR_LAT, radiusM >= Math.PI * EARTH_RADIUS_M / 2 ? 90 : destinationPoint(p, 0, radiusM).lat);
  const south = Math.max(-MAX_MERCATOR_LAT, radiusM >= Math.PI * EARTH_RADIUS_M / 2 ? -90 : destinationPoint(p, 180, radiusM).lat);
  const yMin = lonLatToTile(center.lon, north, z).y, yMax = lonLatToTile(center.lon, south, z).y;
  // Longitude half-width of the circle at its widest latitude (safe over-estimate, clamped to the whole world).
  const maxAbsLat = Math.max(Math.abs(north), Math.abs(south));
  const angular = radiusM / EARTH_RADIUS_M;
  const dLon = maxAbsLat >= 89.9 || angular >= Math.PI / 2 ? 180 : Math.min(180, (angular / Math.cos(maxAbsLat * Math.PI / 180)) * 180 / Math.PI);
  const span = dLon >= 180 ? n : Math.ceil((dLon / 360) * n) + 1;
  const cx = lonLatToTile(center.lon, center.lat, z).x, out: TileId[] = [], seen = new Set<number>();
  for (let y = yMin; y <= yMax; y++) for (let k = -span; k <= span; k++) {
    const x = (((cx + k) % n) + n) % n;
    if (seen.has(y * n + x)) continue;
    seen.add(y * n + x);
    const t = { z, x, y };
    if (distanceToTile(center, t) <= radiusM) out.push(t);
  }
  return out;
}
