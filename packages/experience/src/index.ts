import type { DecisionFrame, PilotIntent, RewardVector } from "@flight/protocol";

export interface ExperienceSummary {
  readonly fingerprint: string;
  readonly action: PilotIntent;
  readonly occurrences: number;
  readonly successes: number;
  readonly meanReward: RewardVector;
}

export interface ExperienceRepository {
  add(frame: DecisionFrame, fingerprint: string): Promise<void>;
  retrieve(fingerprint: string, limit: number): Promise<readonly ExperienceSummary[]>;
}

export class InMemoryExperienceRepository implements ExperienceRepository {
  #items: { frame: DecisionFrame; fingerprint: string }[] = [];

  async add(frame: DecisionFrame, fingerprint: string): Promise<void> {
    this.#items.push({ frame, fingerprint });
  }

  async retrieve(fingerprint: string, limit: number): Promise<readonly ExperienceSummary[]> {
    const groups = new Map<PilotIntent, DecisionFrame[]>();
    for (const x of this.#items.filter(x => x.fingerprint === fingerprint)) {
      const list = groups.get(x.frame.executedIntent) ?? [];
      list.push(x.frame);
      groups.set(x.frame.executedIntent, list);
    }
    return [...groups.entries()].slice(0, limit).map(([action, frames]) => {
      const rewards = frames.map(f => f.outcome?.after3s ?? f.outcome?.after1s ?? f.outcome?.immediate)
        .filter((x): x is RewardVector => !!x);
      const mean = (key: keyof RewardVector) =>
        rewards.length ? rewards.reduce((a,r)=>a+r[key],0)/rewards.length : 0;
      return {
        fingerprint,
        action,
        occurrences: frames.length,
        successes: rewards.filter(r => r.survival + r.objective > 0).length,
        meanReward: {
          survival: mean("survival"), separation: mean("separation"),
          objective: mean("objective"), stability: mean("stability"), efficiency: mean("efficiency")
        }
      };
    });
  }
}

export { situationFingerprint } from "./fingerprint.ts";

export { SqliteExperienceStore } from "./sqlite.ts";

export { shouldConsolidate } from "./consolidate.ts";
export type { ConsolidationCandidate } from "./consolidate.ts";

export { ExperienceForest, classifyExperience, score as experienceBranchScore } from "./forest.ts";
export type { ExperienceQuality, ExperienceStats, ExperienceBranch, NegativeMemory } from "./forest.ts";

export { InMemoryTreeIndex } from "./tree-index.ts";
export type { FastTreeIndex, TreeTrainingRow } from "./tree-index.ts";

export { ACTIONS, actionIndex, trainingWeight, OUTCOME_MODEL_FORMAT, outcomeLabel, outcomeRow, buildOutcomeDataset, candidateRows, rankOutcomes } from "./best-practice.ts";
export type { BestPracticeExample, BestPracticePrediction, OutcomeDataset } from "./best-practice.ts";

export { XGBoostBestPracticeClient } from "./xgboost-client.ts";
export type { TrainedModel } from "./xgboost-client.ts";

export { promoteBestPracticeModel } from "./model-promotion.ts";
export type { BestPracticeEvidence } from "./model-promotion.ts";

export { BEST_PRACTICE_FEATURES, FEATURE_SCHEMA_VERSION, encodeFeatures } from "./feature-schema.ts";
export type { BestPracticeFeature, FeatureRecord } from "./feature-schema.ts";

export { TrainingBuffer } from "./training-buffer.ts";

export { BestPracticeModelRegistry } from "./model-registry.ts";
export type { BestPracticeModelRecord, ModelState } from "./model-registry.ts";

export { summarizeShadow } from "./shadow-evaluator.ts";
export type { ShadowCase, ShadowSummary } from "./shadow-evaluator.ts";

export { OutcomeModel, DEFAULT_OUTCOME_PARAMS, validateParams, evaluateScores, auc } from "./outcome-model.ts";
export type { OutcomeModelParams, OutcomeEvaluation } from "./outcome-model.ts";
export { explainPrediction, importance as xgbImportance, treeDepths, nodeValues, traceTree, sigmoid } from "./xgb-trees.ts";
export type { PredictionTrace, TreeTrace, PathStep, FeatureImportance, XgbModelJson } from "./xgb-trees.ts";
