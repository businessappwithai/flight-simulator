import { horizonDistance } from "./geodesy.ts";

/**
 * Level-of-detail policy. Rings are driven by height above ground and ground speed, not distance alone:
 * at 1,500 ft and 80 kt the nearest 10 km get buildings, roads and airport surfaces; at 35,000 ft and 450 kt the same
 * 10 km only need terrain, water and airport markers, and the rings stretch ahead to cover what the aircraft reaches.
 */
export type WorldLayer = "terrain" | "water" | "landcover" | "roads" | "buildings" | "airports";
export const WORLD_LAYERS: readonly WorldLayer[] = ["terrain", "water", "landcover", "roads", "buildings", "airports"];
export type DetailLevel = "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW";
export const DETAIL_LEVELS: readonly DetailLevel[] = ["VERY_HIGH", "HIGH", "MEDIUM", "LOW"];
export interface LodRing { level: DetailLevel; innerM: number; outerM: number; zoom: number; layers: readonly WorldLayer[] }
export interface FlightState { aglM: number; groundSpeedMps: number }

export interface LodPolicy {
  /** Base ring outer radii (m) at low altitude and slow speed, innermost first. */
  radiiM: readonly [number, number, number, number];
  zoomByLevel: Record<DetailLevel, number>;
  layersByLevel: Record<DetailLevel, readonly WorldLayer[]>;
  /** Buildings are only worth streaming below this height above ground. */
  buildingsBelowAglM: number;
  roadsBelowAglM: number;
  /** AGL thresholds at which the innermost ring drops one detail level. */
  detailStepsAglM: readonly number[];
  /** Ground speed at which the rings start stretching, and the maximum stretch. */
  referenceSpeedMps: number;
  maxRadiusScale: number;
  /** Per-layer distance caps (m): dense layers such as buildings stop well inside their ring. */
  layerMaxDistanceM: Partial<Record<WorldLayer, number>>;
}

export const DEFAULT_LOD_POLICY: LodPolicy = {
  radiiM: [10_000, 50_000, 200_000, 500_000],
  zoomByLevel: { VERY_HIGH: 14, HIGH: 12, MEDIUM: 10, LOW: 8 },
  layersByLevel: {
    VERY_HIGH: ["terrain", "water", "landcover", "roads", "buildings", "airports"],
    HIGH: ["terrain", "water", "landcover", "roads", "buildings", "airports"],
    MEDIUM: ["terrain", "water", "landcover", "airports"],
    LOW: ["terrain", "water", "airports"],
  },
  buildingsBelowAglM: 1500,
  roadsBelowAglM: 3000,
  detailStepsAglM: [900, 4500],
  referenceSpeedMps: 120,
  maxRadiusScale: 2,
  layerMaxDistanceM: { buildings: 5000, airports: 15000 },
};

/** Detail level of the innermost ring: 0 = VERY_HIGH, 1 = HIGH, 2 = MEDIUM. */
export function innerDetailIndex(aglM: number, policy: LodPolicy = DEFAULT_LOD_POLICY) {
  return policy.detailStepsAglM.filter(h => aglM >= h).length;
}
export function radiusScale(groundSpeedMps: number, policy: LodPolicy = DEFAULT_LOD_POLICY) {
  return Math.max(1, Math.min(policy.maxRadiusScale, Math.max(0, groundSpeedMps) / policy.referenceSpeedMps));
}

export function lodRings(state: FlightState, policy: LodPolicy = DEFAULT_LOD_POLICY): LodRing[] {
  const shift = innerDetailIndex(state.aglM, policy), scale = radiusScale(state.groundSpeedMps, policy);
  const rings: LodRing[] = [];
  let inner = 0;
  for (let i = 0; i < policy.radiiM.length; i++) {
    const level = DETAIL_LEVELS[Math.min(DETAIL_LEVELS.length - 1, i + shift)]!;
    let outer = policy.radiiM[i]! * scale;
    // Nothing beyond the horizon (plus mountains poking above it) needs streaming, however fast the aircraft flies.
    if (i === policy.radiiM.length - 1) outer = Math.min(outer, Math.max(policy.radiiM[i]!, 1.5 * horizonDistance(state.aglM)));
    const layers = policy.layersByLevel[level].filter(l =>
      (l !== "buildings" || state.aglM < policy.buildingsBelowAglM) && (l !== "roads" || state.aglM < policy.roadsBelowAglM));
    // Two neighbouring rings that collapse to the same level merge, so no tile is requested twice.
    const prev = rings[rings.length - 1];
    if (prev && prev.level === level) prev.outerM = outer;
    else rings.push({ level, innerM: inner, outerM: outer, zoom: policy.zoomByLevel[level], layers });
    inner = outer;
  }
  return rings;
}
