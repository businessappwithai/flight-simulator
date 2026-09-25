import type {PilotIntent} from "@flight/protocol";
export const ACTIONS=["HOLD","TURN_LEFT","TURN_RIGHT","CLIMB","DESCEND","SLOW","REROUTE","ABORT"] as const satisfies readonly PilotIntent[];
export interface BestPracticeExample{features:readonly number[];action:PilotIntent;reward:number;regret:number;success:boolean;safetyOverride:boolean;catastrophic:boolean}
export interface BestPracticePrediction{action:PilotIntent;probability:number}
export const actionIndex=(a:PilotIntent)=>ACTIONS.indexOf(a as typeof ACTIONS[number]);
export function trainingWeight(x:BestPracticeExample){
 if(x.catastrophic)return 12;
 if(x.safetyOverride)return 7;
 if(!x.success)return 5+Math.min(5,Math.max(0,x.regret));
 return 1+Math.min(5,Math.max(0,x.reward))+Math.max(0,2-x.regret);
}
