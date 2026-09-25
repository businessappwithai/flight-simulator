export interface VersionRef { readonly id: string; readonly version: string; }

export interface PilotManifest {
  readonly id: string;
  readonly simulator: VersionRef;
  readonly controller: VersionRef;
  readonly safety: VersionRef;
  readonly decisionProvider: VersionRef;
  readonly temporalStrategy: VersionRef;
  readonly experience: VersionRef;
  readonly skills: VersionRef;
  readonly worldModel?: VersionRef;
  readonly reward: VersionRef;
}

export interface ExperimentManifest {
  readonly id: string;
  readonly pilotId: string;
  readonly benchmarkSuite: string;
  readonly scenarioSeeds: readonly string[];
  readonly gitCommit: string;
}

export { providerMemoryMatrix } from "./matrix.ts";

export { promotionDecision } from "./promotion.ts";
export type { PromotionEvidence, PromotionDecision } from "./promotion.ts";

export { ExperimentStore } from "./store.ts";

export { manifestHash } from "./hash.ts";
