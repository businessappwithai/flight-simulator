import type {
  AircraftControls, AircraftState, EntityState, ObjectiveState,
  RandomState, Tick, Vec3, WorldSnapshot
} from "@flight/protocol";

export const PHYSICS_HZ = 120;
export const PHYSICS_DT = 1 / PHYSICS_HZ;

export class SimulationClock {
  #tick: Tick = 0n;
  get tick(): Tick { return this.#tick; }
  get time(): number { return Number(this.#tick) * PHYSICS_DT; }
  advance(): Tick { this.#tick += 1n; return this.#tick; }
  reset(): void { this.#tick = 0n; }
  restore(tick: Tick): void { this.#tick = tick; }
}

export interface RandomSource {
  nextUint64(): bigint;
  nextFloat(): number;
  integer(minimum: number, maximum: number): number;
  snapshot(): RandomState;
  restore(state: RandomState): void;
}

export class SplitMix64 implements RandomSource {
  #state: bigint;
  constructor(seed: bigint) { this.#state = BigInt.asUintN(64, seed); }

  nextUint64(): bigint {
    this.#state = BigInt.asUintN(64, this.#state + 0x9e3779b97f4a7c15n);
    let z = this.#state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    return BigInt.asUintN(64, z ^ (z >> 31n));
  }

  nextFloat(): number {
    return Number(this.nextUint64() >> 11n) / 9007199254740992;
  }

  integer(minimum: number, maximum: number): number {
    return minimum + Math.floor(this.nextFloat() * (maximum - minimum + 1));
  }

  snapshot(): RandomState { return { state: this.#state }; }
  restore(state: RandomState): void { this.#state = state.state; }
}

export interface Scenario {
  readonly id: string;
  readonly seed: bigint;
  readonly aircraftStart: Vec3;
  readonly checkpoint: Vec3;
  readonly obstacleStart: Vec3;
  readonly obstacleVelocity: Vec3;
}

export interface SimulationSnapshot {
  readonly tick: Tick;
  readonly aircraft: AircraftState;
  readonly entities: readonly EntityState[];
  readonly objective: ObjectiveState;
  readonly random: RandomState;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);

export class DeterministicSimulation {
  readonly clock = new SimulationClock();
  #rng = new SplitMix64(1n);
  #aircraft!: AircraftState;
  #entities: EntityState[] = [];
  #objective: ObjectiveState = { phase: "OUTBOUND", checkpointReached: false };
  #scenario!: Scenario;

  get tick(): Tick { return this.clock.tick; }

  reset(scenario: Scenario): WorldSnapshot {
    this.#scenario = scenario;
    this.clock.reset();
    this.#rng = new SplitMix64(scenario.seed);
    this.#aircraft = {
      position: { ...scenario.aircraftStart },
      velocity: { x: 0, y: 0, z: 0 },
      heading: 0, pitch: 0, roll: 0, throttle: 0,
      grounded: scenario.aircraftStart.y <= 0,
      crashed: false
    };
    this.#entities = [
      { id: "checkpoint:0000", kind: "CHECKPOINT", position: { ...scenario.checkpoint }, velocity: {x:0,y:0,z:0}, radius: 20 },
      { id: "obstacle:0000", kind: "OBSTACLE", position: { ...scenario.obstacleStart }, velocity: { ...scenario.obstacleVelocity }, radius: 12 },
      { id: "runway:0000", kind: "RUNWAY", position: { ...scenario.aircraftStart }, velocity: {x:0,y:0,z:0}, radius: 30 }
    ];
    this.#objective = { phase: "OUTBOUND", checkpointReached: false };
    return this.snapshot();
  }

  step(c: AircraftControls): WorldSnapshot {
    if (this.#aircraft.crashed || this.#objective.phase === "COMPLETE") {
      this.clock.advance();
      return this.snapshot();
    }

    const throttle = clamp(c.throttle, 0, 1);
    const roll = clamp(this.#aircraft.roll + c.aileron * 0.9 * PHYSICS_DT, -0.9, 0.9);
    const pitch = clamp(this.#aircraft.pitch + c.elevator * 0.55 * PHYSICS_DT, -0.45, 0.45);
    const heading = this.#aircraft.heading + (roll * 0.75 + c.rudder * 0.15) * PHYSICS_DT;

    const oldSpeed = Math.hypot(this.#aircraft.velocity.x, this.#aircraft.velocity.y, this.#aircraft.velocity.z);
    const thrust = throttle * 34;
    const drag = oldSpeed * 0.10;
    const speed = clamp(oldSpeed + (thrust - drag) * PHYSICS_DT, 0, 90);

    const horizontal = Math.cos(pitch) * speed;
    const vy = Math.sin(pitch) * speed - (speed < 12 && this.#aircraft.position.y > 0 ? 4 : 0);
    const velocity = {
      x: Math.sin(heading) * horizontal,
      y: vy,
      z: Math.cos(heading) * horizontal
    };
    let position = {
      x: this.#aircraft.position.x + velocity.x * PHYSICS_DT,
      y: this.#aircraft.position.y + velocity.y * PHYSICS_DT,
      z: this.#aircraft.position.z + velocity.z * PHYSICS_DT
    };

    let crashed = false;
    let grounded = false;
    if (position.y <= 0) {
      if (Math.abs(velocity.y) > 8 || Math.abs(roll) > 0.35) crashed = true;
      position = { ...position, y: 0 };
      grounded = true;
    }

    this.#entities = this.#entities.map(e => e.kind !== "OBSTACLE" ? e : ({
      ...e,
      position: {
        x: e.position.x + e.velocity.x * PHYSICS_DT,
        y: e.position.y + e.velocity.y * PHYSICS_DT,
        z: e.position.z + e.velocity.z * PHYSICS_DT
      }
    }));

    const obstacle = this.#entities.find(e => e.kind === "OBSTACLE")!;
    if (dist(position, obstacle.position) <= obstacle.radius + 3) crashed = true;

    const checkpoint = this.#entities.find(e => e.kind === "CHECKPOINT")!;
    let objective = this.#objective;
    if (objective.phase === "OUTBOUND" && dist(position, checkpoint.position) <= checkpoint.radius) {
      objective = { phase: "RETURN", checkpointReached: true };
    }
    const runway = this.#entities.find(e => e.kind === "RUNWAY")!;
    if (objective.phase === "RETURN" && grounded && dist(position, runway.position) <= runway.radius) {
      objective = { phase: "COMPLETE", checkpointReached: true };
    }
    if (crashed) objective = { ...objective, phase: "FAILED" };

    this.#aircraft = { position, velocity, heading, pitch, roll, throttle, grounded, crashed };
    this.#objective = objective;
    this.clock.advance();
    return this.snapshot();
  }

  snapshot(): SimulationSnapshot {
    return {
      tick: this.clock.tick,
      aircraft: structuredClone(this.#aircraft),
      entities: structuredClone(this.#entities),
      objective: structuredClone(this.#objective),
      random: this.#rng.snapshot()
    };
  }

  restore(s: SimulationSnapshot): void {
    this.clock.restore(s.tick);
    this.#aircraft = structuredClone(s.aircraft);
    this.#entities = [...structuredClone(s.entities)];
    this.#objective = structuredClone(s.objective);
    this.#rng.restore(s.random);
  }

  async checksum(): Promise<string> {
    const s = this.snapshot();
    const canonical = JSON.stringify({
      tick: s.tick.toString(),
      aircraft: s.aircraft,
      entities: [...s.entities].sort((a,b)=>a.id.localeCompare(b.id)),
      objective: s.objective,
      random: s.random.state.toString()
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,"0")).join("");
  }
}

/**
 * Seed-varied scenario for benchmarks: checkpoint placement and obstacle track are drawn from the seed
 * (defaultScenario keeps fixed geometry so golden checksums stay stable). Same seed → same scenario.
 */
export function scenarioForSeed(seed: bigint): Scenario {
  const r = new SplitMix64(seed ^ 0x5eed5ce4a410n), u = (a: number, b: number) => a + (b - a) * r.nextFloat();
  const checkpoint = { x: u(-180, 180), y: u(60, 120), z: u(450, 850) };
  const side = r.nextFloat() < .5 ? -1 : 1, speed = u(6, 22);
  return {
    id: `seeded-${seed}`,
    seed,
    aircraftStart: { x: 0, y: 2, z: 0 },
    checkpoint,
    obstacleStart: { x: -side * u(90, 220), y: u(50, 110), z: u(220, 420) },
    obstacleVelocity: { x: side * speed, y: 0, z: u(-3, 3) }
  };
}

export const defaultScenario = (seed: bigint): Scenario => ({
  id: "moving-obstacle-001",
  seed,
  aircraftStart: { x: 0, y: 2, z: 0 },
  checkpoint: { x: 0, y: 80, z: 600 },
  obstacleStart: { x: -120, y: 70, z: 330 },
  obstacleVelocity: { x: 15, y: 0, z: 0 }
});
