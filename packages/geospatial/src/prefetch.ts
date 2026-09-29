/**
 * Predictive tile planning. An aircraft's future is mostly known (position, track, speed, route), so tiles are ranked
 * by where it will be rather than by what the camera sees:
 *
 *   current tile 100 · 30 s ahead 90 · 60 s ahead 70 · 120 s ahead 65 · destination 60 · route ahead 50
 *   in range but off-route 40 · behind the aircraft 5 (evicted first)
 */
import { type GeoPosition, angleDiff, destinationPoint, haversineDistance, initialBearing } from "./geodesy.ts";
import { type DetailLevel, type FlightState, type LodPolicy, type WorldLayer, DEFAULT_LOD_POLICY, lodRings } from "./lod.ts";
import { type TileId, distanceToTile, lonLatToTile, tileCenter, tileKey, tileNeighbourhood, tilesInRadius } from "./tiles.ts";

export interface GeoVelocity { groundSpeedMps: number; trackDeg: number; verticalSpeedMps: number }
/** Anything with an ordered list of positions still to fly (see `GreatCircleRoute`). */
export interface RouteLike { remainingPath(from: GeoPosition, maxDistanceM: number): GeoPosition[]; readonly destination: GeoPosition }
export interface PredictedPoint { tSeconds: number; position: GeoPosition }

export const PRIORITY = { CURRENT: 100, AHEAD_30S: 90, AHEAD_60S: 70, AHEAD_120S: 65, DESTINATION: 60, ROUTE: 50, IN_RANGE: 40, BEHIND: 5 } as const;
export type RequestReason = keyof typeof PRIORITY;
const HORIZON_PRIORITY: Record<number, RequestReason> = { 30: "AHEAD_30S", 60: "AHEAD_60S", 120: "AHEAD_120S" };

export interface TileRequest {
  /** `${layer}:${z}/${x}/${y}` — unique per layer and tile. */
  key: string;
  layer: WorldLayer;
  tile: TileId;
  level: DetailLevel;
  priority: number;
  reason: RequestReason;
  /** Distance from the aircraft to the tile rectangle (m), used as a tie-break. */
  distanceM: number;
}

export interface PlanInput {
  position: GeoPosition;
  velocity: GeoVelocity;
  /** Height above ground; defaults to altitude MSL when terrain is unknown. */
  aglM?: number;
  route?: RouteLike;
  policy?: LodPolicy;
  /** Layers that have a data source; others are never requested. */
  layers?: readonly WorldLayer[];
  horizonsS?: readonly number[];
}

/** Dead-reckon along the route when there is one (the aircraft is expected to follow it), else along the current track. */
export function predictPath(position: GeoPosition, velocity: GeoVelocity, route?: RouteLike, horizonsS: readonly number[] = [30, 60, 120]): PredictedPoint[] {
  const speed = Math.max(0, velocity.groundSpeedMps);
  if (!route) return horizonsS.map(t => ({ tSeconds: t, position: { ...destinationPoint(position, velocity.trackDeg, speed * t), altMsl: position.altMsl + velocity.verticalSpeedMps * t } }));
  const maxT = Math.max(0, ...horizonsS), path = [position, ...route.remainingPath(position, speed * maxT)];
  return horizonsS.map(t => ({ tSeconds: t, position: walk(path, speed * t) }));
}
function walk(path: GeoPosition[], distanceM: number): GeoPosition {
  let left = distanceM;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!, d = haversineDistance(a, b);
    if (d >= left && d > 0) return { ...destinationPoint(a, initialBearing(a, b), left), altMsl: a.altMsl + (b.altMsl - a.altMsl) * (left / d) };
    left -= d;
  }
  return path[path.length - 1]!;
}

const reasonFor = (p: number): RequestReason => (Object.entries(PRIORITY).find(([, v]) => v === p)![0]) as RequestReason;

/**
 * The full wanted set for one aircraft state, sorted by priority (desc), distance (asc), key: deterministic for a given
 * input, so the same flight always requests the same tiles in the same order.
 */
