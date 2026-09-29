import type {DecisionFrame,FlightTrace,PilotIntent,RewardVector,RuntimeEvent,SimPilot,Tick,WorldStreamSample} from "@flight/protocol";
/** Bounds one flight's trace; later frames of a very long flight are not recorded. */
export const MAX_TRACE_FRAMES=400,MAX_ADVICE_FRAMES=400,MAX_STREAM_SAMPLES=240;
const TERMINAL:Record<"LANDED"|"CRASHED",RewardVector>={
 LANDED:{survival:1,separation:0,objective:1,stability:0,efficiency:0},
 CRASHED:{survival:-1,separation:0,objective:-1,stability:0,efficiency:0}
};
interface Open{startTick:Tick;intent:PilotIntent;pilot:SimPilot;situation:string;model:string}
/**
 * Records a flight as Control Room telemetry, for manual and autopilot flying alike: one DECISION frame per
 * change of intent or pilot (provider "manual" or "autopilot"). The pilot always executes what it requested,
 * so requested = executed and confidence is 1. Observes only; never influences the flight.
 */
export class FlightTraceRecorder{
 #frames:DecisionFrame[]=[];#advice:DecisionFrame[]=[];#stream:{tick:Tick;stream:WorldStreamSample}[]=[];#open?:Open;#pilots=new Set<SimPilot>();#id="";#scenarioId="";
 get frames(){return this.#frames.length+(this.#open?1:0)}
 begin(id:string,scenarioId:string){this.#frames=[];this.#advice=[];this.#stream=[];this.#open=undefined;this.#pilots.clear();this.#id=id;this.#scenarioId=scenarioId}
 /** Forget the flight in progress without producing a trace. */
 discard(){this.begin(this.#id,this.#scenarioId)}
 record(tick:Tick,intent:PilotIntent,pilot:SimPilot,situation:string,model:string){
  const o=this.#open;if(o&&o.intent===intent&&o.pilot===pilot)return;
  if(o)this.#close(tick);
  if(this.#frames.length>=MAX_TRACE_FRAMES)return;
  this.#pilots.add(pilot);this.#open={startTick:tick,intent,pilot,situation,model};
 }
 /**
  * A copilot recommendation (Jev, or XGBoost when Jev was unsure) as its own DECISION frame: requested is what
  * the copilot recommended, executed is what the autopilot was flying, evidence says who decided and why.
  */
 advise(frame:DecisionFrame){if(this.#advice.length<MAX_ADVICE_FRAMES)this.#advice.push(frame)}
 /** A real-world streaming sample (GeoTelemetry) for the Control Room's world-stream panel; thinned when there are too many. */
 stream(tick:Tick,stream:WorldStreamSample){this.#stream.push({tick,stream});if(this.#stream.length>MAX_STREAM_SAMPLES)this.#stream=this.#stream.filter((_,i)=>i%2===0)}
 /** Ends the flight: returns its trace (undefined when nothing was recorded) and starts empty. */
 finish(outcome:FlightTrace["outcome"],tick:Tick,checksum:string,phase:string):FlightTrace|undefined{
  this.#close(tick);if(!this.#frames.length){this.discard();return undefined}
  const terminal=outcome==="ABANDONED"?undefined:TERMINAL[outcome];
  const all=[...this.#frames,...this.#advice].sort((a,b)=>a.startTick<b.startTick?-1:a.startTick>b.startTick?1:0);
  // A copy per frame: Bun's structured clone (postMessage) fails on one object shared by many frames that carry bigints.
  const events:RuntimeEvent[]=all.map(f=>({type:"DECISION",frame:terminal?{...f,outcome:{terminal:{...terminal}}}:f}));
  // World-stream samples interleaved by tick (after decisions of the same tick).
  for(const s of this.#stream){const i=events.findIndex(e=>e.type==="DECISION"&&e.frame.startTick>s.tick);events.splice(i<0?events.length:i,0,{type:"WORLD_STREAM",tick:String(s.tick),stream:s.stream})}
  events.push({type:"EPISODE_END",tick:String(tick),phase,checksum});
  const trace:FlightTrace={id:this.#id,scenarioId:this.#scenarioId,outcome,pilots:[...this.#pilots],events};
  this.discard();return trace;
 }
 #close(tick:Tick){const o=this.#open;if(!o)return;this.#open=undefined;
  this.#frames.push({id:`${this.#id}:${o.startTick}`,startTick:o.startTick,endTick:tick,requestedIntent:o.intent,executedIntent:o.intent,
   provider:o.pilot==="AUTOPILOT"?"autopilot":"manual",probability:1,
   evidence:{model:o.model,candidates:[{intent:o.intent,probability:1}],temporalStrategy:"NONE",temporalPatterns:[],fingerprint:o.situation,retrievedExperienceIds:[],providerDisagreement:0,shadows:[]}})}
}
