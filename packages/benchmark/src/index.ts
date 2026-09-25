export const entropy=(ps:readonly number[])=>ps.reduce((h,p)=>p>0?h-p*Math.log2(p):h,0);
export interface EpisodeMetrics {completed:boolean;failed:boolean;ticks:number;safetyOverrides:number;semanticDecisions:number;providerLatencyMs:number;providerEntropy:number;minimumSeparation:number;}
const mean=(x:readonly number[])=>x.length?x.reduce((a,b)=>a+b,0)/x.length:0;
export const aggregateMetrics=(r:readonly EpisodeMetrics[])=>({
 episodes:r.length,completionRate:mean(r.map(x=>+x.completed)),failureRate:mean(r.map(x=>+x.failed)),
 meanTicks:mean(r.map(x=>x.ticks)),meanOverrides:mean(r.map(x=>x.safetyOverrides)),
 meanDecisions:mean(r.map(x=>x.semanticDecisions)),meanLatencyMs:mean(r.map(x=>x.providerLatencyMs)),
 meanEntropy:mean(r.map(x=>x.providerEntropy)),meanMinimumSeparation:mean(r.map(x=>x.minimumSeparation))
});
export const calibration=(o:readonly {confidence:number;success:boolean}[],width=.1)=>{
 const out:any[]=[];for(let lo=0;lo<1;lo+=width){const hi=Math.min(1,lo+width);
 const xs=o.filter(x=>x.confidence>=lo&&(hi===1?x.confidence<=hi:x.confidence<hi));if(xs.length)out.push({
 lower:lo,upper:hi,samples:xs.length,meanConfidence:mean(xs.map(x=>x.confidence)),
 observedSuccess:mean(xs.map(x=>+x.success))});}return out;
};

export { scalarReward, decisionRegret, rewardBetween } from "./evaluation.ts";
export type { HorizonOutcome, DecisionEvaluation } from "./evaluation.ts";

export { summarizeMetric, markdownReport } from "./report.ts";
export type { MetricSummary, BenchmarkReport } from "./report.ts";

export { benchmarkSeeds, partitionSeeds } from "./seeds.ts";

export { runId } from "./run-id.ts";
export type { RunIdentityInput } from "./run-id.ts";
