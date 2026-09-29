import type {DecisionFrame, PilotIntent, RewardVector} from "./index.ts";
/**
 * Telemetry contracts shared by the runtime (producer) and presentation apps (consumers).
 * They live in @flight/protocol so a UI never has to depend on the runtime, cognition or simulation.
 */
export type RuntimeEvent =
 | {type:"DECISION";frame:DecisionFrame}
 | {type:"SAFETY_OVERRIDE";decisionId:string;requested:string;executed:string;reason:string}
 | {type:"OUTCOME";decisionId:string;horizon:"IMMEDIATE"|"1S"|"3S";reward:RewardVector}
 | {type:"EPISODE_END";tick:string;phase:string;checksum:string}
 /** GeoTelemetry: real-world streaming state during an anchored flight (sampled; observation only). */
 | {type:"WORLD_STREAM";tick:string;stream:WorldStreamSample};
/**
 * What the physics world holds and lacks around the aircraft, how the render streamer is doing, and whether the
 * destination is ready. Timings are wall-clock and never affect the flight.
 */
/** BroadcastChannel over which an open simulator relays live runtime events to Control Room tabs (same origin). */
export const RUNTIME_CHANNEL="flight-world-runtime";
export interface WorldStreamSample{
 airport:string;state:"LOADING"|"READY"|"ERROR";frameEpoch:number;position:{lat:number;lon:number;altMsl:number};
 features:"OFF"|"LOADING"|"READY"|"UNAVAILABLE";
 /** Deterministic tiles: loaded counts, tiles still missing in the 3×3 blocks under the aircraft, clock holds. */
 physics:{terrainTiles:number;featureTiles:number;missingAround:number;holding:boolean;holds:number;holdMs:number;manifest?:string};
 /** Render streaming (LOD rings, prediction): queue, loads, failures, cache and recent load latency. */
 render:{wanted:number;queued:number;inFlight:number;loaded:number;failed:number;aborted:number;evictions:number;cacheEntries:number;cacheMB:number;hitRate:number|null;latencyP50Ms:number|null;latencyP95Ms:number|null};
 destination?:{ident:string;distanceKm:number;terrainReady:boolean;featuresReady:boolean|null};
}
export interface DecisionTrace{
 decisionId:string;provider:string;model:string;
 candidates:readonly {intent:PilotIntent;probability:number}[];
 temporalPatterns:readonly string[];retrievedExperienceIds:readonly string[];
 requested:PilotIntent;executed:PilotIntent;safetyReason?:string;
 providerDisagreement:number;
}
