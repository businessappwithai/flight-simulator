import type {CopilotAdvice,CopilotStatus,DecisionFrame,LearningBook,Observation,PilotIntent,Tick} from "@flight/protocol";
import {CognitivePilot,NoMemoryStrategy,observationFeatures,DEFAULT_MIN_PROVIDER_CONFIDENCE} from "@flight/cognition";
import {DecisionEngineManager} from "@flight/decision-core";
import {JevDecisionEngine,TypeSafeJevTransport,type JevTransport} from "@flight/decision-jev";
import type {XGBoostBestPracticeClient} from "@flight/experience/xgboost-client";
import type {ExperienceRepository} from "@flight/experience";
import {trainingExamples} from "@flight/learning";
/** One recommendation per simulated second; after a Jev failure, wait ten before asking again. */
export const ADVICE_EVERY_TICKS=120n,ERROR_BACKOFF_TICKS=1200n,MIN_TRAINING_EXAMPLES=20,JEV_TIMEOUT_MS=4000,TRAINING_ROUNDS=60;
const noExperience:ExperienceRepository={add:async()=>{},retrieve:async()=>[]};
export interface CopilotOptions{
 /** Builds the Jev transport for a key (default: TypeSafe SDK, browser use allowed: the key is the user's own). */
 transport?:(apiKey:string)=>JevTransport;
 /** Builds the XGBoost best-practice client, lazily, the first time there is enough to train on. */
 xgboost:()=>Pick<XGBoostBestPracticeClient,"train"|"predict"|"dispose">;
 minProviderConfidence?:number;
}
const message=(e:unknown)=>e instanceof Error?`${e.name&&e.name!=="Error"?`${e.name}: `:""}${e.message}`:String(e);
/**
 * The copilot rides along while the autopilot flies: it asks Jev for a pilot intent (CognitivePilot), and when
 * Jev's confidence is below the threshold the XGBoost best-practice model, trained on this browser's finished
 * flights, decides instead. It only advises: the autopilot keeps flying, so flights stay deterministic.
 * Requests run in the background and never hold up the simulation.
 */
export class Copilot{
 #pilot?:CognitivePilot;#pending=false;#next:Tick=0n;#generation=0;
 #xgb?:Pick<XGBoostBestPracticeClient,"train"|"predict"|"dispose">;#version?:string;#models=0;#book?:LearningBook;#training=false;#again=false;
 #status:CopilotStatus={jev:"OFF",xgboost:{examples:0,trained:false}};
 constructor(readonly options:CopilotOptions){}
 get enabled(){return !!this.#pilot}
 get status():CopilotStatus{return this.#status}
 get threshold(){return this.options.minProviderConfidence??DEFAULT_MIN_PROVIDER_CONFIDENCE}
 setKey(apiKey:string|null){
  this.#generation++;this.#pending=false;this.#next=0n;
  if(!apiKey){this.#pilot=undefined;this.#status={jev:"OFF",xgboost:this.#status.xgboost};return}
  const transport=(this.options.transport??(k=>new TypeSafeJevTransport({apiKey:k,browser:true})))(apiKey);
  const self=this;
  this.#pilot=new CognitivePilot(new DecisionEngineManager(new JevDecisionEngine(transport)),new NoMemoryStrategy(),noExperience,{
   bestPractice:{get source(){return `xgboost:${self.#version??"untrained"}`},predict:f=>this.#predict(f)},
   timeoutMs:1500,decisionTimeoutMs:JEV_TIMEOUT_MS,minProviderConfidence:this.threshold});
  this.#status={...this.#status,jev:"READY",detail:"waiting for the first recommendation"};
  if(this.#book)this.learnFrom(this.#book);
 }
 /** A new flight: the next step asks straight away. */
 reset(){this.#next=0n;this.#generation++;this.#pending=false}
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
 /** Called from the simulation step; never awaited. `onAdvice` gets the recommendation and its trace frame. */
 advise(tick:Tick,observation:Observation,flown:PilotIntent,onAdvice:(advice:CopilotAdvice,frame:DecisionFrame)=>void){
  const pilot=this.#pilot;if(!pilot||this.#pending||tick<this.#next)return;
  this.#pending=true;this.#next=tick+ADVICE_EVERY_TICKS;
  const generation=this.#generation,t0=performance.now(),current=()=>generation===this.#generation;
  const deliver=(a:Omit<CopilotAdvice,"tick"|"flown"|"latencyMs">,frame:Omit<DecisionFrame,"id"|"startTick"|"executedIntent">)=>{
   if(!current())return;const latencyMs=Math.round(performance.now()-t0);
   onAdvice({...a,tick:String(tick),flown,latencyMs},{...frame,id:`copilot:${tick}`,startTick:tick,executedIntent:flown})};
  pilot.decide(observation).then(d=>{
   if(!current())return;const s=d.evidence.selection;
   this.#status={...this.#status,jev:"READY",model:d.evidence.model,detail:undefined};
   deliver({intent:d.intent,source:s?.source==="BEST_PRACTICE"?"BEST_PRACTICE":"JEV",provider:d.provider,confidence:d.probability,jevConfidence:s?.providerConfidence,reason:s?.reason??""},
    {requestedIntent:d.intent,provider:d.provider,probability:d.probability,evidence:d.evidence});
  }).catch(async e=>{
   if(!current())return;const why=message(e);
   this.#status={...this.#status,jev:"ERROR",detail:why};this.#next=tick+ERROR_BACKOFF_TICKS;
   // Jev could not answer at all: a model that has learned still advises.
   if(!this.#xgb||!this.#version)return;
   try{const ranked=await this.#xgb.predict(observationFeatures(observation)),top=ranked[0];if(!top)return;
    const provider=`xgboost:${this.#version}`,reason=`Jev could not be reached (${why}), so the best-practice model (${provider}) decided: ${top.action} at ${Math.round(top.probability*1000)/10}% estimated success.`;
    deliver({intent:top.action,source:"BEST_PRACTICE",provider,confidence:top.probability,reason},
     {requestedIntent:top.action,provider,probability:top.probability,evidence:{model:this.#version,candidates:ranked.map(x=>({intent:x.action,probability:x.probability})),temporalStrategy:"NONE",temporalPatterns:[],fingerprint:"",retrievedExperienceIds:[],providerDisagreement:0,shadows:[],
      selection:{source:"BEST_PRACTICE",providerConfidence:0,threshold:this.threshold,reason}}});
   }catch{/* no advice this time */}
  }).finally(()=>{if(current())this.#pending=false});
 }
 dispose(){this.#xgb?.dispose();this.#xgb=undefined}
}
