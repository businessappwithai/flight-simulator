import type { PilotIntent, RewardVector } from "@flight/protocol";
import type { SituationVector } from "./index.ts";
export interface WorldModelTransition {
 episodeId:string;tick:string;state:SituationVector;action:PilotIntent;
 reward:RewardVector;nextState:SituationVector;terminal:boolean;
}
export interface DatasetManifest {
 id:string;schemaVersion:1;simulatorVersion:string;rewardVersion:string;
 scenarioSeeds:readonly string[];transitions:number;
}
export function toJsonl(rows:readonly WorldModelTransition[]):string{
 return rows.map(r=>JSON.stringify(r)).join("\n")+(rows.length?"\n":"");
}
