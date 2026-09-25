import type { AircraftControls } from "@flight/protocol";
import type { DeterministicSimulation, SimulationSnapshot } from "@flight/simulation";

export interface CounterfactualBranch {
  readonly id: string;
  readonly controls: readonly AircraftControls[];
}

export interface CounterfactualResult {
  readonly id: string;
  readonly checksum: string;
  readonly crashed: boolean;
  readonly objectivePhase: string;
}

export async function runCounterfactuals(
  sim: DeterministicSimulation,
  snapshot: SimulationSnapshot,
  branches: readonly CounterfactualBranch[]
): Promise<readonly CounterfactualResult[]> {
  const results: CounterfactualResult[] = [];
  for (const branch of branches) {
    sim.restore(snapshot);
    let world = sim.snapshot();
    for (const controls of branch.controls) world = sim.step(controls);
    results.push({
      id: branch.id,
      checksum: await sim.checksum(),
      crashed: world.aircraft.crashed,
      objectivePhase: world.objective.phase
    });
  }
  sim.restore(snapshot);
  return results;
}


export interface CounterfactualTrigger {
  collision:boolean;
  safetyOverride:boolean;
  providerDisagreement:number;
  providerEntropy:number;
  worldModelError?:number;
  novelty:number;
}
export function shouldCounterfactuallyEvaluate(t:CounterfactualTrigger):boolean{
 return t.collision || t.safetyOverride || t.providerDisagreement>=0.35 ||
   t.providerEntropy>=1.2 || (t.worldModelError??0)>=0.5 || t.novelty>=0.7;
}

export { evaluateIntentBranches } from "./intents.ts";
export type { IntentBranchResult } from "./intents.ts";
