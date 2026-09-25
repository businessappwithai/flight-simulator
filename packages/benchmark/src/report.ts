export interface MetricSummary{name:string;n:number;mean:number;min:number;max:number}
export function summarizeMetric(name:string,xs:readonly number[]):MetricSummary{
 if(!xs.length)return{name,n:0,mean:0,min:0,max:0};
 return{name,n:xs.length,mean:xs.reduce((a,b)=>a+b,0)/xs.length,min:Math.min(...xs),max:Math.max(...xs)};
}
export interface BenchmarkReport{pilotId:string;scenarioFamily:string;metrics:readonly MetricSummary[];hardFailures:number;safetyOverrides:number}
export function markdownReport(r:BenchmarkReport):string{
 const rows=r.metrics.map(m=>`| ${m.name} | ${m.n} | ${m.mean.toFixed(4)} | ${m.min.toFixed(4)} | ${m.max.toFixed(4)} |`).join("\n");
 return `# Benchmark ${r.pilotId}\n\nScenario family: ${r.scenarioFamily}\n\nHard failures: ${r.hardFailures}\n\nSafety overrides: ${r.safetyOverrides}\n\n| Metric | N | Mean | Min | Max |\n|---|---:|---:|---:|---:|\n${rows}\n`;
}
