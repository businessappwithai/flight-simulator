import type { DecisionFrame, RewardVector, WorldSnapshot } from "@flight/protocol";
export type RuntimeEvent =
 | {type:"DECISION";frame:DecisionFrame}
 | {type:"SAFETY_OVERRIDE";decisionId:string;requested:string;executed:string;reason:string}
 | {type:"OUTCOME";decisionId:string;horizon:"IMMEDIATE"|"1S"|"3S";reward:RewardVector}
 | {type:"EPISODE_END";tick:string;phase:string;checksum:string};
export type RuntimeListener=(event:RuntimeEvent)=>void;
export class RuntimeEventBus{
 #listeners=new Set<RuntimeListener>();
 subscribe(l:RuntimeListener){this.#listeners.add(l);return()=>this.#listeners.delete(l)}
 publish(e:RuntimeEvent){for(const l of this.#listeners)l(e)}
}
export interface PendingOutcome{decisionId:string;before:WorldSnapshot;startTick:bigint;}
