import type { PilotIntent } from "@flight/protocol";
export type SkillStatus="DISCOVERED"|"OFFLINE_TESTING"|"COUNTERFACTUAL_VALIDATED"|"SHADOW"|"ACTIVE"|"DEGRADED"|"RETIRED";
export interface SkillStep {intent:PilotIntent;timeoutTicks:number;}
export interface SkillEvidence {observations:number;actualExecutions:number;counterfactualExecutions:number;successes:number;failures:number;meanRegret:number;safetyOverrideRate:number;}
export interface Skill {id:string;version:number;name:string;steps:readonly SkillStep[];status:SkillStatus;evidence:SkillEvidence;}
export function canPromoteSkill(s:Skill):boolean{
 return s.evidence.observations>=100&&s.evidence.failures===0&&s.evidence.safetyOverrideRate===0&&s.evidence.meanRegret<=0.05;
}

export { SkillStateMachine } from "./state-machine.ts";
export type { ExecutableSkillStep, TerminationCondition } from "./state-machine.ts";

export { provenanceComplete } from "./provenance.ts";
export type { SkillProvenance } from "./provenance.ts";
