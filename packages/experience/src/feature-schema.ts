export const BEST_PRACTICE_FEATURES=[
 "altitude","speed","verticalSpeed","headingSin","headingCos","nearestObstacleDistance",
 "terrainClearance","trafficDistance","hazardDistance","objectiveDistance","providerConfidence",
 "worldModelUncertainty","recentReward","recentRegret","safetyOverrideRate"
] as const;
export type BestPracticeFeature=typeof BEST_PRACTICE_FEATURES[number];
export type FeatureRecord=Record<BestPracticeFeature,number>;
export function encodeFeatures(x:FeatureRecord):number[]{return BEST_PRACTICE_FEATURES.map(k=>{const v=x[k];if(!Number.isFinite(v))throw new Error(`non-finite feature ${k}`);return v})}
export const FEATURE_SCHEMA_VERSION="bp-features-v1";
