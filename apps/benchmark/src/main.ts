import type { AircraftControls, WorldSnapshot } from "@flight/protocol";
import { DeterministicSimulation, defaultScenario } from "@flight/simulation";
import { FlightRecorder } from "@flight/recorder";

function autopilot(world: WorldSnapshot): AircraftControls {
  const a = world.aircraft;
  const phase = world.objective.phase;
  const checkpoint = world.entities.find(e => e.kind === "CHECKPOINT")!;
  const runway = world.entities.find(e => e.kind === "RUNWAY")!;
  const target = phase === "OUTBOUND" ? checkpoint.position : runway.position;

  const dx = target.x - a.position.x;
  const dz = target.z - a.position.z;
  const targetHeading = Math.atan2(dx, dz);
  let error = targetHeading - a.heading;
  while (error > Math.PI) error -= Math.PI * 2;
  while (error < -Math.PI) error += Math.PI * 2;

  const targetAlt = phase === "RETURN" && Math.hypot(dx,dz) < 120 ? 2 : 85;
  const elevator = Math.max(-1, Math.min(1, (targetAlt - a.position.y) * 0.025 - a.pitch * 1.2));
  const aileron = Math.max(-1, Math.min(1, error * 1.8 - a.roll * 1.1));

  return { aileron, elevator, rudder: aileron * 0.15, throttle: phase === "RETURN" && Math.hypot(dx,dz) < 100 ? 0.2 : 0.78 };
}

async function run(seed: bigint) {
  const sim = new DeterministicSimulation();
  const scenario = defaultScenario(seed);
  let world = sim.reset(scenario);
  const recorder = new FlightRecorder();

  for (let i = 0; i < 120 * 90; i++) {
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
let complete = 0, failed = 0;
for (let i = 1; i <= count; i++) {
  const r = await run(BigInt(i));
  if (r.outcome === "COMPLETE") complete++;
  if (r.outcome === "FAILED") failed++;
}
console.log(JSON.stringify({ scenarios: count, complete, failed }, null, 2));
