import type { AircraftControls, Tick } from "@flight/protocol";

export interface ControlFrame {
  readonly tick: Tick;
  readonly controls: AircraftControls;
}

export interface FlightRecording {
  readonly formatVersion: 1;
  readonly scenarioId: string;
  readonly seed: string;
  readonly controls: readonly { tick: string; controls: AircraftControls }[];
  readonly finalChecksum: string;
}

export class FlightRecorder {
  #frames: ControlFrame[] = [];
  record(tick: Tick, controls: AircraftControls): void {
    this.#frames.push({ tick, controls: structuredClone(controls) });
  }
  async finish(scenarioId: string, seed: bigint, finalChecksum: string): Promise<FlightRecording> {
    return {
      formatVersion: 1,
      scenarioId,
      seed: seed.toString(),
      controls: this.#frames.map(f => ({ tick: f.tick.toString(), controls: f.controls })),
      finalChecksum
    };
  }
}

export { JsonlTelemetryRecorder } from "./telemetry.ts";
