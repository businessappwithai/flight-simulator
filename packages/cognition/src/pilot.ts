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
/** Fixed situation encoding shared by training and inference for advisory models. */
export function observationFeatures(o:Observation):number[]{
 const d=o.nearestObstacle?.distance,b=o.nearestObstacle?.bearing??0;
 return [o.altitude,o.speed,Math.sin(o.heading),Math.cos(o.heading),Math.min(d??1000,1000),Math.sin(b),Math.cos(b),Math.max(0,PHASES.indexOf(o.objectivePhase))];
}
export interface BestPracticeAdvisor{readonly source:string;predict(features:readonly number[]):Promise<readonly {action:PilotIntent;probability:number}[]>}
export interface PilotAdvisors{bestPractice?:BestPracticeAdvisor;worldModel?:WorldModel;timeoutMs?:number;horizonsSeconds?:readonly number[]}
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
  const features=observationFeatures(observation),timeoutMs=this.advisors.timeoutMs??100;
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
  const top=topCandidate(result.primary);
  const disagreement=disagreementScore(result);
  const evidence:DecisionEvidence={
   model:result.primary.engine.model,
   candidates:[...result.primary.candidates].sort((a,b)=>b.probability-a.probability).map(c=>({intent:c.value,probability:c.probability})),
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
   ...(bp?{bestPractice:bp}:{}),...(wm?{worldModel:wm}:{})
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
