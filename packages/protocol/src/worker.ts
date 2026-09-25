import type {AircraftControls, WorldSnapshot, PilotIntent} from "./index.ts";
export type SimPilot="AUTOPILOT"|"MANUAL";
export type SimCommand=
 | {type:"RESET";seed:string;scenario?:"default"|"seeded"}
 | {type:"STEP";ticks:number;seq?:number}
 | {type:"SET_INTENT";intent:PilotIntent}
 | {type:"SET_PILOT";pilot:SimPilot}
 | {type:"PAUSE"}|{type:"RESUME"}
 | {type:"RESTORE";snapshot:unknown};
export type SimEvent=
 | {type:"READY"}
 | {type:"WORLD";world:WorldSnapshot;seq?:number;controls?:AircraftControls;pilot?:SimPilot;intent?:PilotIntent;autopilotMode?:string;scenarioId?:string;paused?:boolean}
 | {type:"CHECKSUM";tick:string;checksum:string}
 | {type:"ERROR";message:string};
export type InspectorCommand={type:"SEEK";tick:string}|{type:"PLAY"}|{type:"PAUSE"};
