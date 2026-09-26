import type {DecisionFrame,FlightTrace,PilotIntent,RewardVector,RuntimeEvent,SimPilot,Tick} from "@flight/protocol";
/** Bounds one flight's trace; later frames of a very long flight are not recorded. */
export const MAX_TRACE_FRAMES=400;
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
 #frames:DecisionFrame[]=[];#open?:Open;#pilots=new Set<SimPilot>();#id="";#scenarioId="";
 get frames(){return this.#frames.length+(this.#open?1:0)}
 begin(id:string,scenarioId:string){this.#frames=[];this.#open=undefined;this.#pilots.clear();this.#id=id;this.#scenarioId=scenarioId}
 /** Forget the flight in progress without producing a trace. */
 discard(){this.begin(this.#id,this.#scenarioId)}
 record(tick:Tick,intent:PilotIntent,pilot:SimPilot,situation:string,model:string){
  const o=this.#open;if(o&&o.intent===intent&&o.pilot===pilot)return;
  if(o)this.#close(tick);
  if(this.#frames.length>=MAX_TRACE_FRAMES)return;
  this.#pilots.add(pilot);this.#open={startTick:tick,intent,pilot,situation,model};
 }
 /** Ends the flight: returns its trace (undefined when nothing was recorded) and starts empty. */
 finish(outcome:FlightTrace["outcome"],tick:Tick,checksum:string,phase:string):FlightTrace|undefined{
  this.#close(tick);if(!this.#frames.length){this.discard();return undefined}
  const terminal=outcome==="ABANDONED"?undefined:TERMINAL[outcome];
  const events:RuntimeEvent[]=this.#frames.map(f=>({type:"DECISION",frame:terminal?{...f,outcome:{terminal}}:f}));
  events.push({type:"EPISODE_END",tick:String(tick),phase,checksum});
  const trace:FlightTrace={id:this.#id,scenarioId:this.#scenarioId,outcome,pilots:[...this.#pilots],events};
  this.discard();return trace;
 }
 #close(tick:Tick){const o=this.#open;if(!o)return;this.#open=undefined;
  this.#frames.push({id:`${this.#id}:${o.startTick}`,startTick:o.startTick,endTick:tick,requestedIntent:o.intent,executedIntent:o.intent,
   provider:o.pilot==="AUTOPILOT"?"autopilot":"manual",probability:1,
   evidence:{model:o.model,candidates:[{intent:o.intent,probability:1}],temporalStrategy:"NONE",temporalPatterns:[],fingerprint:o.situation,retrievedExperienceIds:[],providerDisagreement:0,shadows:[]}})}
}
