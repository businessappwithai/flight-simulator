export interface SkillProvenance{
 discoveredFromEpisodes:readonly string[];scenarioFamilies:readonly string[];
 pilotVersion:string;counterfactualRuns:number;shadowRuns:number;createdAt:string;
}
export function provenanceComplete(p:SkillProvenance):boolean{
 return p.discoveredFromEpisodes.length>0&&p.scenarioFamilies.length>0&&p.counterfactualRuns>0&&p.shadowRuns>0;
}
