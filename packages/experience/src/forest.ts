import type {PilotIntent,RewardVector} from "@flight/protocol";
export type ExperienceQuality="GOOD"|"PROMISING"|"UNCERTAIN"|"BAD"|"CATASTROPHIC";
export interface ExperienceStats{
 visits:number;successes:number;failures:number;safetyOverrides:number;
 rewardSum:number;regretSum:number;
}
export interface ExperienceBranch{
 id:string;fingerprint:string;action:PilotIntent;quality:ExperienceQuality;
 stats:ExperienceStats;children:Map<PilotIntent,ExperienceBranch>;
}
export interface NegativeMemory{fingerprint:string;action:PilotIntent;quality:"BAD"|"CATASTROPHIC";failures:number;reason:string}
const scalar=(r?:RewardVector)=>r?Object.values(r).reduce((a,b)=>a+b,0):0;
export function classifyExperience(s:ExperienceStats,catastrophic=false):ExperienceQuality{
 if(catastrophic)return "CATASTROPHIC";if(s.visits<3)return "UNCERTAIN";
 const rate=s.successes/s.visits,mean=s.rewardSum/s.visits,regret=s.regretSum/s.visits;
 if(s.safetyOverrides/s.visits>.35||rate<.2||regret>5)return "BAD";
 if(rate>=.85&&mean>0&&regret<=.5)return "GOOD";
 if(rate>=.65&&mean>=0)return "PROMISING";return "UNCERTAIN";
}
export class ExperienceForest{
 #roots=new Map<string,Map<PilotIntent,ExperienceBranch>>();
 #negative=new Map<string,NegativeMemory>();
 observe(fingerprint:string,sequence:readonly PilotIntent[],outcome:{success:boolean;reward?:RewardVector;regret:number;safetyOverride:boolean;catastrophic?:boolean}){
  if(!sequence.length)return;let level:Map<PilotIntent,ExperienceBranch>|undefined=this.#roots.get(fingerprint);if(!level){level=new Map();this.#roots.set(fingerprint,level)}
  for(let i=0;i<sequence.length;i++){const action=sequence[i]!;let n:ExperienceBranch|undefined=level.get(action);
   if(!n){n={id:`${fingerprint}:${i}:${action}`,fingerprint,action,quality:"UNCERTAIN",stats:{visits:0,successes:0,failures:0,safetyOverrides:0,rewardSum:0,regretSum:0},children:new Map()};level.set(action,n)}
   n.stats.visits++;outcome.success?n.stats.successes++:n.stats.failures++;if(outcome.safetyOverride)n.stats.safetyOverrides++;
   n.stats.rewardSum+=scalar(outcome.reward);n.stats.regretSum+=outcome.regret;n.quality=classifyExperience(n.stats,!!outcome.catastrophic);
   if(n.quality==="BAD"||n.quality==="CATASTROPHIC")this.#negative.set(`${fingerprint}|${action}`,{fingerprint,action,quality:n.quality,failures:n.stats.failures,reason:outcome.catastrophic?"catastrophic outcome":"poor historical evidence"});
   level=n.children;
  }
 }
 candidates(fingerprint:string){return [...(this.#roots.get(fingerprint)?.values()??[])].filter(x=>x.quality!=="BAD"&&x.quality!=="CATASTROPHIC").sort((a,b)=>score(b)-score(a))}
 negative(fingerprint:string){return [...this.#negative.values()].filter(x=>x.fingerprint===fingerprint)}
}
export const score=(x:ExperienceBranch)=>{const s=x.stats;return s.visits?2*(s.successes/s.visits)+(s.rewardSum/s.visits)-.5*(s.regretSum/s.visits)-2*(s.safetyOverrides/s.visits):0}
