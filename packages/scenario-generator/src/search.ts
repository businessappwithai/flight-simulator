export interface SearchCandidate<T>{scenario:T;score:number;reason:string}
export type ScenarioMutator<T>=(s:T,index:number)=>T;
export type ScenarioScorer<T>=(s:T)=>Promise<{score:number;reason:string}>;
export async function searchScenarios<T>(seed:T,mutate:ScenarioMutator<T>,score:ScenarioScorer<T>,population=16,generations=4):Promise<readonly SearchCandidate<T>[]>{
 let current:T[]=[seed];const archive:SearchCandidate<T>[]=[];
 for(let g=0;g<generations;g++){
  const candidates=current.flatMap(s=>Array.from({length:population},(_,i)=>mutate(s,i)));
  const scored=await Promise.all(candidates.map(async scenario=>({scenario,...await score(scenario)})));
  scored.sort((a,b)=>b.score-a.score);archive.push(...scored.slice(0,4));current=scored.slice(0,4).map(x=>x.scenario);
 }
 return archive.sort((a,b)=>b.score-a.score);
}
export const disagreementObjective=(providerDistance:number,entropy:number)=>providerDistance*2+entropy;
export const worldModelErrorObjective=(error:number,uncertainty:number)=>error*2+uncertainty;
export const skillBoundaryObjective=(applicability:number,outcomeVariance:number)=>Math.max(0,1-Math.abs(applicability-.5))*2+outcomeVariance;
