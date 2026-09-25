export interface ErrorSample{situationFamily:string;horizonSeconds:number;error:number;uncertainty:number}
export interface TrustCell{situationFamily:string;horizonSeconds:number;samples:number;meanError:number;meanUncertainty:number;trust:number}
export function buildTrustMap(xs:readonly ErrorSample[]):readonly TrustCell[]{
 const m=new Map<string,ErrorSample[]>();for(const x of xs){const k=`${x.situationFamily}|${x.horizonSeconds}`;const a=m.get(k)??[];a.push(x);m.set(k,a)}
 return [...m.values()].map(a=>{const mean=(k:"error"|"uncertainty")=>a.reduce((s,x)=>s+x[k],0)/a.length;
  const e=mean("error"),u=mean("uncertainty");return{situationFamily:a[0]!.situationFamily,horizonSeconds:a[0]!.horizonSeconds,samples:a.length,meanError:e,meanUncertainty:u,trust:Math.max(0,1-(e+u)/2)}})
}
