import type { PilotIntent, RewardVector } from "@flight/protocol";

export interface SituationVector {
  readonly values: readonly number[];
}

export interface ActionPrediction {
  readonly action: PilotIntent;
  readonly horizonSeconds: number;
  readonly predictedReward: RewardVector;
  readonly predictedRisk: number;
  readonly uncertainty: number;
}

export interface WorldModel {
  readonly id: string;
  imagine(
    state: SituationVector,
    actions: readonly PilotIntent[],
    horizons: readonly number[]
  ): Promise<readonly ActionPrediction[]>;
}

export class NoWorldModel implements WorldModel {
  readonly id = "none";
  async imagine(): Promise<readonly ActionPrediction[]> { return []; }
}

export { toJsonl } from "./dataset.ts";
export type { WorldModelTransition, DatasetManifest } from "./dataset.ts";

export { evaluateShadow } from "./shadow.ts";
export type { ShadowError } from "./shadow.ts";

export { HttpWorldModel } from "./http.ts";

export { buildTrustMap } from "./trust-map.ts";
export type { ErrorSample, TrustCell } from "./trust-map.ts";

export { splitScenarioSeed } from "./split.ts";
export type { DatasetSplit } from "./split.ts";

export { allowedAuthority } from "./authority.ts";
export type { WorldModelAuthority, AuthorityEvidence } from "./authority.ts";
