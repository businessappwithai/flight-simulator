export type Tick = bigint;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AircraftControls {
  readonly aileron: number;
  readonly elevator: number;
  readonly rudder: number;
  readonly throttle: number;
}

export interface AircraftState {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly heading: number;
  readonly pitch: number;
  readonly roll: number;
  readonly throttle: number;
  readonly grounded: boolean;
  readonly crashed: boolean;
}

export interface EntityState {
  readonly id: string;
  readonly kind: "OBSTACLE" | "CHECKPOINT" | "RUNWAY";
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly radius: number;
}

export interface ObjectiveState {
  readonly phase: "OUTBOUND" | "RETURN" | "COMPLETE" | "FAILED";
  readonly checkpointReached: boolean;
}

export interface RandomState {
  readonly state: bigint;
}

export interface WorldSnapshot {
  readonly tick: Tick;
  readonly aircraft: AircraftState;
  readonly entities: readonly EntityState[];
  readonly objective: ObjectiveState;
  readonly random: RandomState;
}

export interface Observation {
  readonly tick: Tick;
  readonly speed: number;
  readonly altitude: number;
  readonly heading: number;
  readonly objectivePhase: ObjectiveState["phase"];
  readonly nearestObstacle?: {
    readonly distance: number;
    readonly bearing: number;
  };
  /** Current objective (the gate while OUTBOUND, the runway on RETURN): distance (m), relative bearing (rad), height above it (m). */
  readonly objective?: {
    readonly distance: number;
    readonly bearing: number;
    readonly heightAbove: number;
  };
  /** Aircraft attitude (radians) and vertical speed (m/s); lets the controller stabilise intents. */
  readonly attitude?: {
    readonly pitch: number;
    readonly roll: number;
    readonly verticalSpeed: number;
  };
}

export type PilotIntent =
  | "HOLD"
  | "TURN_LEFT"
  | "TURN_RIGHT"
  | "CLIMB"
  | "DESCEND"
  | "SLOW"
  | "REROUTE"
  | "ABORT";

export interface DecisionContext {
  readonly schemaVersion: 1;
  readonly observation: Observation;
  readonly temporal: {
    readonly recentActions: readonly PilotIntent[];
  };
}


export interface RewardVector {
  readonly survival: number;
  readonly separation: number;
  readonly objective: number;
  readonly stability: number;
  readonly efficiency: number;
}

export interface DecisionOutcome {
  readonly immediate?: RewardVector;
  readonly after1s?: RewardVector;
  readonly after3s?: RewardVector;
  readonly terminal?: RewardVector;
}

export interface DecisionFrame {
  readonly id: string;
  readonly startTick: Tick;
  readonly endTick?: Tick;
  readonly requestedIntent: PilotIntent;
  readonly executedIntent: PilotIntent;
  readonly provider: string;
  readonly probability: number;
  readonly outcome?: DecisionOutcome;
  /** What the decision was actually based on. Absent fields mean "not recorded", never "not relevant". */
  readonly evidence?: DecisionEvidence;
}

/** Advisory sources never choose the intent; their result or failure is recorded for explanation. */
export type AdvisorEvidence<T> =
  | { readonly status: "OK"; readonly source: string; readonly latencyMs: number; readonly result: T }
  | { readonly status: "ERROR" | "TIMEOUT"; readonly source: string; readonly latencyMs: number; readonly detail: string };

export interface DecisionEvidence {
  readonly model: string;
  readonly candidates: readonly { readonly intent: PilotIntent; readonly probability: number }[];
  readonly temporalStrategy: string;
  readonly temporalPatterns: readonly string[];
  readonly fingerprint: string;
  readonly retrievedExperienceIds: readonly string[];
  readonly providerDisagreement: number;
  readonly shadows: readonly { readonly provider: string; readonly model: string; readonly top?: PilotIntent; readonly probability?: number; readonly error?: string }[];
  readonly bestPractice?: AdvisorEvidence<readonly { readonly action: PilotIntent; readonly probability: number }[]>;
  readonly worldModel?: AdvisorEvidence<readonly { readonly action: PilotIntent; readonly horizonSeconds: number; readonly predictedRisk: number; readonly uncertainty: number; readonly predictedReward: number }[]>;
  readonly safetyReason?: string;
  /** How the final intent was chosen when the provider and an advisor are blended (absent = provider's top choice). */
  readonly arbitration?: {
    readonly advisorWeight: number;
    readonly selection: "argmax" | "sample";
    readonly scores: readonly { readonly intent: PilotIntent; readonly provider: number; readonly advisor?: number; readonly blended: number }[];
    readonly providerTop: PilotIntent;
    readonly chosen: PilotIntent;
    /** The advisor moved the best blended choice away from the provider's top intent. */
    readonly changedByAdvisor: boolean;
    /** Sampling (exploration) picked something other than the best blended choice. */
    readonly explored: boolean;
  };
  /**
   * Who chose the intent. The primary provider (Jev/Open-Jev) decides when its top candidate reaches
   * `threshold`; below it the best-practice (XGBoost) model's highest-ranked intent is used when it answered.
   */
  readonly selection?: {
    readonly source: "PROVIDER" | "BEST_PRACTICE";
    readonly providerConfidence: number;
    readonly threshold: number;
    readonly reason: string;
  };
}

export type TemporalStrategyName =
  | "NONE"
  | "PREVIOUS"
  | "SEQUENCE"
  | "OUTCOME_AWARE"
  | "SHUFFLED";

export interface TemporalSummary {
  readonly strategy: TemporalStrategyName;
  readonly recentActions: readonly PilotIntent[];
  readonly effectiveActions: readonly PilotIntent[];
  readonly ineffectiveActions: readonly PilotIntent[];
}

export type { SimCommand, SimEvent, SimPilot, InspectorCommand, LearningBook, LearningEntry, LearningInsight, LearningTally, LearningExample, FlightTrace, CopilotAdvice, CopilotStatus } from "./worker.ts";

export type { RuntimeEvent, DecisionTrace } from "./telemetry.ts";

export type { LabConfig, LabModelParams, LabEvaluation, LabMetrics, LabEpisodeSummary, LabImportance, LabTraining, LabGenerationSummary,
  LabTrackPoint, LabDecision, LabEpisodeDetail, LabTreeStep, LabExplanation, LabCommand, LabEvent } from "./lab.ts";
