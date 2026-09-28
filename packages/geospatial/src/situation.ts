/**
 * Geographic situation for the AI pilot (Jev / Open-Jev, ExperienceForest, XGBoost, Dreamer, safety). Built only from
 * the deterministic `SimulationWorld` and the airport index, so it is identical in a replay.
 */
import { type GeoPosition, angleDiff } from "./geodesy.ts";
import { type AirportIndex, isAlternateCandidate } from "./airports.ts";
import type { GeoVelocity } from "./prefetch.ts";
import type { GreatCircleRoute } from "./route.ts";
import type { SimulationWorld } from "./sim-world.ts";

export interface GeoSituation {
  terrainElevationM: number | null;
  terrainClearanceM: number | null;
  /** Highest terrain within `lookaheadM` along the current track, and how far ahead it is. */
  terrainAhead: { maxElevationM: number | null; atDistanceM: number; clearanceM: number | null; unknownFraction: number };
  /** Terrain ahead rises at least `mountainReliefM` above the terrain below the aircraft. */
  mountainRangeAhead: boolean;
  onRunway: string | null;
  insideObstacle: string | null;
  alternates: { ident: string; distanceM: number; bearingDeg: number; relativeBearingDeg: number }[];
  route: { alongM: number; remainingM: number; crossTrackM: number; trackErrorDeg: number } | null;
}

export interface SituationOptions { lookaheadM?: number; mountainReliefM?: number; alternates?: number; minRunwayM?: number }

export function geoSituation(world: SimulationWorld, airports: AirportIndex, position: GeoPosition, velocity: GeoVelocity, route?: GreatCircleRoute, o: SituationOptions = {}): GeoSituation {
  const lookahead = o.lookaheadM ?? 60_000, relief = o.mountainReliefM ?? 1_500;
  const here = world.elevationAt(position.lat, position.lon), ahead = world.terrainAhead(position, velocity.trackDeg, lookahead);
  const pr = route?.progress(position);
  return {
    terrainElevationM: here,
    terrainClearanceM: here === null ? null : position.altMsl - here,
    terrainAhead: { ...ahead, clearanceM: ahead.maxElevationM === null ? null : position.altMsl - ahead.maxElevationM },
    mountainRangeAhead: here !== null && ahead.maxElevationM !== null && ahead.maxElevationM - here >= relief,
    onRunway: (r => (r ? `${r.airport} ${r.ident}` : null))(world.runwayAt(position)),
    insideObstacle: world.obstacleAt(position)?.id ?? null,
    alternates: airports.nearest(position, o.alternates ?? 3, isAlternateCandidate(o.minRunwayM)).map(a => ({
      ident: a.airport.ident, distanceM: a.distanceM, bearingDeg: a.bearingDeg, relativeBearingDeg: angleDiff(velocity.trackDeg, a.bearingDeg),
    })),
    route: pr ? { alongM: pr.alongM, remainingM: pr.remainingM, crossTrackM: pr.crossTrackM, trackErrorDeg: angleDiff(pr.desiredTrackDeg, velocity.trackDeg) } : null,
  };
}
