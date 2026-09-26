import type {RuntimeEvent} from "@flight/protocol";
import type {AdvisorEvidence,DecisionEvidence} from "@flight/protocol";
export type Ranked=readonly {action:string;probability:number}[];
export type Imagined=readonly {action:string;horizonSeconds:number;predictedRisk:number;uncertainty:number;predictedReward:number}[];
export interface ShadowWhy{provider:string;model:string;top?:string;probability?:number;error?:string}
export interface DecisionWhy{
 decisionId:string;requested:string;executed:string;provider:string;model:string;
 confidence:number;alternatives:readonly {intent:string;probability:number}[];
 temporalPatterns:readonly string[];experienceIds:readonly string[];
 disagreement:number;safetyReason?:string;outcomes:Record<string,unknown>;startTick?:string;
 shadows?:readonly ShadowWhy[];bestPractice?:AdvisorEvidence<Ranked>;worldModel?:AdvisorEvidence<Imagined>;
 /** Who chose the intent: the provider, or the best-practice model when the provider was not confident enough. */
 selection?:DecisionEvidence["selection"];
}
export interface DashboardMetrics{decisions:number;overrides:number;overrideRate:number;episodes:number;providerDisagreements:number;meanConfidence:number}
const pct=(x:number)=>`${(x*100).toFixed(1)}%`;
export class LiveDashboardModel{
 #decisions=new Map<string,DecisionWhy>();#order:string[]=[];#episodes=0;#overrides=0;#disagreements=0;#confidence=0;
 ingest(e:RuntimeEvent){
  if(e.type==="DECISION"){
   // Accepts a canonical DecisionFrame (+ optional evidence), a frame carrying a DecisionTrace, or a flat trace-shaped frame.
   const f:any=e.frame,t:any=f.trace??{...f,...(f.evidence??{})};
   const candidates=(t.candidates??f.candidates??[]).filter((x:any)=>x?.intent) as {intent:string;probability:number}[];
   const id=String(t.decisionId??f.id??`decision-${this.#order.length+1}`),requested=String(t.requested??f.requestedIntent??candidates[0]?.intent??"UNKNOWN"),executed=String(t.executed??f.executedIntent??requested);
   const confidence=Number(f.probability??candidates[0]?.probability??0),disagreement=Number(t.providerDisagreement??0);
   if(!this.#decisions.has(id))this.#order.push(id);
   this.#decisions.set(id,{decisionId:id,requested,executed,provider:String(t.provider??f.provider??"unknown"),model:String(t.model??"unknown"),confidence,alternatives:candidates.slice(0,5),temporalPatterns:[...(t.temporalPatterns??[])],experienceIds:[...(t.retrievedExperienceIds??[])],disagreement,safetyReason:t.safetyReason,outcomes:{...(f.outcome??{})},startTick:f.startTick!==undefined?String(f.startTick):undefined,shadows:[...(t.shadows??[])],bestPractice:t.bestPractice,selection:t.selection,worldModel:t.worldModel});
   this.#confidence+=confidence;if(disagreement>.25)this.#disagreements++;
  } else if(e.type==="SAFETY_OVERRIDE"){this.#overrides++;const d=this.#decisions.get(e.decisionId);if(d){d.executed=e.executed;d.safetyReason=e.reason}}
  else if(e.type==="OUTCOME"){const d=this.#decisions.get(e.decisionId);if(d)d.outcomes[e.horizon]=e.reward}
  else if(e.type==="EPISODE_END")this.#episodes++;
 }
 latest(){const id=this.#order.at(-1);return id?this.#decisions.get(id):undefined}
 decisions(limit=200){return this.#order.slice(-limit).reverse().map(id=>this.#decisions.get(id)!).filter(Boolean)}
 metrics():DashboardMetrics{const n=this.#order.length;return{decisions:n,overrides:this.#overrides,overrideRate:n?this.#overrides/n:0,episodes:this.#episodes,providerDisagreements:this.#disagreements,meanConfidence:n?this.#confidence/n:0}}
 explain(id:string){
  const d=this.#decisions.get(id);if(!d)return undefined;
  const reasons=[`${d.provider}/${d.model} requested ${d.requested} at ${pct(d.confidence)} confidence.`];
  if(d.selection?.source==="BEST_PRACTICE")reasons.unshift(`Low-confidence fallback: ${d.selection.reason}`);
  else if(d.selection&&d.selection.providerConfidence<d.selection.threshold)reasons.push(d.selection.reason);
  const alt=d.alternatives.find(a=>a.intent!==d.requested&&a.probability>0);if(alt)reasons.push(`Next best alternative: ${alt.intent} at ${pct(alt.probability)}.`);
  if(d.temporalPatterns.length)reasons.push(`Temporal evidence: ${d.temporalPatterns.join("; ")}.`);
  if(d.experienceIds.length)reasons.push(`${d.experienceIds.length} prior experience records contributed.`);
  for(const s of d.shadows??[])reasons.push(s.error?`Shadow ${s.provider}/${s.model} failed: ${s.error}.`:`Shadow ${s.provider}/${s.model} preferred ${s.top??"nothing"}${s.probability!==undefined?` at ${pct(s.probability)}`:""}.`);
  if(d.disagreement>.25)reasons.push(`Provider disagreement was elevated (${d.disagreement.toFixed(3)}).`);
  if(d.bestPractice){const b=d.bestPractice;if(b.status==="OK"){const top=b.result[0],req=b.result.find(x=>x.action===d.requested);reasons.push(top?`XGBoost best-practice (${b.source}) rates ${top.action} most likely to succeed (${pct(top.probability)})${req&&req.action!==top.action?`; ${d.requested} ${pct(req.probability)}`:""}.`:`XGBoost best-practice (${b.source}) returned no ranking.`)}else reasons.push(`XGBoost best-practice ${b.status.toLowerCase()}: ${b.detail}.`)}
  if(d.worldModel){const w=d.worldModel;if(w.status==="OK"){const req=w.result.filter(x=>x.action===d.requested).sort((a,b)=>a.horizonSeconds-b.horizonSeconds).at(-1),safest=[...w.result].sort((a,b)=>a.predictedRisk-b.predictedRisk)[0];reasons.push(!w.result.length?`World model ${w.source} returned no predictions.`:`World model ${w.source}: ${req?`${d.requested} risk ${req.predictedRisk.toFixed(2)} (uncertainty ${req.uncertainty.toFixed(2)}) at ${req.horizonSeconds}s`:`no prediction for ${d.requested}`}; lowest risk ${safest!.action} ${safest!.predictedRisk.toFixed(2)}.`)}else reasons.push(`World model ${w.source} ${w.status.toLowerCase()}: ${w.detail}.`)}
  if(d.executed!==d.requested)reasons.push(`Safety changed ${d.requested} to ${d.executed}: ${d.safetyReason??"unspecified reason"}.`);
  return reasons;
 }
}
