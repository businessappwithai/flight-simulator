import { expect, test } from "bun:test";
import type { AircraftControls } from "@flight/protocol";
import { DeterministicSimulation, defaultScenario } from "@flight/simulation";

const controls: AircraftControls = { aileron: 0.05, elevator: 0.1, rudder: 0, throttle: 0.72 };

test("same seed and controls produce same checksum", async () => {
  const run = async () => {
    const sim = new DeterministicSimulation();
    sim.reset(defaultScenario(12345n));
    for (let i=0;i<2000;i++) sim.step(controls);
    return sim.checksum();
  };
  expect(await run()).toBe(await run());
});

test("snapshot restore reproduces branch", async () => {
  const sim = new DeterministicSimulation();
  sim.reset(defaultScenario(777n));
  for (let i=0;i<500;i++) sim.step(controls);
  const snapshot = sim.snapshot();
  for (let i=0;i<300;i++) sim.step(controls);
  const expected = await sim.checksum();
  sim.restore(snapshot);
  for (let i=0;i<300;i++) sim.step(controls);
  expect(await sim.checksum()).toBe(expected);
});
