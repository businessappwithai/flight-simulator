import type {AircraftControls, WorldSnapshot, PilotIntent} from "./index.ts";
import type {RuntimeEvent,WorldStreamSample} from "./telemetry.ts";
export type SimPilot="AUTOPILOT"|"MANUAL";
/**
 * How often a situation/intent pair ended in a landing or a crash, and who was flying. Each finished flight
 * credits a pair once per pilot that flew it: `visits` = successes + failures = manual + autopilot.
 */
export interface LearningEntry{visits:number;successes:number;failures:number;manual:number;autopilot:number}
export interface LearningTally{flights:number;landings:number;crashes:number}
/**
 * Experience learned in the browser from manual and autopilot flying alike: both are recorded as the same
 * pilot intents, so each teaches the other. The simulation worker owns and updates it; the page persists it
 * in localStorage and loads it back. Keys are `${situationFingerprint}|${PilotIntent}`. A flight flown by
 * both pilots counts once in the totals and once in each pilot's tally.
 */
export interface LearningBook{version:2;flights:number;landings:number;crashes:number;manual:LearningTally;autopilot:LearningTally;entries:Record<string,LearningEntry>;
 /** Recent examples (newest last, bounded) the XGBoost model is trained on. */
 examples?:LearningExample[]}
/**
 * The copilot's latest recommendation while the autopilot flies: Jev's choice, or the XGBoost model's when Jev's
 * confidence was below the threshold (or Jev could not be reached). `flown` is what the autopilot was flying then.
 */
export interface CopilotAdvice{tick:string;intent:PilotIntent;flown:PilotIntent;source:"JEV"|"BEST_PRACTICE";provider:string;confidence:number;jevConfidence?:number;reason:string;latencyMs:number}
export interface CopilotStatus{jev:"OFF"|"READY"|"ERROR";model?:string;detail?:string;xgboost:{examples:number;trained:boolean;version?:string;detail?:string}}
/**
 * A training example for the in-browser XGBoost best-practice model: the observation features
 * (observationFeatures, 8 values), the intent flown, and whether that flight landed (1) or crashed (0).
 */
export interface LearningExample{f:number[];a:PilotIntent;ok:0|1}
/** The best-known intent for the aircraft's current situation, and which pilots it was learned from. */
export interface LearningInsight{situation:string;action:PilotIntent;successRate:number;visits:number;manual:number;autopilot:number}
/**
 * One flight as Control Room telemetry: a DECISION frame per change of intent or pilot (provider "manual" or
 * "autopilot"), each carrying the flight's terminal outcome, then EPISODE_END. ABANDONED flights (restarted
 * before landing or crashing) have no outcome.
 */
export interface FlightTrace{id:string;scenarioId:string;outcome:"LANDED"|"CRASHED"|"ABANDONED";pilots:readonly SimPilot[];events:readonly RuntimeEvent[]}
/** Local simulator coordinates as the renderer uses them: three.js (x, y, z) = simulation (−x, y, z). */
export type Vec3Tuple=[number,number,number];
/** A nearby airport as the page draws it (beacon plus runway strips), positioned in the anchored local frame. */
export interface GeoAirportMarker{ident:string;name:string;position:Vec3Tuple;distanceM:number;detail:"METADATA"|"MARKER"|"BASIC"|"FULL"|"HIGHEST";runways:{ident:string;le:Vec3Tuple;he:Vec3Tuple;widthM:number}[]}
/**
 * Real-world placement of the flight when the simulator is anchored to an airport (`SET_WORLD`): where the local
 * frame sits on Earth, the aircraft's WGS84 position, the terrain under it and what is streaming.
 */
export interface GeoStatus{airport:string;name:string;runway:string;headingDeg:number;
 /** LOADING until the terrain around the runway is in; ERROR means real terrain is unavailable and the ground is flat. */
 state:"LOADING"|"READY"|"ERROR";detail?:string;
 anchor:{lat:number;lon:number;elevationM:number};
 position:{lat:number;lon:number;altMsl:number};trackDeg:number;terrainElevationM:number|null;aglM:number|null;
 /** True while the clock waits for the terrain under the aircraft (keeps physics independent of network timing). */
 holding:boolean;
 /** Deterministic terrain the physics used: tile count and SHA-256 over the tile manifest. */
 simTiles:number;manifest?:string;
 streaming:{wanted:number;loaded:number;inFlight:number;cacheMB:number};
 airports:GeoAirportMarker[];attribution:string[];
 /** Buildings and airport surfaces (vector tiles): OFF without a source, UNAVAILABLE when it cannot be reached. */
 features:{state:"OFF"|"LOADING"|"READY"|"UNAVAILABLE";tiles:number;buildings:number;detail?:string};
 /** True when the runway was placed from surveyed data (OSM/Overture), false when synthesized from OurAirports. */
 surveyed:boolean;
 /** Ref of the real runway under the aircraft (e.g. "09L/27R"), or null. */
 runwayBelow:string|null;
 /** What is directly under the aircraft (names the cause when a flight ends in a crash). */
 surface:"AIRFIELD"|"RUNWAY"|"BUILDING"|"TERRAIN";
 /**
  * Changes each time the local frame is re-anchored under the aircraft (every ~25 km, so long flights keep small,
  * precise coordinates and a level local "up"); the page redraws terrain and moves the home airfield then.
  */
 frameEpoch:number;
 /** Where the procedural home airfield now sits in local three.js coordinates (identity until the first re-anchoring). */
 home:{position:Vec3Tuple;rotationY:number};
 /** The current local frame: its origin (WGS84), the true heading of local +z, and ECEF → three.js (column-major 4×4) for ECEF data such as 3D Tiles. */
 frame:{lat:number;lon:number;altMsl:number;headingDeg:number;ecefToThree:number[]};
 /** Flight to another airport, when a destination is set. */
 route?:GeoRouteStatus;
 /** Ident of the destination airport once the aircraft has landed and slowed there. */
 arrived?:string;
 /** Airports available for search (the full OurAirports catalogue once loaded, else the bundled sample). */
 catalogSize:number}
