import type {AircraftControls, WorldSnapshot, PilotIntent} from "./index.ts";
export type SimPilot="AUTOPILOT"|"MANUAL";
/** How often a situation/action pair ended in a landing or a crash. `visits` = successes + failures. */
export interface LearningEntry{visits:number;successes:number;failures:number}
/**
 * Experience learned in the browser. The simulation worker owns and updates it; the page persists it in
 * localStorage and loads it back into the worker. Keys are `${situationFingerprint}|${action}`.
 */
export interface LearningBook{version:1;flights:number;landings:number;crashes:number;entries:Record<string,LearningEntry>}
/** The best-known action for the aircraft's current situation. */
export interface LearningInsight{situation:string;action:string;successRate:number;visits:number}
export type SimCommand=
 | {type:"RESET";seed:string;scenario?:"default"|"seeded"}
 | {type:"STEP";ticks:number;seq?:number}
 | {type:"SET_INTENT";intent:PilotIntent}
 | {type:"SET_PILOT";pilot:SimPilot}
 | {type:"PAUSE"}|{type:"RESUME"}
 | {type:"SET_LEARNING";enabled:boolean}
 | {type:"LOAD_LEARNING";book:unknown}
 | {type:"CLEAR_LEARNING"}
 | {type:"RESTORE";snapshot:unknown};
export type SimEvent=
 | {type:"READY"}
 | {type:"WORLD";world:WorldSnapshot;seq?:number;controls?:AircraftControls;pilot?:SimPilot;intent?:PilotIntent;autopilotMode?:string;scenarioId?:string;paused?:boolean;learning?:boolean;insight?:LearningInsight}
 | {type:"LEARNING";book:LearningBook;reason:"LOADED"|"RECORDED"|"CLEARED"|"REJECTED"}
 | {type:"CHECKSUM";tick:string;checksum:string}
 | {type:"ERROR";message:string};
export type InspectorCommand={type:"SEEK";tick:string}|{type:"PLAY"}|{type:"PAUSE"};
