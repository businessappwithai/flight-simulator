export type GateDecision="PROMOTE"|"HOLD"|"REJECT";
export interface ReleaseEvidence{
 reproducible:boolean;hardRegressions:number;episodes:number;completionDelta:number;
 failureDelta:number;safetyOverrideDelta:number;meanRegretDelta:number;
}
export function releaseGate(e:ReleaseEvidence):GateDecision{
 if(!e.reproducible||e.hardRegressions>0||e.failureDelta>0)return "REJECT";
 if(e.episodes<1000||e.completionDelta<0||e.safetyOverrideDelta>0||e.meanRegretDelta>0)return "HOLD";
 return "PROMOTE";
}
