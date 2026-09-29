import type {Observation,PilotIntent} from "@flight/protocol";
export declare function standInPolicy(o:Observation):PilotIntent;
export interface StandInJev{url:string;calls:number;observations:Observation[];stop():Promise<void>}
export declare function serveStandInJev(o?:{policy?:(o:Observation)=>PilotIntent;delayMs?:()=>number;fail?:boolean;confidence?:number;port?:number}):Promise<StandInJev>;
