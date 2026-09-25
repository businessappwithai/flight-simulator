import type { Scenario } from "@flight/simulation";
export interface ScenarioMutation {axis:"OBSTACLE_X"|"OBSTACLE_SPEED"|"CHECKPOINT_X"|"START_ALTITUDE";delta:number;}
export function mutate(s:Scenario,m:ScenarioMutation):Scenario{
 if(m.axis==="OBSTACLE_X")return {...s,obstacleStart:{...s.obstacleStart,x:s.obstacleStart.x+m.delta}};
 if(m.axis==="OBSTACLE_SPEED")return {...s,obstacleVelocity:{...s.obstacleVelocity,x:s.obstacleVelocity.x+m.delta}};
 if(m.axis==="CHECKPOINT_X")return {...s,checkpoint:{...s.checkpoint,x:s.checkpoint.x+m.delta}};
 return {...s,aircraftStart:{...s.aircraftStart,y:Math.max(0,s.aircraftStart.y+m.delta)}};
}

export { minimizeScenario } from "./minimize.ts";
export type { FailurePredicate } from "./minimize.ts";

export { nextCurriculumLevel } from "./curriculum.ts";
export type { CurriculumLevel, CurriculumResult } from "./curriculum.ts";

export { hillSearch, disagreementObjective, worldModelErrorObjective, skillBoundaryObjective } from "./search.ts";

export { ddmin } from "./ddmin.ts";
export type { Feature } from "./ddmin.ts";