export interface GeoRouteStatus{destination:string;name:string;runway:string;runwayHeadingDeg:number;surveyed:boolean;
 /** Great-circle distance to the destination threshold, and the true bearing to it. */
 distanceM:number;bearingDeg:number;
 /** Distance off the planned route (positive: right of it). */
 crossTrackM:number;totalM:number;etaS:number|null;
 /** What the route autopilot is doing (or would do): TAKEOFF, CLIMB, CRUISE, DESCENT, FINAL, FLARE, ROLLOUT. */
 phase:string;targetAltMsl:number;
 /** Route polyline (local three.js coordinates, y at ground level) for the moving map and 3D route line. */
 path:Vec3Tuple[]}
/** Buildings or airport surfaces for one vector tile: flat-shaded triangles, float32 relative to `center`. */
export interface FeaturePatch{key:string;layer:"buildings"|"airports";center:Vec3Tuple;positions:Float32Array;colors:Uint8Array;
 /** Runway edge lights (points, relative to `center`). */
 lights?:Float32Array}
/** One terrain tile mesh. Positions are float32 relative to `center` (three.js coordinates, kept in double precision). */
export interface TerrainPatch{key:string;z:number;center:Vec3Tuple;positions:Float32Array;colors:Uint8Array;indices:Uint16Array}
export interface GeoCatalogAirport{ident:string;name:string;municipality:string;country:string;runways:string[];iata?:string;type?:string;lat?:number;lon?:number}
export type SimCommand=
 | {type:"RESET";seed:string;scenario?:"default"|"seeded"}
 | {type:"STEP";ticks:number;seq?:number}
 | {type:"SET_INTENT";intent:PilotIntent}
 | {type:"SET_PILOT";pilot:SimPilot}
 | {type:"PAUSE"}|{type:"RESUME"}
 | {type:"SET_LEARNING";enabled:boolean}
 | {type:"LOAD_LEARNING";book:unknown}
 | {type:"CLEAR_LEARNING"}
 /** The Jev key for the copilot (kept only in the worker's memory); null turns the copilot off. */
 | {type:"SET_JEV";apiKey:string|null}
 | {type:"RESTORE";snapshot:unknown}
 /** Airport search (ICAO / IATA / name / city) over the loaded catalogue. */
 | {type:"FIND_AIRPORTS";query:string;limit?:number}
 /** Offline route pack: fetch (and keep in the browser's tile cache) every tile the planned route needs. */
 | {type:"PACK_ROUTE"}
 /** Forget every tile kept for offline use. */
 | {type:"CLEAR_TILE_CACHE"}
 /** Anchor the flight to a real airport and runway (null: the procedural airfield). `terrainUrl` overrides the Terrarium tile URL template. */
 | {type:"SET_WORLD";airport:string|null;runway?:string;terrainUrl?:string;
  /** Destination airport (and runway) for a cross-country flight: the autopilot then flies the route and lands there. */
  destination?:string|null;destinationRunway?:string;
  /** Buildings and airport surfaces: OpenMapTiles vector tiles ({z}/{x}/{y} template, TileJSON or .pmtiles URL); null turns them off. Default: OpenFreeMap. */
  featuresUrl?:string|null};
export type SimEvent=
 | {type:"READY"}
 | {type:"WORLD";world:WorldSnapshot;seq?:number;controls?:AircraftControls;pilot?:SimPilot;intent?:PilotIntent;autopilotMode?:string;scenarioId?:string;paused?:boolean;learning?:boolean;insight?:LearningInsight;copilot?:CopilotAdvice;copilotStatus?:CopilotStatus;geo?:GeoStatus}
 | {type:"LEARNING";book:LearningBook;reason:"LOADED"|"RECORDED"|"CLEARED"|"REJECTED"}
 | {type:"TRACE";trace:FlightTrace}
 | {type:"CHECKSUM";tick:string;checksum:string}
 /** Terrain meshes to add and keys to drop. `epoch` changes when the world is re-anchored; patches from older epochs are stale. */
 | {type:"TERRAIN";epoch:number;add:TerrainPatch[];remove:string[];clear?:boolean}
 /** Building and airport-surface meshes to add and keys to drop (same epoch rules as TERRAIN). */
 | {type:"FEATURES";epoch:number;add:FeaturePatch[];remove:string[];clear?:boolean}
 /** Airports the simulator can be anchored to (sent once at start-up). */
 | {type:"GEO_CATALOG";airports:GeoCatalogAirport[];total?:number}
 /** Search results for FIND_AIRPORTS. */
 | {type:"AIRPORTS_FOUND";query:string;airports:GeoCatalogAirport[]}
 /** Route pack progress; `cached` is how many tile responses the browser keeps for offline use (null: no Cache API). */
 /** GeoTelemetry sample (also recorded in the flight trace); the page relays it live to an open Control Room. */
 | {type:"WORLD_STREAM";tick:string;stream:WorldStreamSample}
 | {type:"ROUTE_PACK";state:"RUNNING"|"DONE"|"ERROR"|"CLEARED";done:number;total:number;failed:number;cached:number|null;detail?:string}
 /** A rejected command (`command` names it, e.g. SET_WORLD for an unknown airport) or a runtime failure. */
 | {type:"ERROR";message:string;command?:string};
export type InspectorCommand={type:"SEEK";tick:string}|{type:"PLAY"}|{type:"PAUSE"};
