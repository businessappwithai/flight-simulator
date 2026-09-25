import { expect, test } from "bun:test";
import { DeterministicSimulation, defaultScenario } from "@flight/simulation";
import { runCounterfactuals } from "@flight/counterfactual";

test("counterfactual branching restores authoritative snapshot", async () => {
  const sim = new DeterministicSimulation();
  sim.reset(defaultScenario(11n));
  const snapshot = sim.snapshot();
  const neutral = {aileron:0,elevator:0,rudder:0,throttle:.7};
  const climb = {aileron:0,elevator:.5,rudder:0,throttle:.7};
  const results = await runCounterfactuals(sim, snapshot, [
    {id:"neutral",controls:Array(120).fill(neutral)},
    {id:"climb",controls:Array(120).fill(climb)}
  ]);
  expect(results).toHaveLength(2);
  expect(results[0]?.checksum).not.toBe(results[1]?.checksum);
  expect(sim.tick).toBe(snapshot.tick);
});
