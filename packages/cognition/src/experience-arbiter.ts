import type {PilotIntent} from "@flight/protocol";
import type {ExperienceForest} from "@flight/experience";
export interface RankedAction{action:PilotIntent;score:number;source:string}
export function fuseExperienceCandidates(fingerprint:string,provider:readonly RankedAction[],tree:readonly RankedAction[],forest:ExperienceForest){
 const blocked=new Set(forest.negative(fingerprint).map(x=>x.action)),m=new Map<PilotIntent,{score:number;sources:Set<string>}>();
 const add=(x:RankedAction,w:number)=>{if(blocked.has(x.action))return;const v=m.get(x.action)??{score:0,sources:new Set<string>()};v.score+=x.score*w;v.sources.add(x.source);m.set(x.action,v)};
 provider.forEach(x=>add(x,1));tree.forEach(x=>add(x,.7));forest.candidates(fingerprint).forEach(x=>add({action:x.action,score:Math.max(0,x.stats.successes/Math.max(1,x.stats.visits)),source:"experience-forest"},.9));
 return [...m].map(([action,v])=>({action,score:v.score,sources:[...v.sources]})).sort((a,b)=>b.score-a.score);
}
