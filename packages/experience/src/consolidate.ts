import type { DecisionFrame, RewardVector } from "@flight/protocol";
export interface ConsolidationCandidate{
 frame:DecisionFrame;fingerprint:string;novelty:number;providerDisagreement:number;
 safetyOverride:boolean;worldModelError?:number;
}
const value=(r?:RewardVector)=>r?Object.values(r).reduce((a,b)=>a+b,0):0;
export function shouldConsolidate(x:ConsolidationCandidate):boolean{
 const r=x.frame.outcome?.after3s??x.frame.outcome?.after1s??x.frame.outcome?.immediate;
 return x.novelty>=.6||x.providerDisagreement>=.35||x.safetyOverride||
   (x.worldModelError??0)>=.5||Math.abs(value(r))>=5;
}
