import type {PilotIntent} from "@flight/protocol";
export interface DecisionTrace{
 decisionId:string;provider:string;model:string;
 candidates:readonly {intent:PilotIntent;probability:number}[];
 temporalPatterns:readonly string[];retrievedExperienceIds:readonly string[];
 requested:PilotIntent;executed:PilotIntent;safetyReason?:string;
 providerDisagreement:number;
}
export function traceSummary(t:DecisionTrace){
 return {decisionId:t.decisionId,selected:t.requested,executed:t.executed,
  topAlternatives:[...t.candidates].sort((a,b)=>b.probability-a.probability).slice(0,3),
  safetyOverride:t.requested!==t.executed?safe(t.safetyReason):undefined,
  disagreement:t.providerDisagreement};
}
const safe=(x?:string)=>x??"UNSPECIFIED";
