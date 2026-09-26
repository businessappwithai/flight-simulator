import type { AdvisorEvidence, DecisionEvidence, DecisionFrame, DecisionOutcome, Observation, PilotIntent, RewardVector } from "@flight/protocol";
import { disagreementScore, topCandidate, type DecisionEngineManager } from "@flight/decision-core";
import { RingBuffer } from "@flight/memory";
import type { TemporalStrategy } from "./index.ts";
import type { ExperienceRepository } from "@flight/experience";
import { situationFingerprint } from "@flight/experience";
import type { WorldModel } from "@flight/world-model";

const CANDIDATES=["HOLD","TURN_LEFT","TURN_RIGHT","CLIMB","DESCEND","SLOW","REROUTE","ABORT"] as const;
const PHASES=["OUTBOUND","RETURN","COMPLETE","FAILED"] as const;
export const OBSERVATION_FEATURES_V1=["altitude","speed","headingSin","headingCos","obstacleDistance","obstacleBearingSin","obstacleBearingCos","phase"] as const;
/** V2 adds objective geometry and attitude so an outcome model can learn navigation, not just survival. */
export const OBSERVATION_FEATURES_V2=[...OBSERVATION_FEATURES_V1,"objectiveDistance","objectiveBearingSin","objectiveBearingCos","heightAboveObjective","roll","pitch","verticalSpeed"] as const;
export function observationFeaturesV2(o:Observation):number[]{
 const g=o.objective,t=o.attitude;
 return [...observationFeatures(o),Math.min(g?.distance??2000,2000),Math.sin(g?.bearing??0),Math.cos(g?.bearing??0),g?.heightAbove??0,t?.roll??0,t?.pitch??0,t?.verticalSpeed??0];
}
/** Fixed situation encoding shared by training and inference for advisory models. */
export function observationFeatures(o:Observation):number[]{
 const d=o.nearestObstacle?.distance,b=o.nearestObstacle?.bearing??0;
 return [o.altitude,o.speed,Math.sin(o.heading),Math.cos(o.heading),Math.min(d??1000,1000),Math.sin(b),Math.cos(b),Math.max(0,PHASES.indexOf(o.objectivePhase))];
}
export interface BestPracticeAdvisor{readonly source:string;predict(features:readonly number[]):Promise<readonly {action:PilotIntent;probability:number}[]>}
export type Arbitration=NonNullable<DecisionEvidence["arbitration"]>;
/** Chooses the final intent from the provider distribution and (optionally) the advisor's P(success) per action. */
export type Arbiter=(provider:readonly {intent:PilotIntent;probability:number}[],advisor:readonly {action:PilotIntent;probability:number}[]|undefined)=>Arbitration;
export interface PilotAdvisors{bestPractice?:BestPracticeAdvisor;worldModel?:WorldModel;timeoutMs?:number;horizonsSeconds?:readonly number[];arbiter?:Arbiter;features?:(o:Observation)=>number[]}
/**
 * Blend provider and advisor: score = (1-w)·P_provider + w·P_advisor(success). `sample` draws from the blended scores
 * sharpened by `temperature` using the supplied deterministic random source; `argmax` takes the best.
 */
export function blendArbiter(weight:number,selection:"argmax"|"sample"="argmax",temperature=.15,random:()=>number=()=>.5):Arbiter{
 const w=Math.max(0,Math.min(1,weight));
 return (provider,advisor)=>{
  const adv=new Map(advisor?.map(a=>[a.action,a.probability])??[]);const useAdv=advisor!==undefined&&advisor.length>0;
  const scores=provider.map(c=>{const a=adv.get(c.intent);return {intent:c.intent,provider:c.probability,...(a!==undefined?{advisor:a}:{}),blended:useAdv&&a!==undefined?(1-w)*c.probability+w*a:c.probability}});
  const providerTop=[...provider].sort((a,b)=>b.probability-a.probability)[0]?.intent??"HOLD";
  const blendedTop=[...scores].sort((a,b)=>b.blended-a.blended)[0]?.intent??providerTop;let chosen=blendedTop;
  if(selection==="sample"&&scores.length){const t=Math.max(.01,temperature),ws=scores.map(s=>Math.exp(s.blended/t)),z=ws.reduce((x,y)=>x+y,0);let u=random()*z;for(let i=0;i<scores.length;i++){u-=ws[i]!;if(u<=0){chosen=scores[i]!.intent;break}}}
  return {advisorWeight:useAdv?w:0,selection,scores,providerTop,chosen,changedByAdvisor:useAdv&&w>0&&blendedTop!==providerTop,explored:chosen!==blendedTop};
 };
}
export interface PilotDecision{intent:PilotIntent;probability:number;decisionId:string;disagreement:number;evidence:DecisionEvidence}

async function advise<T>(source:string,timeoutMs:number,run:()=>Promise<T>):Promise<AdvisorEvidence<T>>{
 const t0=performance.now();let timer:ReturnType<typeof setTimeout>|undefined;
 const ms=()=>Math.round((performance.now()-t0)*100)/100;
 try{
  const result=await Promise.race([run(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AdvisorTimeout()),timeoutMs)})]);
  return {status:"OK",source,latencyMs:ms(),result};
 }catch(e){return {status:e instanceof AdvisorTimeout?"TIMEOUT":"ERROR",source,latencyMs:ms(),detail:e instanceof AdvisorTimeout?`no answer within ${timeoutMs}ms`:e instanceof Error?e.message:String(e)}}
 finally{clearTimeout(timer)}
}
class AdvisorTimeout extends Error{}

