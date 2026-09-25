import { DeterministicSimulation, scenarioForSeed } from "@flight/simulation";
import { autopilotControls as autopilot } from "@flight/controller";
import { FlightRecorder } from "@flight/recorder";

async function run(seed: bigint) {
  const sim = new DeterministicSimulation();
  const scenario = scenarioForSeed(seed);
  let world = sim.reset(scenario);
  const recorder = new FlightRecorder();

  for (let i = 0; i < 120 * 180; i++) { // 3 simulated minutes: takeoff, checkpoint, pattern and landing
    const controls = autopilot(world);
    recorder.record(sim.tick, controls);
    world = sim.step(controls);
    if (world.objective.phase === "COMPLETE" || world.objective.phase === "FAILED") break;
  }

  const checksum = await sim.checksum();
  return {
    seed,
    outcome: world.objective.phase,
    ticks: sim.tick,
    checksum,
    recording: await recorder.finish(scenario.id, seed, checksum)
  };
}

const count = Number(Bun.argv[2] ?? "100");
let complete = 0, failed = 0, timeout = 0;
const seconds: number[] = [], failures: string[] = [];
for (let i = 1; i <= count; i++) {
  const r = await run(BigInt(i));
  if (r.outcome === "COMPLETE") { complete++; seconds.push(Number(r.ticks) / 120); }
  else if (r.outcome === "FAILED") { failed++; failures.push(`seed ${i}`); }
  else { timeout++; failures.push(`seed ${i} (timeout)`); }
}
seconds.sort((a, b) => a - b);
console.log(JSON.stringify({ scenarios: count, complete, failed, timeout,
  flightSeconds: seconds.length ? { min: seconds[0], median: seconds[Math.floor(seconds.length / 2)], max: seconds.at(-1) } : null,
  failures: failures.slice(0, 20) }, null, 2));
