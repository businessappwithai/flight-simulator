import type {DecisionFrame, PilotIntent, RewardVector} from "./index.ts";
/**
 * Telemetry contracts shared by the runtime (producer) and presentation apps (consumers).
 * They live in @flight/protocol so a UI never has to depend on the runtime, cognition or simulation.
 */
export type RuntimeEvent =
 | {type:"DECISION";frame:DecisionFrame}
 | {type:"SAFETY_OVERRIDE";decisionId:string;requested:string;executed:string;reason:string}
 | {type:"OUTCOME";decisionId:string;horizon:"IMMEDIATE"|"1S"|"3S";reward:RewardVector}
 | {type:"EPISODE_END";tick:string;phase:string;checksum:string};
export interface DecisionTrace{
 decisionId:string;provider:string;model:string;
 candidates:readonly {intent:PilotIntent;probability:number}[];
 temporalPatterns:readonly string[];retrievedExperienceIds:readonly string[];
 requested:PilotIntent;executed:PilotIntent;safetyReason?:string;
 providerDisagreement:number;
}
