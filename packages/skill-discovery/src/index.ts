import type { DecisionFrame, PilotIntent } from "@flight/protocol";
export interface SequenceCandidate{actions:readonly PilotIntent[];occurrences:number;successes:number}
export function mineSequences(episodes:readonly (readonly DecisionFrame[])[],minLen=2,maxLen=6):readonly SequenceCandidate[]{
 const m=new Map<string,{actions:PilotIntent[];occurrences:number;successes:number}>();
 for(const ep of episodes)for(let n=minLen;n<=maxLen;n++)for(let i=0;i+n<=ep.length;i++){
  const frames=ep.slice(i,i+n),actions=frames.map(x=>x.executedIntent),key=actions.join(">");
  const x=m.get(key)??{actions,occurrences:0,successes:0};x.occurrences++;
  const r=frames.at(-1)?.outcome?.after3s??frames.at(-1)?.outcome?.after1s;
  if(r&&(r.survival+r.objective+r.separation)>0)x.successes++;m.set(key,x);
 }
 return [...m.values()].filter(x=>x.occurrences>=2).sort((a,b)=>b.successes-a.successes||b.occurrences-a.occurrences);
}

export { validatedForShadow, validatedForActive } from "./validate.ts";
export type { SkillValidation } from "./validate.ts";
