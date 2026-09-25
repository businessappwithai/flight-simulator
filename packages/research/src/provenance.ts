export interface Provenance{
 gitCommit?:string;pilotId:string;scenarioId:string;scenarioSeed:string;
 simulatorVersion:string;controllerVersion:string;safetyVersion:string;
 decisionProvider:string;decisionModel:string;worldModelVersion?:string;
 rewardVersion:string;startedAt:string;
}
export function provenanceKey(p:Provenance):string{
 return [p.gitCommit??"nogit",p.pilotId,p.scenarioId,p.scenarioSeed,p.simulatorVersion,p.controllerVersion,p.safetyVersion,p.decisionProvider,p.decisionModel,p.worldModelVersion??"none",p.rewardVersion].join("|");
}
