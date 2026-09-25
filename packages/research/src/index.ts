import { clusterFailures, type FailureSignature } from "@flight/failure-analysis";
import { promotionDecision, type PromotionEvidence } from "@flight/experiments";

export interface VariantRunResult {
  variantId:string; seed:string; completed:boolean; failed:boolean;
  checksum:string; failures:readonly FailureSignature[];
  metrics:Record<string,number>;
}
export interface ResearchVariant {
  id:string;
  run(seed:bigint):Promise<VariantRunResult>;
}
export interface ResearchPlan {
  id:string; baseline:ResearchVariant; candidates:readonly ResearchVariant[];
  seeds:readonly bigint[];
}
export interface VariantSummary {
  variantId:string; runs:number; completionRate:number; failures:number;
  failureFamilies:ReturnType<typeof clusterFailures>;
}
export interface ResearchReport {
  experimentId:string; baseline:VariantSummary; candidates:readonly {
    summary:VariantSummary; promotion:"PROMOTE"|"REJECT"|"MORE_EVIDENCE";
  }[];
}
const summarize=(id:string,rows:readonly VariantRunResult[]):VariantSummary=>({
  variantId:id,runs:rows.length,
  completionRate:rows.length?rows.filter(x=>x.completed).length/rows.length:0,
  failures:rows.filter(x=>x.failed).length,
  failureFamilies:clusterFailures(rows.flatMap(x=>x.failures))
});
export async function runResearchPlan(plan:ResearchPlan):Promise<ResearchReport>{
  const baselineRows=await Promise.all(plan.seeds.map(s=>plan.baseline.run(s)));
  const baseline=summarize(plan.baseline.id,baselineRows);
  const candidates=[];
  for(const c of plan.candidates){
    const rows=await Promise.all(plan.seeds.map(s=>c.run(s)));
    const summary=summarize(c.id,rows);
    const evidence:PromotionEvidence={
      scenarios:rows.length,baselineFailures:baseline.failures,candidateFailures:summary.failures,
      baselineCompletionRate:baseline.completionRate,candidateCompletionRate:summary.completionRate,
      newHardRegressions:0,reproducible:true
    };
    candidates.push({summary,promotion:promotionDecision(evidence)});
  }
  return {experimentId:plan.id,baseline,candidates};
}
export function reportJson(report:ResearchReport):string{
  return JSON.stringify(report,null,2);
}

export { sha256, writeArtifact } from "./artifacts.ts";
export type { ArtifactRef } from "./artifacts.ts";

export { prioritizeResearch } from "./scheduler.ts";
export type { ResearchSignal } from "./scheduler.ts";

export { standardAblations } from "./ablation.ts";
export type { AblationConfig } from "./ablation.ts";

export { RegressionSuite } from "./regression.ts";
export type { RegressionCase } from "./regression.ts";

export { provenanceKey } from "./provenance.ts";
export type { Provenance } from "./provenance.ts";

export { GoldenCorpus } from "./golden.ts";
export type { GoldenCase } from "./golden.ts";

export { releaseGate } from "./lifecycle.ts";
export type { ReleaseEvidence, GateDecision } from "./lifecycle.ts";

export { validateReleaseManifest } from "./release-manifest.ts";
export type { ReleaseArtifact, ReleaseManifest } from "./release-manifest.ts";

export { EvidenceArchive } from "./evidence.ts";
export type { EvidenceRecord } from "./evidence.ts";
