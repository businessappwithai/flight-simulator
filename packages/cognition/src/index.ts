import type {
  DecisionFrame, PilotIntent, TemporalStrategyName, TemporalSummary
} from "@flight/protocol";

export interface TemporalStrategy {
  readonly name: TemporalStrategyName;
  summarize(frames: readonly DecisionFrame[]): TemporalSummary;
}

const score = (f: DecisionFrame): number => {
  const r = f.outcome?.after3s ?? f.outcome?.after1s ?? f.outcome?.immediate;
  if (!r) return 0;
  return r.survival + r.separation + r.objective + r.stability + r.efficiency;
};

export class NoMemoryStrategy implements TemporalStrategy {
  readonly name = "NONE" as const;
  summarize(_frames?: readonly DecisionFrame[]): TemporalSummary {
    return { strategy: this.name, recentActions: [], effectiveActions: [], ineffectiveActions: [] };
  }
}

export class PreviousActionStrategy implements TemporalStrategy {
  readonly name = "PREVIOUS" as const;
  summarize(frames: readonly DecisionFrame[]): TemporalSummary {
    const last = frames.at(-1);
    return {
      strategy: this.name,
      recentActions: last ? [last.executedIntent] : [],
      effectiveActions: [],
      ineffectiveActions: []
    };
  }
}

export class SequenceStrategy implements TemporalStrategy {
  readonly name = "SEQUENCE" as const;
  constructor(private readonly limit = 6) {}
  summarize(frames: readonly DecisionFrame[]): TemporalSummary {
    return {
      strategy: this.name,
      recentActions: frames.slice(-this.limit).map(f => f.executedIntent),
      effectiveActions: [],
      ineffectiveActions: []
    };
  }
}

export class OutcomeAwareStrategy implements TemporalStrategy {
  readonly name = "OUTCOME_AWARE" as const;
  constructor(private readonly limit = 6) {}
  summarize(frames: readonly DecisionFrame[]): TemporalSummary {
    const recent = frames.slice(-this.limit);
    const effective = new Set<PilotIntent>();
    const ineffective = new Set<PilotIntent>();
    for (const f of recent) {
      const s = score(f);
      if (s > 0) effective.add(f.executedIntent);
      if (s < 0) ineffective.add(f.executedIntent);
    }
    return {
      strategy: this.name,
      recentActions: recent.map(f => f.executedIntent),
      effectiveActions: [...effective],
      ineffectiveActions: [...ineffective]
    };
  }
}

export class ShuffledHistoryStrategy implements TemporalStrategy {
  readonly name = "SHUFFLED" as const;
  summarize(frames: readonly DecisionFrame[]): TemporalSummary {
    // Deterministic "shuffle": reverse order, so experiments remain exactly replayable.
    return {
      strategy: this.name,
      recentActions: frames.map(f => f.executedIntent).reverse(),
      effectiveActions: [],
      ineffectiveActions: []
    };
  }
}

export { CognitivePilot, DEFAULT_MIN_PROVIDER_CONFIDENCE, observationFeatures, OBSERVATION_FEATURES_V1 } from "./pilot.ts";
export type { BestPracticeAdvisor, PilotAdvisors, PilotDecision } from "./pilot.ts";

export { traceSummary } from "./trace.ts";
export type { DecisionTrace } from "./trace.ts";

export { fuseExperienceCandidates } from "./experience-arbiter.ts";
export type { RankedAction } from "./experience-arbiter.ts";
