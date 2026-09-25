export interface ResearchSignal {
 id:string;severity:number;novelty:number;uncertainty:number;
 providerDisagreement:number;worldModelError:number;estimatedCost:number;
}
export function prioritizeResearch(xs:readonly ResearchSignal[]):readonly ResearchSignal[]{
 const score=(x:ResearchSignal)=>
  x.severity*3+x.novelty*2+x.uncertainty+x.providerDisagreement*2+x.worldModelError*2-x.estimatedCost*.25;
 return [...xs].sort((a,b)=>score(b)-score(a));
}
