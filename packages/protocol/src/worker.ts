import type {AircraftControls, WorldSnapshot, PilotIntent} from "./index.ts";
import type {RuntimeEvent} from "./telemetry.ts";
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
 | {type:"RESTORE";snapshot:unknown};
export type SimEvent=
 | {type:"READY"}
 | {type:"WORLD";world:WorldSnapshot;seq?:number;controls?:AircraftControls;pilot?:SimPilot;intent?:PilotIntent;autopilotMode?:string;scenarioId?:string;paused?:boolean;learning?:boolean;insight?:LearningInsight;copilot?:CopilotAdvice;copilotStatus?:CopilotStatus}
 | {type:"LEARNING";book:LearningBook;reason:"LOADED"|"RECORDED"|"CLEARED"|"REJECTED"}
 | {type:"TRACE";trace:FlightTrace}
 | {type:"CHECKSUM";tick:string;checksum:string}
 | {type:"ERROR";message:string};
export type InspectorCommand={type:"SEEK";tick:string}|{type:"PLAY"}|{type:"PAUSE"};
