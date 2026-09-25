export interface InspectorHealth{telemetryAgeMs:number;healthy:boolean;reasons:string[]}
export function inspectorHealth(lastEventAt:number,now=Date.now(),maxAgeMs=3000):InspectorHealth{
 const age=Math.max(0,now-lastEventAt),reasons:string[]=[];if(age>maxAgeMs)reasons.push(`telemetry stale: ${age}ms`);
 return {telemetryAgeMs:age,healthy:reasons.length===0,reasons};
}
