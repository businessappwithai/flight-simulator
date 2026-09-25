export interface BenchmarkRow{variant:string;episodes:number;completionRate:number;hardFailures:number;safetyOverrides:number;meanReward:number;meanRegret:number}
export function compareRows(rows:readonly BenchmarkRow[]){
 return [...rows].sort((a,b)=>a.variant.localeCompare(b.variant)).map(r=>({...r,failureRate:r.episodes?r.hardFailures/r.episodes:0,overrideRate:r.episodes?r.safetyOverrides/r.episodes:0}));
}
