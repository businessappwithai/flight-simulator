import type { DecisionFrame, WorldSnapshot } from "@flight/protocol";
import { DeterministicSimulation, type Scenario } from "@flight/simulation";
import { PerfectSensorSuite } from "@flight/sensors";
import { IntentController } from "@flight/controller";
import { SafetySupervisor } from "@flight/safety";
import type { CognitivePilot } from "@flight/cognition";
import { RuntimeEventBus } from "./telemetry.ts";
import { OutcomeTracker } from "./outcome-tracker.ts";
export class ObservableFlightRuntime{
 readonly sim=new DeterministicSimulation();readonly sensors=new PerfectSensorSuite();
 readonly controller=new IntentController();readonly safety=new SafetySupervisor();
 readonly events=new RuntimeEventBus();readonly outcomes=new OutcomeTracker(this.events);
 #learning:Promise<void>[]=[];
 constructor(readonly pilot:CognitivePilot){this.events.subscribe(e=>{if(e.type==="OUTCOME")this.#learning.push(this.pilot.recordOutcome(e.decisionId,e.horizon,e.reward))})}
 async run(scenario:Scenario,maxTicks=7200){
  let world=this.sim.reset(scenario);let active:any={intent:"HOLD",until:0};const frames:DecisionFrame[]=[];
  for(let i=0;i<maxTicks;i++){
   if(i>=active.until){
    const obs=this.sensors.observe(world),d=await this.pilot.decide(obs),safe=this.safety.evaluate(d.intent,obs);
    const frame:DecisionFrame={id:d.decisionId,startTick:this.sim.tick,requestedIntent:d.intent,executedIntent:safe.executed,provider:this.pilot.engines.primary.identity.provider,probability:d.probability,evidence:safe.overridden?{...d.evidence,safetyReason:safe.reason??"UNKNOWN"}:d.evidence};
    frames.push(frame);this.pilot.remember(frame);this.events.publish({type:"DECISION",frame});this.outcomes.start(frame.id,world);
    if(safe.overridden)this.events.publish({type:"SAFETY_OVERRIDE",decisionId:frame.id,requested:d.intent,executed:safe.executed,reason:safe.reason??"UNKNOWN"});
    active={intent:safe.executed,until:i+30};
   }
   world=this.sim.step(this.controller.controls(active.intent,this.sensors.observe(world)));this.outcomes.observe(world);
   if(world.objective.phase==="COMPLETE"||world.objective.phase==="FAILED")break;
  }
  const learning=this.#learning;this.#learning=[];await Promise.all(learning);
  const checksum=await this.sim.checksum();this.events.publish({type:"EPISODE_END",tick:this.sim.tick.toString(),phase:world.objective.phase,checksum});
  return {world,frames,checksum};
 }
}
