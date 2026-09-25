export interface PromotionEvidence {
  scenarios:number; baselineFailures:number; candidateFailures:number;
  baselineCompletionRate:number; candidateCompletionRate:number;
  newHardRegressions:number; reproducible:boolean;
}
export type PromotionDecision="PROMOTE"|"REJECT"|"MORE_EVIDENCE";
export function promotionDecision(e:PromotionEvidence):PromotionDecision{
 if(!e.reproducible || e.newHardRegressions>0)return "REJECT";
 if(e.scenarios<1000)return "MORE_EVIDENCE";
 if(e.candidateFailures>e.baselineFailures)return "REJECT";
 if(e.candidateCompletionRate<e.baselineCompletionRate)return "REJECT";
 return "PROMOTE";
}
