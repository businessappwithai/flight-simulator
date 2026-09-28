/** Great-circle routes between airports, with a simple climb / cruise / descent altitude profile. */
import { type GeoPosition, alongTrackDistance, crossTrackDistance, haversineDistance, initialBearing, interpolateGreatCircle } from "./geodesy.ts";
import type { Airport } from "./airports.ts";
import type { RouteLike } from "./prefetch.ts";

export interface RouteProgress { legIndex: number; alongM: number; remainingM: number; crossTrackM: number; desiredTrackDeg: number }

/** A polyline of great-circle legs. `waypoints` are densified so each leg is at most `stepM`. */
export class GreatCircleRoute implements RouteLike {
  readonly waypoints: readonly GeoPosition[];
  /** Cumulative distance at each waypoint. */
  readonly cumulativeM: readonly number[];
  constructor(points: readonly GeoPosition[], stepM = 20_000) {
    if (points.length < 2) throw new Error("route needs at least two points");
    const wps: GeoPosition[] = [points[0]!];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!, n = Math.max(1, Math.ceil(haversineDistance(a, b) / stepM));
      for (let k = 1; k <= n; k++) wps.push(interpolateGreatCircle(a, b, k / n));
    }
    this.waypoints = wps;
    const cum = [0];
    for (let i = 1; i < wps.length; i++) cum.push(cum[i - 1]! + haversineDistance(wps[i - 1]!, wps[i]!));
    this.cumulativeM = cum;
  }
  get origin() { return this.waypoints[0]!; }
  get destination() { return this.waypoints[this.waypoints.length - 1]!; }
  get totalM() { return this.cumulativeM[this.cumulativeM.length - 1]!; }

  /** Point `alongM` metres from the start (clamped). */
  pointAt(alongM: number): GeoPosition {
    const d = Math.max(0, Math.min(this.totalM, alongM));
    let i = 1;
    while (i < this.cumulativeM.length - 1 && this.cumulativeM[i]! < d) i++;
    const a = this.waypoints[i - 1]!, b = this.waypoints[i]!, len = this.cumulativeM[i]! - this.cumulativeM[i - 1]!;
    return interpolateGreatCircle(a, b, len > 0 ? (d - this.cumulativeM[i - 1]!) / len : 0);
  }

  /** Nearest leg to `p` and how far along the route that is. */
  progress(p: GeoPosition): RouteProgress {
    let best: RouteProgress | undefined, bestErr = Infinity;
    for (let i = 1; i < this.waypoints.length; i++) {
      const a = this.waypoints[i - 1]!, b = this.waypoints[i]!, len = this.cumulativeM[i]! - this.cumulativeM[i - 1]!;
      const at = Math.max(0, Math.min(len, alongTrackDistance(p, a, b)));
      const xt = crossTrackDistance(p, a, b), err = at <= 0 || at >= len ? haversineDistance(p, at <= 0 ? a : b) : Math.abs(xt);
      if (err < bestErr - 1e-6) {
        bestErr = err;
        const alongM = this.cumulativeM[i - 1]! + at;
        best = { legIndex: i - 1, alongM, remainingM: this.totalM - alongM, crossTrackM: xt, desiredTrackDeg: initialBearing(a, b) };
      }
    }
    return best!;
  }

  /** Waypoints from the aircraft's projection onto the route up to `maxDistanceM` ahead (for the tile prefetcher). */
  remainingPath(from: GeoPosition, maxDistanceM: number): GeoPosition[] {
    const pr = this.progress(from), end = Math.min(this.totalM, pr.alongM + maxDistanceM), out: GeoPosition[] = [this.pointAt(pr.alongM)];
    for (let i = 0; i < this.waypoints.length; i++) if (this.cumulativeM[i]! > pr.alongM && this.cumulativeM[i]! < end) out.push(this.waypoints[i]!);
    out.push(this.pointAt(end));
    return out;
  }
}

export interface AirportRouteOptions { cruiseAltM?: number; climbGradient?: number; descentGradient?: number; stepM?: number; via?: readonly GeoPosition[] }

/**
 * Direct great-circle route (optionally via waypoints) with altitudes: climb at `climbGradient` from the departure
 * elevation, cruise, then a `descentGradient` (default 3°) path to the destination elevation.
 */
export function planAirportRoute(from: Airport, to: Airport, o: AirportRouteOptions = {}): GreatCircleRoute {
  const cruise = o.cruiseAltM ?? 10_668, climb = o.climbGradient ?? 0.06, descent = o.descentGradient ?? Math.tan(3 * Math.PI / 180);
  const lateral = new GreatCircleRoute([from.position, ...(o.via ?? []), to.position], o.stepM);
  const total = lateral.totalM;
  const alt = (s: number) => Math.min(cruise, from.position.altMsl + s * climb, to.position.altMsl + (total - s) * descent);
  return new GreatCircleRoute(lateral.waypoints.map((p, i) => ({ ...p, altMsl: alt(lateral.cumulativeM[i]!) })), o.stepM);
}
