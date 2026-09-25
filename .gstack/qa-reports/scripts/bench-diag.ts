import type { AircraftControls, WorldSnapshot } from "@flight/protocol";import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
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
for(const seed of [1n,2n]){const sim=new DeterministicSimulation();let w=sim.reset(defaultScenario(seed));
 for(let i=0;i<120*90;i++){const prev=w;w=sim.step(autopilot(w));if(i%120===0){const a=w.aircraft;console.log(`t=${i/120}s pos=(${a.position.x.toFixed(0)},${a.position.y.toFixed(1)},${a.position.z.toFixed(0)}) spd=${Math.hypot(a.velocity.x,a.velocity.y,a.velocity.z).toFixed(1)} pitch=${a.pitch.toFixed(2)} ${w.objective.phase}`)}
 if(w.objective.phase!=="OUTBOUND"&&w.objective.phase!=="RETURN"||i===120*90-1){const a=prev.aircraft,o=prev.entities.find(e=>e.kind==="OBSTACLE")!;console.log(`seed ${seed} ${w.objective.phase} tick ${i} pos=(${a.position.x.toFixed(1)},${a.position.y.toFixed(1)},${a.position.z.toFixed(1)}) vy=${a.velocity.y.toFixed(2)} roll=${a.roll.toFixed(2)} dObst=${Math.hypot(a.position.x-o.position.x,a.position.y-o.position.y,a.position.z-o.position.z).toFixed(1)}`);break}}}
