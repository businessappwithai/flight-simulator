import type { PilotIntent } from "@flight/protocol";
import { IntentController } from "@flight/controller";
import { PerfectSensorSuite } from "@flight/sensors";
import type { DeterministicSimulation, SimulationSnapshot } from "@flight/simulation";
export interface IntentBranchResult{intent:PilotIntent;checksum:string;crashed:boolean;phase:string}
export async function evaluateIntentBranches(sim:DeterministicSimulation,snapshot:SimulationSnapshot,intents:readonly PilotIntent[],ticks=360):Promise<readonly IntentBranchResult[]>{
 const controller=new IntentController(),sensors=new PerfectSensorSuite(),out:IntentBranchResult[]=[];
 for(const intent of intents){
  sim.restore(snapshot);let world=sim.snapshot();
  for(let i=0;i<ticks;i++)world=sim.step(controller.controls(intent,sensors.observe(world)));
  out.push({intent,checksum:await sim.checksum(),crashed:world.aircraft.crashed,phase:world.objective.phase});
 }
 sim.restore(snapshot);return out;
}
