export type FailureType="COLLISION"|"OBJECTIVE_FAILURE"|"INSTABILITY"|"SAFETY_OVERRIDE"|"HIGH_REGRET"|"WORLD_MODEL_ERROR";
export interface FailureSignature{type:FailureType;situationFingerprint:string;recentActions:readonly string[];providerDisagreement:number;worldModelError?:number}
export function clusterFailures(xs:readonly FailureSignature[]){
 const m=new Map<string,FailureSignature[]>();for(const x of xs){const k=`${x.type}|${x.situationFingerprint}`;const a=m.get(k)??[];a.push(x);m.set(k,a);}
 return [...m.entries()].map(([key,signatures])=>({key,signatures})).sort((a,b)=>b.signatures.length-a.signatures.length);
}

export { deltaMinimize } from "./minimize.ts";
export type { FeatureSet } from "./minimize.ts";
