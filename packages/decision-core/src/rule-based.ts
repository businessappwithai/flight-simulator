import type { DecisionEngine, DecisionEngineHealth, DecisionRequest, DecisionResponse } from "./index.ts";
/**
 * Local rule-based provider: a transparent stand-in for Jev/Open-Jev when no endpoint is configured.
 * Scores each candidate intent from the observation and returns softmax(score / temperature).
 * Higher temperature = flatter distribution = more (and worse) exploration for the learner to correct.
 * Deliberate blind spot, kept so there is something to learn: it descends toward the objective height without
 * regard to terrain clearance (the safety supervisor overrides those; the outcome model should learn to avoid them).
 */
export class RuleBasedDecisionEngine implements DecisionEngine{
 readonly identity;
 constructor(readonly temperature=.6){this.identity={provider:"local-rules",model:`rule-based-v1 t=${temperature}`,version:"1"}}
 score(intent:string,o:any):number{
  const b=o?.objective?.bearing??0,dist=o?.objective?.distance??1e9,alt=o?.altitude??0,above=o?.objective?.heightAbove??0,obs=o?.nearestObstacle,threat=obs&&obs.distance<160&&Math.abs(obs.bearing)<.7;
  // Inside the turning circle and well off the nose, homing would orbit: extend straight first (as the autopilot does).
  const radius=Math.max(20,o?.speed??50)/(.75*.5),extend=Math.abs(b)>1.1&&dist<2.2*radius;
  switch(intent){
   case "HOLD":return 1-Math.min(1.5,Math.abs(b)*2)+(extend?2.5:0)+(threat?-1:0);
   case "TURN_LEFT":return (b<-.1?1+Math.min(1.5,-b):-.6)+(threat&&obs.bearing>=0?1:0);
   case "TURN_RIGHT":return (b>.1?1+Math.min(1.5,b):-.6)+(threat&&obs.bearing<0?1:0);
   case "CLIMB":return (above<-10?1.3+Math.min(1,-above/60):0)+(alt<20&&o?.objectivePhase==="OUTBOUND"?1.5:0)+(threat?1.2:0);
   case "DESCEND":return above>25?1.1:-.5;
   case "SLOW":return -.8;case "REROUTE":return -1;case "ABORT":return -1.5;default:return -2;
  }
 }
 async decide<T extends string>(r:DecisionRequest<T>):Promise<DecisionResponse<T>>{
  const t=Math.max(.02,this.temperature),o=r.context.observation,s=r.candidates.map(c=>this.score(c,o)/t),m=Math.max(...s),e=s.map(x=>Math.exp(x-m)),z=e.reduce((a,b)=>a+b,0);
  return {requestId:r.id,engine:this.identity,candidates:r.candidates.map((value,i)=>({value,probability:e[i]!/z})),latencyMs:0};
 }
 async health():Promise<DecisionEngineHealth>{return {healthy:true,detail:"local rules"}}
}
