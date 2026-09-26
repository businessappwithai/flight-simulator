import type { DecisionFrame, PilotIntent, WorldSnapshot } from "@flight/protocol";
import { DeterministicSimulation, type Scenario } from "@flight/simulation";
import { PerfectSensorSuite } from "@flight/sensors";
import { IntentController } from "@flight/controller";
import { SafetySupervisor } from "@flight/safety";
import type { CognitivePilot } from "@flight/cognition";
import type { ExperienceRepository } from "@flight/experience";

export interface EpisodeResult{world:WorldSnapshot;decisions:readonly DecisionFrame[];checksum:string}
export class FlightRuntime {
 readonly sim=new DeterministicSimulation();
 readonly sensors=new PerfectSensorSuite();
 readonly controller=new IntentController();
 readonly safety=new SafetySupervisor();
 constructor(readonly pilot:CognitivePilot,readonly experience:ExperienceRepository){}
 async run(scenario:Scenario,maxTicks=120*60):Promise<EpisodeResult>{
  let world=this.sim.reset(scenario); const decisions:DecisionFrame[]=[];
  let active:{intent:PilotIntent;until:number}={intent:"HOLD",until:0}; let current:any;
  for(let i=0;i<maxTicks;i++){
   if(i>=active.until){
    const obs=this.sensors.observe(world);
    const d=await this.pilot.decide(obs);
    const safe=this.safety.evaluate(d.intent,obs);
    current={id:d.decisionId,startTick:this.sim.tick,requestedIntent:d.intent,executedIntent:safe.executed,
      provider:d.provider,probability:d.probability,evidence:safe.overridden?{...d.evidence,safetyReason:safe.reason??"UNKNOWN"}:d.evidence} satisfies DecisionFrame;
    decisions.push(current);this.pilot.remember(current);
    active={intent:safe.executed,until:i+30};
   }
   const obs=this.sensors.observe(world);
   world=this.sim.step(this.controller.controls(active.intent,obs));
   if(world.objective.phase==="COMPLETE"||world.objective.phase==="FAILED")break;
  }
  return {world,decisions,checksum:await this.sim.checksum()};
 }
}

export { RuntimeEventBus } from "./telemetry.ts";
export type { RuntimeEvent, RuntimeListener } from "./telemetry.ts";

export { OutcomeTracker } from "./outcome-tracker.ts";

export { TransitionCollector } from "./transition-collector.ts";

export { InspectorBridge } from "./inspector-bridge.ts";

export { ObservableFlightRuntime } from "./observable.ts";

export { encodeTelemetry, decodeTelemetry, readTelemetry } from "./telemetry-file.ts";

export { checkWorldInvariants } from "./invariants.ts";
export type { InvariantViolation } from "./invariants.ts";

export { DEFAULT_BUDGETS, budgetViolations } from "./budgets.ts";
export type { RuntimeBudgets, Subsystem, TimingSample } from "./budgets.ts";
