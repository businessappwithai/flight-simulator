export interface FeatureSet<T>{base:T;removers:readonly {name:string;remove:(x:T)=>T}[]}
export async function deltaMinimize<T>(set:FeatureSet<T>,fails:(x:T)=>Promise<boolean>){
 let current=set.base,removed:string[]=[];
 for(const r of set.removers){const candidate=r.remove(current);if(await fails(candidate)){current=candidate;removed.push(r.name)}}
 return {minimal:current,removed};
}
