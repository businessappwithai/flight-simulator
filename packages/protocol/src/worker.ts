import type {WorldSnapshot, PilotIntent} from "./index.ts";
export type SimCommand=
 | {type:"RESET";seed:string}
 | {type:"STEP";ticks:number}
 | {type:"SET_INTENT";intent:PilotIntent}
 | {type:"PAUSE"}|{type:"RESUME"}
 | {type:"RESTORE";snapshot:unknown};
export type SimEvent=
 | {type:"READY"}
 | {type:"WORLD";world:WorldSnapshot}
 | {type:"CHECKSUM";tick:string;checksum:string}
 | {type:"ERROR";message:string};
export type InspectorCommand={type:"SEEK";tick:string}|{type:"PLAY"}|{type:"PAUSE"};
