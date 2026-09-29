/**
 * Ties the simulator's flat local frame to a real runway. The simulation keeps its own coordinates (x right of the
 * runway, y up, z along the runway, heading 0 = runway heading) and stays deterministic; this frame converts them
 * to and from WGS84 around the anchor. Conversions use a cached tangent-plane basis (fast enough per physics tick).
 */
import { type GeoPosition, angleDiff, destinationPoint, ecefToGeodetic, geodeticToEcef, geodeticToEnu, haversineDistance, initialBearing, normalizeBearing } from "./geodesy.ts";
import { type AerowayFeature, refMatches } from "./vector.ts";
import { type Airport, runwayGeometry } from "./airports.ts";

export interface SimVector { x: number; y: number; z: number }
const RAD = Math.PI / 180;

export class AnchorFrame {
  readonly #o: { x: number; y: number; z: number };
  readonly #e: [number, number, number];
  readonly #n: [number, number, number];
  readonly #u: [number, number, number];
  readonly #sin: number;
  readonly #cos: number;
  /** `anchor.altMsl` is the elevation of the local y = 0 plane; `headingDeg` is the true heading of local +z. */
  constructor(readonly anchor: GeoPosition, readonly headingDeg: number) {
    this.#o = geodeticToEcef(anchor);
    const φ = anchor.lat * RAD, λ = anchor.lon * RAD, sφ = Math.sin(φ), cφ = Math.cos(φ), sλ = Math.sin(λ), cλ = Math.cos(λ);
    this.#e = [-sλ, cλ, 0];
    this.#n = [-sφ * cλ, -sφ * sλ, cφ];
    this.#u = [cφ * cλ, cφ * sλ, sφ];
    this.#sin = Math.sin(headingDeg * RAD);
    this.#cos = Math.cos(headingDeg * RAD);
  }
  /** Local simulation coordinates → WGS84. */
  toGeo(v: SimVector): GeoPosition {
    const east = v.z * this.#sin + v.x * this.#cos, north = v.z * this.#cos - v.x * this.#sin, up = v.y, e = this.#e, n = this.#n, u = this.#u, o = this.#o;
    return ecefToGeodetic({ x: o.x + e[0] * east + n[0] * north + u[0] * up, y: o.y + e[1] * east + n[1] * north + u[1] * up, z: o.z + e[2] * east + n[2] * north + u[2] * up });
  }
  /** WGS84 → local simulation coordinates (y is height above the anchor's tangent plane, so it includes curvature). */
  fromGeo(p: GeoPosition): SimVector {
    const c = geodeticToEcef(p), dx = c.x - this.#o.x, dy = c.y - this.#o.y, dz = c.z - this.#o.z, e = this.#e, n = this.#n, u = this.#u;
    const east = e[0] * dx + e[1] * dy, north = n[0] * dx + n[1] * dy + n[2] * dz, up = u[0] * dx + u[1] * dy + u[2] * dz;
    return { x: east * this.#cos - north * this.#sin, y: up, z: east * this.#sin + north * this.#cos };
  }
  /**
   * The rigid transform from ECEF (m) to the renderer's local frame (three.js: x = −sim x, y up, z = sim z), as a
   * column-major 4×4 matrix (THREE.Matrix4.fromArray). Places ECEF data such as 3D Tiles exactly on the local frame.
   */
  ecefToThree(): number[] {
    const e = this.#e, n = this.#n, u = this.#u, o = this.#o, c = this.#cos, s = this.#sin;
    const rx = [0, 1, 2].map(i => -(c * e[i]! - s * n[i]!)), ry = [0, 1, 2].map(i => u[i]!), rz = [0, 1, 2].map(i => s * e[i]! + c * n[i]!);
    const t = (r: number[]) => -(r[0]! * o.x + r[1]! * o.y + r[2]! * o.z);
    return [rx[0]!, ry[0]!, rz[0]!, 0, rx[1]!, ry[1]!, rz[1]!, 0, rx[2]!, ry[2]!, rz[2]!, 0, t(rx), t(ry), t(rz), 1];
  }
  /** True bearing (deg) of a simulation heading (radians, 0 = along the runway, positive = right). */
  bearing(simHeadingRad: number) { return normalizeBearing(this.headingDeg + simHeadingRad / RAD); }
}

export interface RunwayAnchor { airport: string; runway: string; headingDegT: number; anchor: GeoPosition; synthesized: boolean; lengthM?: number }

/**
 * Replaces a synthesized anchor with the surveyed runway: all runway centreline points near the airport whose ref
 * names this runway ("07/25" for 07) are projected on the runway axis; the extreme points are the thresholds.
 * Returns undefined when the data has no matching runway or it disagrees with the expected heading by > 30°.
 */
export function surveyedRunwayAnchor(fallback: RunwayAnchor, airportRef: GeoPosition, aeroways: readonly AerowayFeature[], setbackM = 320): RunwayAnchor | undefined {
  const pts = aeroways.filter(a => a.kind === "runway" && refMatches(a.ref, fallback.runway)).flatMap(a => a.line ?? a.rings?.[0] ?? [])
    .map(([lon, lat]) => ({ lat, lon, altMsl: 0 })).filter(p => haversineDistance(p, airportRef) < 8000);
  if (pts.length < 2) return undefined;
  const h = fallback.headingDegT * Math.PI / 180, ux = Math.sin(h), uy = Math.cos(h);
  let lo = pts[0]!, hi = pts[0]!, tLo = Infinity, tHi = -Infinity;
  for (const p of pts) { const v = geodeticToEnu(p, { ...airportRef, altMsl: 0 }), t = v.east * ux + v.north * uy; if (t < tLo) { tLo = t; lo = p; } if (t > tHi) { tHi = t; hi = p; } }
  const length = haversineDistance(lo, hi), heading = initialBearing(lo, hi);
  if (length < 300 || Math.abs(angleDiff(fallback.headingDegT, heading)) > 30) return undefined;
  const a = destinationPoint(lo, heading, setbackM);
  return { ...fallback, headingDegT: heading, anchor: { ...a, altMsl: fallback.anchor.altMsl }, synthesized: false, lengthM: length };
}

/**
 * Anchor for taking off from `runwayIdent` at `airport`: local z runs along that runway end's true heading, and
 * local 0 sits `setbackM` beyond its threshold (where the simulator's own runway puts the aircraft).
 */
export function runwayAnchor(airport: Airport, runwayIdent?: string, setbackM = 320): RunwayAnchor {
  const open = airport.runways.filter(r => !r.closed);
  if (!open.length) throw new Error(`${airport.ident} has no open runway`);
  const want = runwayIdent?.trim().toUpperCase();
  const rw = want ? open.find(r => r.le.ident.toUpperCase() === want || r.he.ident.toUpperCase() === want) : [...open].sort((a, b) => (b.lengthM ?? 0) - (a.lengthM ?? 0))[0];
  if (!rw) throw new Error(`${airport.ident} has no runway ${runwayIdent}`);
  const g = runwayGeometry(airport, rw);
  if (!g) throw new Error(`${airport.ident} runway ${rw.le.ident}/${rw.he.ident} has no usable geometry`);
  const fromHigh = want !== undefined && rw.he.ident.toUpperCase() === want;
  const threshold = fromHigh ? g.he : g.le, heading = normalizeBearing(fromHigh ? g.headingDegT + 180 : g.headingDegT);
  const p = destinationPoint(threshold, heading, setbackM);
  return { airport: airport.ident, runway: fromHigh ? rw.he.ident : rw.le.ident, headingDegT: heading, anchor: { ...p, altMsl: airport.position.altMsl }, synthesized: g.synthesized };
}

/** 0 on the airfield, rising smoothly to 1 at `flatRadiusM + blendM` (matches the simulator's flat flying area). */
export function airfieldBlend(x: number, z: number, flatRadiusM = 3200, blendM = 2600) {
  const r = Math.hypot(x, z);
  if (r <= flatRadiusM) return 0;
  const t = Math.min(1, (r - flatRadiusM) / blendM);
  return t * t * (3 - 2 * t);
}
