import type {LabCommand,LabConfig,LabEpisodeDetail,LabEvent,LabExplanation,LabGenerationSummary,PilotIntent} from "@flight/protocol";
/** Learning Lab UI state. Owns the lab worker; React reads it via useSyncExternalStore. */
export interface LabRun{id:number;label:string;config:LabConfig;generations:LabGenerationSummary[];status:"running"|"done"|"stopped"|"error"}
export interface Selection{generation:number;episode:number;decisionId?:string;action?:PilotIntent;model:"then"|"latest"}
export interface LabView{runs:readonly LabRun[];current?:LabRun;compare:readonly number[];featureNames:readonly string[];progress?:Extract<LabEvent,{type:"PROGRESS"}>;
 selection?:Selection;episode?:LabEpisodeDetail;explanation?:LabExplanation;explaining:boolean;error?:string;version:number}
export function runLabel(c:LabConfig){return `depth ${c.model.maxDepth} · ${c.model.rounds} trees · weight ${c.advisor.weight.toFixed(2)}${c.advisor.schedule==="ramp"?" ramp":""}`}
export class LabStore{
 #worker?:Worker;#runs:LabRun[]=[];#compare:number[]=[];#featureNames:readonly string[]=[];#progress?:LabView["progress"];#selection?:Selection;
 #episodes=new Map<string,LabEpisodeDetail>();#explanations=new Map<string,LabExplanation>();#explaining=false;#error?:string;#view:LabView;#listeners=new Set<()=>void>();#scheduled=false;#nextId=1;
 constructor(readonly workerUrl=()=>new URL("./lab.worker.js",document.baseURI)){this.#view=this.#compute(0)}
 subscribe=(l:()=>void)=>{this.#listeners.add(l);return()=>{this.#listeners.delete(l)}};
 getSnapshot=()=>this.#view;
 #changed(){if(this.#scheduled)return;this.#scheduled=true;const run=()=>{this.#scheduled=false;this.#view=this.#compute(this.#view.version+1);for(const l of this.#listeners)l()};typeof requestAnimationFrame==="function"?requestAnimationFrame(run):queueMicrotask(run)}
 #compute(version:number):LabView{
  const current=this.#runs.at(-1),s=this.#selection;
  const episode=s?this.#episodes.get(`${current?.id}:${s.generation}:${s.episode}`):undefined;
  const explanation=s?.decisionId&&s.action?this.#explanations.get(`${current?.id}:${s.generation}:${s.episode}:${s.decisionId}:${s.action}:${s.model}`):undefined;
  return {runs:[...this.#runs],current,compare:[...this.#compare],featureNames:this.#featureNames,progress:this.#progress,selection:s,episode,explanation,explaining:this.#explaining&&!explanation,error:this.#error,version};
 }
 #send(c:LabCommand){this.#ensure().postMessage(c)}
 #ensure(){
  if(this.#worker)return this.#worker;
  const w=new Worker(this.workerUrl(),{type:"module"});
  w.onmessage=(m:MessageEvent<LabEvent>)=>this.#on(m.data);
  w.onerror=e=>{this.#error=`Learning Lab worker failed: ${e.message||"could not load"}`;const r=this.#runs.at(-1);if(r&&r.status==="running")r.status="error";this.#changed()};
  return this.#worker=w;
 }
 #on(e:LabEvent){
  const run=this.#runs.at(-1);
  switch(e.type){
   case "STARTED":this.#featureNames=e.featureNames;if(run)run.config=e.config;break;
   case "PROGRESS":this.#progress=e;break;
   case "GENERATION":if(run){run.generations=[...run.generations,e.summary];if(!this.#selection||this.#selection.generation<e.summary.generation-1)this.selectEpisode(e.summary.generation,0)}break;
   case "DONE":this.#progress=undefined;if(run)run.status=e.stopped?"stopped":"done";break;
   case "EPISODE_DETAIL":if(run){this.#episodes.set(`${run.id}:${e.detail.generation}:${e.detail.episode}`,e.detail);const s=this.#selection;
    if(s&&s.generation===e.detail.generation&&s.episode===e.detail.episode&&!s.decisionId){const d=e.detail.decisions.find(x=>x.safetyReason)??e.detail.decisions.find(x=>x.changedByAdvisor)??e.detail.decisions[Math.floor(e.detail.decisions.length/3)];if(d)this.selectDecision(d.id)}}break;
   case "EXPLANATION":if(run){const x=e.explanation;this.#explanations.set(`${run.id}:${x.generation}:${x.episode}:${x.decisionId}:${x.action}:${x.modelFrom===x.generation-1?"then":"latest"}`,x);
    // A "latest" explanation whose model is also the "then" model is the same trace: cache it under both keys.
    this.#explanations.set(`${run.id}:${x.generation}:${x.episode}:${x.decisionId}:${x.action}:${this.#selection?.model??"then"}`,x);this.#explaining=false}break;
   case "ERROR":this.#error=e.message;this.#explaining=false;break;
  }
  this.#changed();
 }
 start(config:LabConfig){
  const prev=this.#runs.at(-1);if(prev?.status==="running")prev.status="stopped";
  const run:LabRun={id:this.#nextId++,label:runLabel(config),config,generations:[],status:"running"};this.#runs.push(run);
  // Keep the last 4 runs for comparison; the newest is always shown.
  if(this.#runs.length>4)this.#runs.shift();this.#compare=this.#runs.map(r=>r.id);
  this.#selection=undefined;this.#error=undefined;this.#episodes.clear();this.#explanations.clear();this.#send({type:"START",config});this.#changed();
 }
 stop(){this.#send({type:"STOP"})}
 toggleCompare(id:number){this.#compare=this.#compare.includes(id)?this.#compare.filter(x=>x!==id):[...this.#compare,id];this.#changed()}
 clearHistory(){const cur=this.#runs.at(-1);this.#runs=cur?[cur]:[];this.#compare=cur?[cur.id]:[];this.#changed()}
 selectEpisode(generation:number,episode:number){
  const run=this.#runs.at(-1);if(!run)return;this.#selection={generation,episode,model:this.#selection?.model??"then"};
  if(!this.#episodes.has(`${run.id}:${generation}:${episode}`))this.#send({type:"EPISODE",generation,episode});this.#changed();
 }
 selectDecision(decisionId:string,action?:PilotIntent){
  const s=this.#selection,run=this.#runs.at(-1);if(!s||!run)return;const ep=this.#episodes.get(`${run.id}:${s.generation}:${s.episode}`),d=ep?.decisions.find(x=>x.id===decisionId);
  this.#selection={...s,decisionId,action:action??d?.requested??"HOLD"};this.#explain();this.#changed();
 }
 setTraceAction(action:PilotIntent){if(!this.#selection?.decisionId)return;this.#selection={...this.#selection,action};this.#explain();this.#changed()}
 setModel(model:"then"|"latest"){if(!this.#selection)return;this.#selection={...this.#selection,model};this.#explain();this.#changed()}
 #explain(){
  const s=this.#selection,run=this.#runs.at(-1);if(!s?.decisionId||!s.action||!run)return;
  if(s.model==="then"&&s.generation===0){this.#error=undefined;return}
  if(this.#explanations.has(`${run.id}:${s.generation}:${s.episode}:${s.decisionId}:${s.action}:${s.model}`))return;
  this.#explaining=true;this.#error=undefined;this.#send({type:"EXPLAIN",generation:s.generation,episode:s.episode,decisionId:s.decisionId,action:s.action,model:s.model});
 }
 dispose(){this.#worker?.terminate();this.#worker=undefined}
}