export function planTiles(input: PlanInput): TileRequest[] {
  const policy = input.policy ?? DEFAULT_LOD_POLICY;
  const state: FlightState = { aglM: input.aglM ?? input.position.altMsl, groundSpeedMps: input.velocity.groundSpeedMps };
  const rings = lodRings(state, policy), allowed = new Set(input.layers ?? rings.flatMap(r => r.layers));
  const wanted = new Map<string, TileRequest>(), p = input.position, track = input.velocity.trackDeg;
  const moving = input.velocity.groundSpeedMps > 1;
  const fixedZoom = policy.layerZoom ?? {};
  const add = (tile: TileId, level: DetailLevel, layers: readonly WorldLayer[], priority: number, uncapped = false) => {
    const distanceM = distanceToTile(p, tile);
    for (const layer of layers) {
      if (!allowed.has(layer)) continue;
      // Single-zoom layers are only ever requested at their own zoom (below).
      const z = fixedZoom[layer];
      if (z !== undefined && tile.z !== z) continue;
      const cap = policy.layerMaxDistanceM?.[layer];
      if (!uncapped && cap !== undefined && priority < PRIORITY.CURRENT && distanceM > cap) continue;
      const key = `${layer}:${tileKey(tile)}`, old = wanted.get(key);
      if (!old || old.priority < priority) wanted.set(key, { key, layer, tile, level, priority, reason: reasonFor(priority), distanceM });
    }
  };

  // Concentric rings: in-range tiles are 40, those behind the aircraft 5.
  for (const ring of rings) for (const tile of tilesInRadius(p, ring.outerM, ring.zoom)) {
    if (ring.innerM > 0 && isInsideRing(p, tile, ring.innerM)) continue;
    const c = tileCenter(tile), behind = moving && distanceToTile(p, tile) > 0 && Math.abs(angleDiff(track, initialBearing(p, c))) > 100;
    add(tile, ring.level, ring.layers, behind ? PRIORITY.BEHIND : PRIORITY.IN_RANGE);
  }
  const inner = rings[0]!;
  add(lonLatToTile(p.lon, p.lat, inner.zoom), inner.level, inner.layers, PRIORITY.CURRENT);

  // Where the aircraft will be: innermost detail around each predicted point.
  for (const pt of predictPath(p, input.velocity, input.route, input.horizonsS)) {
    const reason = HORIZON_PRIORITY[pt.tSeconds] ?? "AHEAD_120S";
    for (const tile of tileNeighbourhood(pt.position.lon, pt.position.lat, inner.zoom)) add(tile, inner.level, inner.layers, PRIORITY[reason]);
  }

  // Single-zoom layers (vector features): their own zoom, around the aircraft and ahead of it, while the altitude
  // policy keeps them in some ring.
  for (const [layer, z] of Object.entries(fixedZoom) as [WorldLayer, number][]) {
    const ring = rings.find(r => r.layers.includes(layer));
    if (!ring || !allowed.has(layer)) continue;
    const reach = Math.min(policy.layerMaxDistanceM?.[layer] ?? ring.outerM, rings[rings.length - 1]!.outerM);
    for (const tile of tilesInRadius(p, reach, z)) {
      const behind = moving && distanceToTile(p, tile) > 0 && Math.abs(angleDiff(track, initialBearing(p, tileCenter(tile)))) > 100;
      add(tile, ring.level, [layer], behind ? PRIORITY.BEHIND : PRIORITY.IN_RANGE);
    }
    add(lonLatToTile(p.lon, p.lat, z), ring.level, [layer], PRIORITY.CURRENT);
    for (const pt of predictPath(p, input.velocity, input.route, input.horizonsS)) {
      const reason = HORIZON_PRIORITY[pt.tSeconds] ?? "AHEAD_120S";
      for (const tile of tileNeighbourhood(pt.position.lon, pt.position.lat, z)) add(tile, ring.level, [layer], PRIORITY[reason]);
    }
  }

  if (input.route) {
    // Route corridor at the level the route crosses, and the destination at arrival detail.
    for (const q of input.route.remainingPath(p, rings[rings.length - 1]!.outerM)) {
      const d = haversineDistance(p, q), ring = rings.find(r => d <= r.outerM) ?? rings[rings.length - 1]!;
      add(lonLatToTile(q.lon, q.lat, ring.zoom), ring.level, ring.layers, PRIORITY.ROUTE);
    }
    const dest = input.route.destination, dDist = haversineDistance(p, dest), dRing = rings.find(r => dDist <= r.outerM) ?? rings[rings.length - 1]!;
    add(lonLatToTile(dest.lon, dest.lat, dRing.zoom), dRing.level, ["terrain"], PRIORITY.DESTINATION);
    // The destination's runways and aprons, in full detail, from 30 km out (the whole approach).
    const az = fixedZoom.airports;
    if (az !== undefined && dDist < 30_000) for (const tile of tilesInRadius(dest, 2500, az)) add(tile, dRing.level, ["airports"], PRIORITY.DESTINATION, true);
  }

  return [...wanted.values()].sort(compareRequests);
}
export const compareRequests = (a: TileRequest, b: TileRequest) => b.priority - a.priority || a.distanceM - b.distanceM || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** A tile is left to the inner ring only if all four corners are within that ring's radius. */
function isInsideRing(p: GeoPosition, t: TileId, radiusM: number) {
  const n = 2 ** t.z;
  const corner = (dx: number, dy: number) => {
    const x = t.x + dx, y = t.y + dy;
    return { lon: (x / n) * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180 / Math.PI };
  };
  return [corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)].every(c => haversineDistance(p, c) <= radiusM);
}
