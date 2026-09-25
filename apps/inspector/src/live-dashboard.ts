import type {RuntimeEvent} from "@flight/runtime";
export interface DecisionWhy{
 decisionId:string;requested:string;executed:string;provider:string;model:string;
 confidence:number;alternatives:readonly {intent:string;probability:number}[];
 temporalPatterns:readonly string[];experienceIds:readonly string[];
 disagreement:number;safetyReason?:string;outcomes:Record<string,unknown>;startTick?:string;
}
export interface DashboardMetrics{decisions:number;overrides:number;overrideRate:number;episodes:number;providerDisagreements:number;meanConfidence:number}
export class LiveDashboardModel{
 #decisions=new Map<string,DecisionWhy>();#order:string[]=[];#episodes=0;#overrides=0;#disagreements=0;#confidence=0;
 ingest(e:RuntimeEvent){
  if(e.type==="DECISION"){
   const f:any=e.frame,t:any=f.trace??{};
   const candidates=(t.candidates??f.candidates??[{intent:f.requestedIntent,probability:f.probability}]).filter((x:any)=>x?.intent) as {intent:string;probability:number}[];
   const id=String(t.decisionId??f.id??`decision-${this.#order.length+1}`),requested=String(t.requested??f.requestedIntent??candidates[0]?.intent??"UNKNOWN"),executed=String(t.executed??f.executedIntent??requested);
   const confidence=Number(candidates[0]?.probability??f.probability??0),disagreement=Number(t.providerDisagreement??0);
   this.#decisions.set(id,{decisionId:id,requested,executed,provider:String(t.provider??f.provider??"unknown"),model:String(t.model??"decision-engine"),confidence,alternatives:candidates.slice(0,5),temporalPatterns:[...(t.temporalPatterns??[])],experienceIds:[...(t.retrievedExperienceIds??[])],disagreement,safetyReason:t.safetyReason,outcomes:{...(f.outcome??{})},startTick:f.startTick!==undefined?String(f.startTick):undefined});
   this.#order.push(id);this.#confidence+=confidence;if(disagreement>.25)this.#disagreements++;
  } else if(e.type==="SAFETY_OVERRIDE"){this.#overrides++;const d=this.#decisions.get(e.decisionId);if(d){d.executed=e.executed;d.safetyReason=e.reason}}
  else if(e.type==="OUTCOME"){const d=this.#decisions.get(e.decisionId);if(d)d.outcomes[e.horizon]=e.reward}
  else if(e.type==="EPISODE_END")this.#episodes++;
 }
 latest(){const id=this.#order.at(-1);return id?this.#decisions.get(id):undefined}
 decisions(limit=200){return this.#order.slice(-limit).reverse().map(id=>this.#decisions.get(id)!).filter(Boolean)}
 metrics():DashboardMetrics{const n=this.#order.length;return{decisions:n,overrides:this.#overrides,overrideRate:n?this.#overrides/n:0,episodes:this.#episodes,providerDisagreements:this.#disagreements,meanConfidence:n?this.#confidence/n:0}}
 explain(id:string){const d=this.#decisions.get(id);if(!d)return undefined;const reasons=[`${d.provider}/${d.model} requested ${d.requested} at ${(d.confidence*100).toFixed(1)}% confidence.`];if(d.temporalPatterns.length)reasons.push(`Temporal evidence: ${d.temporalPatterns.join(", ")}.`);if(d.experienceIds.length)reasons.push(`${d.experienceIds.length} prior experience records contributed.`);if(d.disagreement>.25)reasons.push(`Provider disagreement was elevated (${d.disagreement.toFixed(3)}).`);if(d.executed!==d.requested)reasons.push(`Safety changed ${d.requested} to ${d.executed}: ${d.safetyReason??"unspecified reason"}.`);return reasons}
}