export class CognitivePilot {
 readonly memory=new RingBuffer<DecisionFrame>(256);
 #seq=0;
 #fingerprints=new Map<string,string>();
 constructor(
  readonly engines:DecisionEngineManager,
  readonly temporal:TemporalStrategy,
  readonly experience:ExperienceRepository,
  readonly advisors:PilotAdvisors={}
 ){}
 async decide(observation:Observation):Promise<PilotDecision>{
  const temporal=this.temporal.summarize(this.memory.snapshot());
  const fingerprint=situationFingerprint(observation);
  const experiences=await this.experience.retrieve(fingerprint,5);
  const decisionId=`d-${++this.#seq}`;this.#fingerprints.set(decisionId,fingerprint);if(this.#fingerprints.size>1024)this.#fingerprints.delete(this.#fingerprints.keys().next().value!);
  const features=(this.advisors.features??observationFeatures)(observation),timeoutMs=this.advisors.timeoutMs??100;
  const {bestPractice,worldModel}=this.advisors;
  const [result,bp,wm]=await Promise.all([
   this.engines.decide({
    id:decisionId,
    context:{schemaVersion:1,observation,temporal:{recentActions:temporal.recentActions}},
    question:`Choose the safest useful maneuver. Similar experience: ${JSON.stringify(experiences)}`,
    candidates:CANDIDATES,timeoutMs:250
   }),
   bestPractice?advise(bestPractice.source,timeoutMs,async()=>[...await bestPractice.predict(features)]):undefined,
   worldModel?advise(worldModel.id,timeoutMs,async()=>(await worldModel.imagine({values:features},CANDIDATES,this.advisors.horizonsSeconds??[1,3])).map(p=>({action:p.action,horizonSeconds:p.horizonSeconds,predictedRisk:p.predictedRisk,uncertainty:p.uncertainty,predictedReward:p.predictedReward.survival+p.predictedReward.separation+p.predictedReward.objective+p.predictedReward.stability+p.predictedReward.efficiency}))):undefined
  ]);
  const disagreement=disagreementScore(result);
  const providerDist=[...result.primary.candidates].sort((a,b)=>b.probability-a.probability).map(c=>({intent:c.value,probability:c.probability}));
  const arbitration=this.advisors.arbiter?.(providerDist,bp?.status==="OK"?bp.result:undefined);
  const top=arbitration?{value:arbitration.chosen,probability:providerDist.find(c=>c.intent===arbitration.chosen)?.probability??0}:topCandidate(result.primary);
  const evidence:DecisionEvidence={
   model:result.primary.engine.model,
   candidates:providerDist,
   temporalStrategy:temporal.strategy,
   temporalPatterns:[
    ...(temporal.recentActions.length?[`recent: ${temporal.recentActions.join(" → ")}`]:[]),
    ...(temporal.effectiveActions.length?[`worked before: ${temporal.effectiveActions.join(", ")}`]:[]),
    ...(temporal.ineffectiveActions.length?[`did not work: ${temporal.ineffectiveActions.join(", ")}`]:[])
   ],
   fingerprint,
   retrievedExperienceIds:experiences.map(x=>`${x.fingerprint}|${x.action}|${x.successes}/${x.occurrences}`),
   providerDisagreement:disagreement,
   shadows:result.shadows.map((s,i)=>{const id=this.engines.shadows[i]!.identity;if(s.status==="rejected")return {provider:id.provider,model:id.model,error:s.reason instanceof Error?s.reason.message:String(s.reason)};const t=topCandidate(s.value);return {provider:id.provider,model:id.model,top:t?.value,probability:t?.probability}}),
   ...(bp?{bestPractice:bp}:{}),...(wm?{worldModel:wm}:{}),...(arbitration?{arbitration}:{})
  };
  return {intent:(top?.value??"HOLD"),probability:top?.probability??0,decisionId,disagreement,evidence};
 }
 remember(frame:DecisionFrame){this.memory.push(frame);}
 /**
  * Attaches a measured outcome to the remembered frame (feeds outcome-aware temporal strategies) and, once the
  * final horizon is known, stores the decision in the experience repository so later similar situations retrieve it.
  */
 async recordOutcome(decisionId:string,horizon:"IMMEDIATE"|"1S"|"3S",reward:RewardVector):Promise<void>{
  const key:keyof DecisionOutcome=horizon==="IMMEDIATE"?"immediate":horizon==="1S"?"after1s":"after3s";
  let updated:DecisionFrame|undefined;
  this.memory.update(f=>f.id===decisionId,f=>(updated={...f,outcome:{...f.outcome,[key]:reward}}));
  const fingerprint=this.#fingerprints.get(decisionId);
  if(horizon==="3S"&&updated&&fingerprint){this.#fingerprints.delete(decisionId);await this.experience.add(updated,fingerprint)}
 }
}
