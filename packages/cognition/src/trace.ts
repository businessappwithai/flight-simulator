import type {DecisionTrace} from "@flight/protocol";
export type {DecisionTrace};
export function traceSummary(t:DecisionTrace){
 return {decisionId:t.decisionId,selected:t.requested,executed:t.executed,
  topAlternatives:[...t.candidates].sort((a,b)=>b.probability-a.probability).slice(0,3),
  safetyOverride:t.requested!==t.executed?safe(t.safetyReason):undefined,
  disagreement:t.providerDisagreement};
}
const safe=(x?:string)=>x??"UNSPECIFIED";
