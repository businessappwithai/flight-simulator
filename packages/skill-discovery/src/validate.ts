import type { Skill } from "@flight/skills";
export interface SkillValidation{scenarioCount:number;successes:number;failures:number;safetyOverrides:number;meanRegret:number}
export function validatedForShadow(v:SkillValidation):boolean{
 return v.scenarioCount>=100&&v.failures===0&&v.safetyOverrides===0&&v.meanRegret<=.1;
}
export function validatedForActive(v:SkillValidation):boolean{
 return v.scenarioCount>=1000&&v.failures===0&&v.safetyOverrides===0&&v.meanRegret<=.05;
}
