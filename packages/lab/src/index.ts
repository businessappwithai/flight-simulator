import type {LabConfig,LabDecision,LabEpisodeDetail,LabEpisodeSummary,LabEvaluation,LabEvent,LabGenerationSummary,LabMetrics,LabTrackPoint,PilotIntent,WorldSnapshot} from "@flight/protocol";
import {DecisionEngineManager,OpenJevDecisionEngine,ResilientDecisionEngine,RuleBasedDecisionEngine,type DecisionEngine} from "@flight/decision-core";
import {CognitivePilot,OutcomeAwareStrategy,blendArbiter,observationFeaturesV2,OBSERVATION_FEATURES_V2} from "@flight/cognition";
import {ACTIONS,InMemoryExperienceRepository,OutcomeModel,explainPrediction,outcomeRow,type BestPracticeExample,type XgbModelJson} from "@flight/experience";
import {ObservableFlightRuntime} from "@flight/runtime";
import {defaultScenario,scenarioForSeed} from "@flight/simulation";
import {PerfectSensorSuite} from "@flight/sensors";
export const LAB_FEATURE_NAMES:readonly string[]=[...OBSERVATION_FEATURES_V2,...ACTIONS.map(a=>`action=${a}`)];
export const DEFAULT_LAB_CONFIG:LabConfig={generations:8,episodesPerGeneration:6,maxSeconds:70,scenario:"seeded",seed:1,decisionIntervalTicks:30,
 provider:{kind:"local-rules",temperature:.6},advisor:{weight:.6,schedule:"fixed",selection:"sample",explorationTemperature:.12},
 model:{maxDepth:4,rounds:60,eta:.2,minChildWeight:1,subsample:.9,colsample:.9,lambda:1},bufferSize:20000,horizon:"1S"};
