/** WGS84 geodesy: geodetic ⇄ ECEF ⇄ local East/North/Up, plus great-circle helpers. Angles in degrees, lengths in metres. */
export const WGS84 = { a: 6378137, f: 1 / 298.257223563 } as const;
const A = WGS84.a, F = WGS84.f, B = A * (1 - F), E2 = F * (2 - F), EP2 = E2 / (1 - E2);
/** Mean Earth radius (IUGG) used for spherical great-circle maths. */
export const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180, DEG = 180 / Math.PI;

/** Authoritative aircraft/world position. Kept in double precision and never handed to Three.js directly. */
export interface GeoPosition { lat: number; lon: number; altMsl: number }
export interface Ecef { x: number; y: number; z: number }
export interface Enu { east: number; north: number; up: number }

export const normalizeLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
export const normalizeBearing = (deg: number) => ((deg % 360) + 360) % 360;
/** Signed smallest difference b − a in degrees, in (−180, 180]. */
export function angleDiff(a: number, b: number) { const d = normalizeBearing(b - a); return d > 180 ? d - 360 : d; }

export function geodeticToEcef(p: GeoPosition): Ecef {
  const lat = p.lat * RAD, lon = p.lon * RAD, s = Math.sin(lat), c = Math.cos(lat);
  const n = A / Math.sqrt(1 - E2 * s * s);
  return { x: (n + p.altMsl) * c * Math.cos(lon), y: (n + p.altMsl) * c * Math.sin(lon), z: (n * (1 - E2) + p.altMsl) * s };
}

/** Bowring's method with two refinement steps: sub-millimetre for any aircraft altitude. */
export function ecefToGeodetic(e: Ecef): GeoPosition {
  const p = Math.hypot(e.x, e.y), lon = Math.atan2(e.y, e.x);
  if (p < 1e-9) return { lat: e.z >= 0 ? 90 : -90, lon: 0, altMsl: Math.abs(e.z) - B };
  let lat = Math.atan2(e.z, p * (1 - E2));
  for (let i = 0; i < 3; i++) {
    const beta = Math.atan2((1 - F) * Math.sin(lat), Math.cos(lat));
    lat = Math.atan2(e.z + EP2 * B * Math.sin(beta) ** 3, p - E2 * A * Math.cos(beta) ** 3);
  }
  const s = Math.sin(lat), n = A / Math.sqrt(1 - E2 * s * s);
  const alt = Math.abs(Math.cos(lat)) > 1e-10 ? p / Math.cos(lat) - n : Math.abs(e.z) / Math.abs(s) - n * (1 - E2);
  return { lat: lat * DEG, lon: lon * DEG, altMsl: alt };
}

/** Offset of `e` from `origin`, expressed in the origin's local tangent plane. */
export function ecefToEnu(e: Ecef, origin: GeoPosition): Enu {
  const o = geodeticToEcef(origin), lat = origin.lat * RAD, lon = origin.lon * RAD;
  const dx = e.x - o.x, dy = e.y - o.y, dz = e.z - o.z, sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
  return { east: -so * dx + co * dy, north: -sl * co * dx - sl * so * dy + cl * dz, up: cl * co * dx + cl * so * dy + sl * dz };
}

export function enuToEcef(v: Enu, origin: GeoPosition): Ecef {
  const o = geodeticToEcef(origin), lat = origin.lat * RAD, lon = origin.lon * RAD;
  const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
  return {
    x: o.x - so * v.east - sl * co * v.north + cl * co * v.up,
    y: o.y + co * v.east - sl * so * v.north + cl * so * v.up,
    z: o.z + cl * v.north + sl * v.up,
  };
}

export const geodeticToEnu = (p: GeoPosition, origin: GeoPosition) => ecefToEnu(geodeticToEcef(p), origin);
export const enuToGeodetic = (v: Enu, origin: GeoPosition) => ecefToGeodetic(enuToEcef(v, origin));

/** Great-circle distance over the mean sphere (ignores altitude). */
export function haversineDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial true bearing from a to b in [0, 360). */
export function initialBearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const φ1 = a.lat * RAD, φ2 = b.lat * RAD, Δλ = (b.lon - a.lon) * RAD;
  return normalizeBearing(Math.atan2(Math.sin(Δλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)) * DEG);
}

/** Point reached from `p` after `distanceM` along the great circle with initial `bearingDeg`. Altitude is kept. */
export function destinationPoint(p: GeoPosition, bearingDeg: number, distanceM: number): GeoPosition {
  const δ = distanceM / EARTH_RADIUS_M, θ = bearingDeg * RAD, φ1 = p.lat * RAD, λ1 = p.lon * RAD;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 * DEG, lon: normalizeLon(λ2 * DEG), altMsl: p.altMsl };
}

/** Point at `fraction` (0..1) along the great circle from a to b; altitude is interpolated linearly. */
export function interpolateGreatCircle(a: GeoPosition, b: GeoPosition, fraction: number): GeoPosition {
  const δ = haversineDistance(a, b) / EARTH_RADIUS_M;
  const alt = a.altMsl + (b.altMsl - a.altMsl) * fraction;
  if (δ < 1e-12) return { lat: a.lat, lon: a.lon, altMsl: alt };
  const φ1 = a.lat * RAD, λ1 = a.lon * RAD, φ2 = b.lat * RAD, λ2 = b.lon * RAD;
  const s1 = Math.sin((1 - fraction) * δ) / Math.sin(δ), s2 = Math.sin(fraction * δ) / Math.sin(δ);
  const x = s1 * Math.cos(φ1) * Math.cos(λ1) + s2 * Math.cos(φ2) * Math.cos(λ2);
  const y = s1 * Math.cos(φ1) * Math.sin(λ1) + s2 * Math.cos(φ2) * Math.sin(λ2);
  const z = s1 * Math.sin(φ1) + s2 * Math.sin(φ2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) * DEG, lon: Math.atan2(y, x) * DEG, altMsl: alt };
}

/** Signed cross-track distance of p from the great circle a→b (positive = right of track). */
export function crossTrackDistance(p: GeoPosition, a: GeoPosition, b: GeoPosition) {
  const δ13 = haversineDistance(a, p) / EARTH_RADIUS_M, θ13 = initialBearing(a, p) * RAD, θ12 = initialBearing(a, b) * RAD;
  return Math.asin(Math.sin(δ13) * Math.sin(θ13 - θ12)) * EARTH_RADIUS_M;
}

/** Distance from a to the point on a→b's great circle closest to p (may be negative or beyond b). */
export function alongTrackDistance(p: GeoPosition, a: GeoPosition, b: GeoPosition) {
  const δ13 = haversineDistance(a, p) / EARTH_RADIUS_M, xt = crossTrackDistance(p, a, b) / EARTH_RADIUS_M;
  const d = Math.acos(Math.max(-1, Math.min(1, Math.cos(δ13) / Math.cos(xt)))) * EARTH_RADIUS_M;
  return Math.cos(initialBearing(a, p) * RAD - initialBearing(a, b) * RAD) < 0 ? -d : d;
}

/** Distance to the geometric horizon for an eye `heightM` above a smooth Earth. */
export const horizonDistance = (heightM: number) => Math.sqrt(Math.max(0, heightM) * (2 * EARTH_RADIUS_M + Math.max(0, heightM)));
