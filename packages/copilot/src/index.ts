import type {CopilotAdvice,CopilotStatus,DecisionFrame,LearningBook,Observation,PilotIntent,Tick} from "@flight/protocol";
import {CognitivePilot,NoMemoryStrategy,observationFeaturesV2,DEFAULT_MIN_PROVIDER_CONFIDENCE} from "@flight/cognition";
import {DecisionEngineManager} from "@flight/decision-core";
import {JevDecisionEngine,TypeSafeJevTransport,type JevTransport} from "@flight/decision-jev";
import type {XGBoostBestPracticeClient} from "@flight/experience/xgboost-client";
import type {ExperienceRepository} from "@flight/experience";
import {trainingExamples} from "@flight/learning";
/** One recommendation per simulated second; after a Jev failure, ten simulated seconds before Jev is asked again. */
export const ADVICE_EVERY_TICKS=120n,ERROR_BACKOFF_TICKS=1200n,MIN_TRAINING_EXAMPLES=20,JEV_TIMEOUT_MS=4000,TRAINING_ROUNDS=60;
const noExperience:ExperienceRepository={add:async()=>{},retrieve:async()=>[]};
export interface CopilotOptions{
 /** Builds the Jev transport for a key (default: TypeSafe SDK, browser use allowed: the key is the user's own). */
 transport?:(apiKey:string,baseUrl?:string)=>JevTransport;
 /** Builds the XGBoost best-practice client, lazily, the first time there is enough to train on. */
 xgboost:()=>Pick<XGBoostBestPracticeClient,"train"|"predict"|"dispose">;
 minProviderConfidence?:number;
}
// Class names are mangled in minified browser builds, so describe errors by HTTP status and message only.
const message=(e:unknown)=>{if(!(e instanceof Error))return String(e);const status=(e as {status?:unknown}).status;return typeof status==="number"?`HTTP ${status}: ${e.message}`:e.message};
/** Features the best-practice model learns from and predicts on: situation, objective geometry and attitude. */
export const copilotFeatures=observationFeaturesV2;
/**
 * What Jev is asked. The mission and the meaning of the observation's fields, not how to fly: the choice is Jev's
 * (and, when Jev is not confident, the model learned from this browser's finished flights).
 */
export const MISSION_QUESTION="You are flying a light aircraft. Choose the next maneuver that brings it safely to its objective and lands it there. "+
 "state.observation.objective.distance is metres to the objective (a gate while objectivePhase is OUTBOUND, else the runway to land on); "+
 "objective.bearing is the direction to fly relative to the nose in radians (positive: to the right); objective.heightAbove is metres above the objective, "+
 "or on a flight to another airport metres above the planned path (a 3° approach at the end; positive: too high), whose bearing leads onto the runway "+
 "centreline. altitude and speed are metres and metres per second; grounded says the wheels are on the ground; attitude gives pitch, roll (radians) "+
 "and vertical speed (m/s). A turn changes the heading about 20° a second. A touchdown must be gentle (sink under 8 m/s), wings level, on the runway; "+
 "on the ground SLOW idles the engine to roll to a stop.";
/** One decision for the autopilot to fly, with where it came from. */
export interface CopilotDecision{advice:Omit<CopilotAdvice,"tick"|"flown"|"latencyMs">;frame:Omit<DecisionFrame,"id"|"startTick"|"executedIntent">}
/**
 * Decisions from Jev and learning. It asks Jev for a pilot intent (CognitivePilot), and when Jev's confidence is below
 * the threshold, or Jev cannot be reached, the XGBoost best-practice model trained on this browser's finished flights
 * decides instead. The autopilot flies these decisions (`decide`, awaited: the simulator holds its clock meanwhile, so
 * a flight is reproducible from its recorded decisions); while a person flies it only advises (`advise`).
 */