/** Navigation cost toward the current objective; a decision is good if it lowers it (and nothing bad happened). */
export function navigationCost(o:{objective?:{distance:number;bearing:number;heightAbove:number}}){const g=o.objective;return g?g.distance+150*Math.abs(g.bearing)+2*Math.abs(g.heightAbove):0}
const clampN=(x:unknown,a:number,b:number,d:number)=>{const n=Number(x);return Number.isFinite(n)?Math.max(a,Math.min(b,n)):d};
export function validateLabConfig(c:Partial<LabConfig>={}):LabConfig{
 const d=DEFAULT_LAB_CONFIG,p={...d.provider,...c.provider},a={...d.advisor,...c.advisor},m={...d.model,...c.model};
 return {generations:Math.round(clampN(c.generations,1,50,d.generations)),episodesPerGeneration:Math.round(clampN(c.episodesPerGeneration,1,50,d.episodesPerGeneration)),
  maxSeconds:clampN(c.maxSeconds,10,300,d.maxSeconds),scenario:c.scenario==="default"?"default":"seeded",seed:Math.round(clampN(c.seed,0,1e9,d.seed)),decisionIntervalTicks:Math.round(clampN(c.decisionIntervalTicks,6,240,d.decisionIntervalTicks)),
  provider:{kind:p.kind==="open-jev"?"open-jev":"local-rules",temperature:clampN(p.temperature,.02,5,d.provider.temperature),...(p.endpoint?{endpoint:String(p.endpoint)}:{}),...(p.model?{model:String(p.model)}:{})},
  advisor:{weight:clampN(a.weight,0,1,d.advisor.weight),schedule:a.schedule==="ramp"?"ramp":"fixed",selection:a.selection==="argmax"?"argmax":"sample",explorationTemperature:clampN(a.explorationTemperature,.01,2,d.advisor.explorationTemperature)},
  model:{maxDepth:Math.round(clampN(m.maxDepth,1,12,4)),rounds:Math.round(clampN(m.rounds,1,500,60)),eta:clampN(m.eta,.01,1,.2),minChildWeight:clampN(m.minChildWeight,0,50,1),subsample:clampN(m.subsample,.3,1,.9),colsample:clampN(m.colsample,.3,1,.9),lambda:clampN(m.lambda,0,50,1)},
  bufferSize:Math.round(clampN(c.bufferSize,100,200000,d.bufferSize)),horizon:c.horizon==="3S"?"3S":"1S"};
}
function mulberry32(seed:number){let a=seed>>>0;return()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
const mean=(xs:readonly number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const rate=(xs:readonly boolean[])=>xs.length?xs.filter(Boolean).length/xs.length:0;
export function advisorWeightFor(c:LabConfig,generation:number){if(generation===0)return 0;return c.advisor.schedule==="ramp"&&c.generations>1?c.advisor.weight*Math.min(1,generation/(c.generations-1)):c.advisor.weight}
interface Episode{detail:LabEpisodeDetail;examples:BestPracticeExample[]}
/**
 * Runs the learning loop: fly N episodes → label every decision from its measured outcome → score the current model on
 * those unseen decisions → retrain XGBoost with the configured parameters → next generation flies with the new model.
 */
export class LearningLab{
 #stop=false;#episodes=new Map<string,Episode>();#models=new Map<number,XgbModelJson>();#model?:OutcomeModel;#latest=-1;#config=DEFAULT_LAB_CONFIG;
 constructor(readonly emit:(e:LabEvent)=>void){}
 stop(){this.#stop=true}
 async run(input:Partial<LabConfig>):Promise<LabGenerationSummary[]>{
  const c=validateLabConfig(input);this.#config=c;this.#stop=false;this.#episodes.clear();this.#models.clear();this.#latest=-1;this.#model?.dispose();this.#model=await OutcomeModel.create();
  this.emit({type:"STARTED",config:c,featureNames:LAB_FEATURE_NAMES});
  const buffer:BestPracticeExample[]=[],experience=new InMemoryExperienceRepository(),out:LabGenerationSummary[]=[];
  for(let g=0;g<c.generations&&!this.#stop;g++){
   const weight=advisorWeightFor(c,g),modelFrom=this.#latest>=0?this.#latest:null,rng=mulberry32(c.seed*7919+g*104729+1),episodes:LabEpisodeSummary[]=[],genExamples:BestPracticeExample[]=[];
   for(let e=0;e<c.episodesPerGeneration&&!this.#stop;e++){
    this.emit({type:"PROGRESS",generation:g,episode:e,generations:c.generations,episodes:c.episodesPerGeneration,phase:"flying"});
    const ep=await this.#fly(c,g,e,weight,modelFrom,rng,experience);this.#episodes.set(`${g}:${e}`,ep);episodes.push(ep.detail.summary);genExamples.push(...ep.examples);
    await new Promise(r=>setTimeout(r,0)); // let STOP / EPISODE / EXPLAIN commands through
   }
   if(!episodes.length)break;
   const summary:LabGenerationSummary={generation:g,advisorWeight:weight,modelFrom,episodes,metrics:metricsOf(episodes,[...this.#episodes.values()].filter(x=>x.detail.generation===g))};
   if(this.#model.ready&&genExamples.length)summary.holdout=this.#model.evaluate(genExamples) as LabEvaluation;
   buffer.push(...genExamples);if(buffer.length>c.bufferSize)buffer.splice(0,buffer.length-c.bufferSize);
   if(buffer.length&&!this.#stop){
    this.emit({type:"PROGRESS",generation:g,episode:c.episodesPerGeneration,generations:c.generations,episodes:c.episodesPerGeneration,phase:"training"});
    const t0=performance.now(),info=this.#model.train(buffer,{...c.model,seed:c.seed}),ms=performance.now()-t0;
    const imp=this.#model.importance().map((x,i)=>({name:LAB_FEATURE_NAMES[i]??`f${i}`,gain:x.gain,splits:x.splits})).sort((a,b)=>b.gain-a.gain);
    this.#models.set(g,this.#model.toJSON());this.#latest=g;
    summary.training={rows:info.rows,positives:info.positives,trainEval:this.#model.evaluate(buffer) as LabEvaluation,params:c.model,trees:this.#model.treeCount,maxDepthReached:Math.max(0,...this.#model.depths()),importance:imp,ms};
   }
   out.push(summary);this.emit({type:"GENERATION",summary});
  }
  this.emit({type:"DONE",stopped:this.#stop});return out;
 }
 episode(generation:number,episode:number){const ep=this.#episodes.get(`${generation}:${episode}`);if(!ep)throw new Error(`no episode ${generation}:${episode}`);return ep.detail}
 /** Trace a decision with the model that was flying at the time ("then") or the most recent model ("latest"). */
 explain(generation:number,episode:number,decisionId:string,action:PilotIntent,which:"then"|"latest"){
  const d=this.episode(generation,episode).decisions.find(x=>x.id===decisionId);if(!d)throw new Error(`no decision ${decisionId}`);
  const from=which==="latest"?this.#latest:generation-1;const json=this.#models.get(from);if(!json)throw new Error(which==="latest"?"no model trained yet":`no model was flying in generation ${generation} (generation 0 flies without one)`);
  const row=outcomeRow(d.features,action),tr=explainPrediction(json,row);
  return {generation,episode,decisionId,action,modelFrom:from,baseMargin:tr.baseMargin,margin:tr.margin,probability:tr.probability,
   contributions:tr.contributions.map((value,i)=>({name:LAB_FEATURE_NAMES[i]??`f${i}`,value,input:row[i]??NaN})).filter(x=>x.value!==0).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)),
   trees:tr.trees.map(t=>({tree:t.tree,leafValue:t.leafValue,contribution:t.contribution,steps:t.steps.map(s=>({feature:LAB_FEATURE_NAMES[s.feature]??`f${s.feature}`,threshold:s.threshold,value:s.value,wentLeft:s.wentLeft,missing:s.missing,delta:s.delta}))})),
   maxDepth:Math.max(0,...tr.trees.map(t=>t.steps.length))};
 }
 async #fly(c:LabConfig,g:number,e:number,weight:number,modelFrom:number|null,rng:()=>number,experience:InMemoryExperienceRepository):Promise<Episode>{
  const seed=c.seed+e,scenario=c.scenario==="seeded"?scenarioForSeed(BigInt(seed)):defaultScenario(BigInt(seed));
  const local=new RuleBasedDecisionEngine(c.provider.temperature);
  const provider:DecisionEngine=c.provider.kind==="open-jev"&&c.provider.endpoint?new ResilientDecisionEngine(new OpenJevDecisionEngine(c.provider.endpoint,c.provider.model??"default"),local):local;
  const model=this.#model!,advising=model.ready;
  const pilot=new CognitivePilot(new DecisionEngineManager(provider),new OutcomeAwareStrategy(),experience,{
   timeoutMs:2000,features:observationFeaturesV2,
   ...(advising?{bestPractice:{source:`xgb-gen${modelFrom}`,predict:async f=>model.predictActions(f)}}:{}),
   arbiter:blendArbiter(weight,c.advisor.selection,c.advisor.explorationTemperature,rng)});
  const rt=new ObservableFlightRuntime(pilot,c.decisionIntervalTicks),sensors=new PerfectSensorSuite();
  const track:LabTrackPoint[]=[],obstacleTrack:{t:number;x:number;y:number;z:number}[]=[],decisions:LabDecision[]=[],meta=new Map<string,{cost0:number;phase0:string;decision:LabDecision}>();
  let closestGate=Infinity,rewardSum=0,rewardN=0;
  const world=()=>rt.sim.snapshot() as unknown as WorldSnapshot;
  rt.events.subscribe(ev=>{
   if(ev.type==="DECISION"){const w=world(),o=sensors.observe(w),f=ev.frame,x=f.evidence,a=x?.arbitration;
    const d:LabDecision={id:f.id,t:Number(w.tick)/120,x:w.aircraft.position.x,y:w.aircraft.position.y,z:w.aircraft.position.z,requested:f.requestedIntent,executed:f.executedIntent,
     provider:x?.candidates??[],...(x?.bestPractice?.status==="OK"?{advisor:x.bestPractice.result}:{}),...(a?{blended:a.scores.map(s=>({intent:s.intent,blended:s.blended}))}:{}),
     providerTop:a?.providerTop??f.requestedIntent,changedByAdvisor:a?.changedByAdvisor??false,explored:a?.explored??false,features:observationFeaturesV2(o),...(x?.safetyReason?{safetyReason:x.safetyReason}:{})};
    decisions.push(d);meta.set(f.id,{cost0:navigationCost(o),phase0:o.objectivePhase,decision:d})}
   if(ev.type==="SAFETY_OVERRIDE"){const m=meta.get(ev.decisionId);if(m){m.decision.safetyReason=ev.reason;m.decision.executed=ev.executed as PilotIntent}}
   if(ev.type==="OUTCOME"&&ev.horizon===c.horizon){const m=meta.get(ev.decisionId);if(!m)return;const o=sensors.observe(world()),r=ev.reward;
    const progress=o.objectivePhase!==m.phase0?1000:m.cost0-navigationCost(o);const reward=r.survival+r.separation+r.objective+r.stability+r.efficiency;
    m.decision.progress=progress;m.decision.reward=reward;m.decision.label=r.survival>=1&&r.separation>0&&!m.decision.safetyReason&&progress>=0?1:0;rewardSum+=reward;rewardN++}
  });
  const r=await rt.run(scenario,Math.round(c.maxSeconds*120),w=>{const t=Number(w.tick);
   if(w.objective.phase==="OUTBOUND"){const cp=w.entities.find(x=>x.kind==="CHECKPOINT");if(cp)closestGate=Math.min(closestGate,Math.hypot(cp.position.x-w.aircraft.position.x,cp.position.y-w.aircraft.position.y,cp.position.z-w.aircraft.position.z))}
   if(t%6===0){const a=w.aircraft;track.push({t:t/120,x:a.position.x,y:a.position.y,z:a.position.z,heading:a.heading,roll:a.roll,speed:Math.hypot(a.velocity.x,a.velocity.y,a.velocity.z)})}
   if(t%30===0){const ob=w.entities.find(x=>x.kind==="OBSTACLE");if(ob)obstacleTrack.push({t:t/120,x:ob.position.x,y:ob.position.y,z:ob.position.z})}});
  const fw=r.world,crashed=fw.aircraft.crashed,ob=fw.entities.find(x=>x.kind==="OBSTACLE"),collision=crashed&&!!ob&&Math.hypot(fw.aircraft.position.x-ob.position.x,fw.aircraft.position.y-ob.position.y,fw.aircraft.position.z-ob.position.z)<=ob.radius+4;
  // Decisions whose horizon was cut short by a crash led into it: label them catastrophic. Time-outs stay unlabelled.
  const endT=Number(fw.tick)/120,horizon=c.horizon==="3S"?3:1;
  const examples:BestPracticeExample[]=[];
  for(const d of decisions){
   if(d.label===undefined&&crashed&&endT-d.t<=horizon+.01){d.label=0;d.reward=-10}
   if(d.label===undefined)continue;
   examples.push({features:d.features,action:d.requested,reward:d.reward??0,regret:d.label?0:1,success:d.label===1,safetyOverride:!!d.safetyReason,catastrophic:crashed&&endT-d.t<=horizon+.01});
  }
  const cp=scenario.checkpoint;
  const summary:LabEpisodeSummary={generation:g,episode:e,seed,scenarioId:scenario.id,phase:fw.objective.phase,gateReached:fw.objective.checkpointReached,landed:fw.objective.phase==="COMPLETE",crashed,collision,seconds:endT,
   decisions:decisions.length,overrides:decisions.filter(d=>d.safetyReason).length,advisorChanges:decisions.filter(d=>d.changedByAdvisor).length,explored:decisions.filter(d=>d.explored).length,
   goodDecisionRate:rate(decisions.filter(d=>d.label!==undefined).map(d=>d.label===1)),meanReward:rewardN?rewardSum/rewardN:0,closestGate:Number.isFinite(closestGate)?closestGate:0};
  return {examples,detail:{generation:g,episode:e,summary,scenario:{checkpoint:cp,gateRadius:20,obstacleRadius:12,runway:{x:scenario.aircraftStart.x,z:scenario.aircraftStart.z}},track,obstacleTrack,decisions}};
 }
}
function metricsOf(eps:readonly LabEpisodeSummary[],details:readonly Episode[]):LabMetrics{
 const dec=details.flatMap(d=>d.detail.decisions),labelled=dec.filter(d=>d.label!==undefined),advised=dec.filter(d=>d.advisor?.length);
 return {gateRate:rate(eps.map(e=>e.gateReached)),landRate:rate(eps.map(e=>e.landed)),crashRate:rate(eps.map(e=>e.crashed)),collisionRate:rate(eps.map(e=>e.collision)),
  overrideRate:dec.length?dec.filter(d=>d.safetyReason).length/dec.length:0,advisorChangeRate:dec.length?dec.filter(d=>d.changedByAdvisor).length/dec.length:0,
  goodDecisionRate:rate(labelled.map(d=>d.label===1)),meanReward:mean(eps.map(e=>e.meanReward)),meanSeconds:mean(eps.map(e=>e.seconds)),meanGateDistance:mean(eps.map(e=>e.closestGate)),
  advisorSpread:mean(advised.map(d=>{const p=d.advisor!.map(a=>a.probability);return Math.max(...p)-Math.min(...p)}))};
}
