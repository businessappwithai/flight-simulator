import type {DecisionWhy,DashboardMetrics} from "./live-dashboard.ts";
export interface WatchdogFinding{code:string;severity:"WARNING"|"CRITICAL";detail:string}
export function watchdog(metrics:DashboardMetrics,recent:readonly DecisionWhy[]):WatchdogFinding[]{
 const out:WatchdogFinding[]=[];const noOutcome=recent.filter(x=>Object.keys(x.outcomes).length===0).length;
 if(recent.length>=10&&noOutcome/recent.length>.5)out.push({code:"MISSING_OUTCOMES",severity:"WARNING",detail:`${noOutcome}/${recent.length} recent decisions have no attributed outcome`});
 const overrides=recent.filter(x=>x.executed!==x.requested).length;if(recent.length>=10&&overrides/recent.length>.4)out.push({code:"OVERRIDE_STORM",severity:"CRITICAL",detail:`${overrides}/${recent.length} recent decisions were overridden`});
 if(metrics.providerDisagreements>=10)out.push({code:"DISAGREEMENT_ACCUMULATION",severity:"WARNING",detail:`${metrics.providerDisagreements} elevated provider disagreements observed`});return out;
}