export class Copilot{
 #pilot?:CognitivePilot;#pending=false;#next:Tick=0n;#generation=0;#jevDownUntil:Tick=-1n;
 #xgb?:Pick<XGBoostBestPracticeClient,"train"|"predict"|"dispose">;#version?:string;#models=0;#book?:LearningBook;#training=false;#again=false;
 #status:CopilotStatus={jev:"OFF",xgboost:{examples:0,trained:false}};
 constructor(readonly options:CopilotOptions){}
 get enabled(){return !!this.#pilot}
 get status():CopilotStatus{return this.#status}
 get threshold(){return this.options.minProviderConfidence??DEFAULT_MIN_PROVIDER_CONFIDENCE}
 /** `baseUrl`: a self-hosted Jev (TypeSafe API) instead of the default endpoint. */
 setKey(apiKey:string|null,baseUrl?:string){
  this.#generation++;this.#pending=false;this.#next=0n;this.#jevDownUntil=-1n;
  if(!apiKey){this.#pilot=undefined;this.#status={jev:"OFF",xgboost:this.#status.xgboost};return}
  const transport=(this.options.transport??((k,u)=>new TypeSafeJevTransport({apiKey:k,browser:true,...(u?{baseURL:u}:{})})))(apiKey,baseUrl);
  const self=this;
  this.#pilot=new CognitivePilot(new DecisionEngineManager(new JevDecisionEngine(transport)),new NoMemoryStrategy(),noExperience,{
   bestPractice:{get source(){return `xgboost:${self.#version??"untrained"}`},predict:f=>this.#predict(f)},
   timeoutMs:1500,decisionTimeoutMs:JEV_TIMEOUT_MS,minProviderConfidence:this.threshold,features:copilotFeatures,question:MISSION_QUESTION});
  this.#status={...this.#status,jev:"READY",detail:"waiting for the first recommendation"};
  if(this.#book)this.learnFrom(this.#book);
 }
 /** A new flight: the next step asks straight away. */
 reset(){this.#next=0n;this.#generation++;this.#pending=false;this.#jevDownUntil=-1n}
 async #predict(features:readonly number[]){
  if(!this.#xgb||!this.#version)throw new Error(this.#status.xgboost.detail??"not trained yet");
  return this.#xgb.predict(features);
 }
 /** (Re)trains the XGBoost model on the book's examples, one training at a time. */
 learnFrom(book:LearningBook){
  this.#book=book;const n=book.examples?.length??0;this.#status={...this.#status,xgboost:{...this.#status.xgboost,examples:n}};
  if(!this.#pilot)return;
  if(n<MIN_TRAINING_EXAMPLES){this.#status={...this.#status,xgboost:{...this.#status.xgboost,detail:`needs ${MIN_TRAINING_EXAMPLES} examples from finished flights (has ${n})`}};return}
  if(this.#training){this.#again=true;return}
  void this.#train();
 }
 async #train(){
  this.#training=true;
  try{
   do{this.#again=false;const book=this.#book!,examples=trainingExamples(book),version=`bp-${++this.#models}`;
    this.#xgb??=this.options.xgboost();
    await this.#xgb.train(version,examples,TRAINING_ROUNDS);
    this.#version=version;this.#status={...this.#status,xgboost:{examples:examples.length,trained:true,version}};
   }while(this.#again);
  }catch(e){this.#status={...this.#status,xgboost:{...this.#status.xgboost,detail:`training failed: ${message(e)}`}}}
  finally{this.#training=false}
 }
 /**
  * One decision: Jev (with the learned model taking over when Jev is not confident), or, when Jev cannot answer, the
  * learned model alone. After a Jev failure Jev is not asked again for ERROR_BACKOFF_TICKS. Rejects when nobody can
  * decide (no key, or Jev unreachable and nothing learned yet): there is no built-in fallback pilot.
  */
 async decide(tick:Tick,observation:Observation):Promise<CopilotDecision>{
  const pilot=this.#pilot;if(!pilot)throw new Error("no Jev key");
  const generation=this.#generation;
  let why:string|undefined;
  if(tick>=this.#jevDownUntil)try{
   const d=await pilot.decide(observation),s=d.evidence.selection;
   if(generation===this.#generation)this.#status={...this.#status,jev:"READY",model:d.evidence.model,detail:undefined};
   return {advice:{intent:d.intent,source:s?.source==="BEST_PRACTICE"?"BEST_PRACTICE":"JEV",provider:d.provider,confidence:d.probability,jevConfidence:s?.providerConfidence,reason:s?.reason??""},
    frame:{requestedIntent:d.intent,provider:d.provider,probability:d.probability,evidence:d.evidence}};
  }catch(e){why=message(e);if(generation===this.#generation){this.#status={...this.#status,jev:"ERROR",detail:why};this.#jevDownUntil=tick+ERROR_BACKOFF_TICKS}}
  else why=this.#status.detail??"unavailable";
  // Jev could not answer: a model that has learned still decides.
  if(!this.#xgb||!this.#version)throw new Error(`Jev could not be reached (${why}) and nothing has been learned yet (${this.#status.xgboost.detail??"no model"})`);
  const ranked=await this.#xgb.predict(copilotFeatures(observation)),top=ranked[0];if(!top)throw new Error(`Jev could not be reached (${why}) and the learned model had no answer`);
  const provider=`xgboost:${this.#version}`,reason=`Jev could not be reached (${why}), so the best-practice model (${provider}) decided: ${top.action} at ${Math.round(top.probability*1000)/10}% estimated success.`;
  return {advice:{intent:top.action,source:"BEST_PRACTICE",provider,confidence:top.probability,reason},
   frame:{requestedIntent:top.action,provider,probability:top.probability,evidence:{model:this.#version,candidates:ranked.map(x=>({intent:x.action,probability:x.probability})),temporalStrategy:"NONE",temporalPatterns:[],fingerprint:"",retrievedExperienceIds:[],providerDisagreement:0,shadows:[],
    selection:{source:"BEST_PRACTICE",providerConfidence:0,threshold:this.threshold,reason}}}};
 }
 /** Advice while someone else flies: called from the simulation step, never awaited. `onAdvice` gets the recommendation and its trace frame. */
 advise(tick:Tick,observation:Observation,flown:PilotIntent,onAdvice:(advice:CopilotAdvice,frame:DecisionFrame)=>void){
  if(!this.#pilot||this.#pending||tick<this.#next)return;
  this.#pending=true;this.#next=tick+ADVICE_EVERY_TICKS;
  const generation=this.#generation,t0=performance.now(),current=()=>generation===this.#generation;
  this.decide(tick,observation).then(({advice,frame})=>{
   if(!current())return;const latencyMs=Math.round(performance.now()-t0);
   onAdvice({...advice,tick:String(tick),flown,latencyMs},{...frame,id:`copilot:${tick}`,startTick:tick,executedIntent:flown});
  },()=>{/* no advice this time */}).finally(()=>{if(current())this.#pending=false});
 }
 dispose(){this.#xgb?.dispose();this.#xgb=undefined}
}
