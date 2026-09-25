import type { Observation, PilotIntent } from "@flight/protocol";
export type TerminationCondition =
 | {kind:"ALTITUDE_AT_LEAST";value:number}
 | {kind:"ALTITUDE_AT_MOST";value:number}
 | {kind:"OBSTACLE_DISTANCE_AT_LEAST";value:number}
 | {kind:"TICKS";value:number};
export interface ExecutableSkillStep{intent:PilotIntent;until:TerminationCondition;timeoutTicks:number}
export class SkillStateMachine{
 #index=0;#elapsed=0;
 constructor(readonly steps:readonly ExecutableSkillStep[]){}
 current():PilotIntent|undefined{return this.steps[this.#index]?.intent}
 update(o:Observation):PilotIntent|undefined{
  const s=this.steps[this.#index];if(!s)return undefined;this.#elapsed++;
  const done=s.until.kind==="ALTITUDE_AT_LEAST"?o.altitude>=s.until.value:
   s.until.kind==="ALTITUDE_AT_MOST"?o.altitude<=s.until.value:
   s.until.kind==="OBSTACLE_DISTANCE_AT_LEAST"?(o.nearestObstacle?.distance??Infinity)>=s.until.value:
   this.#elapsed>=s.until.value;
  if(done||this.#elapsed>=s.timeoutTicks){this.#index++;this.#elapsed=0}
  return this.steps[this.#index]?.intent;
 }
 get complete(){return this.#index>=this.steps.length}
}
