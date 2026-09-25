export interface Feature<T>{id:string;remove:(x:T)=>T}
export async function ddmin<T>(input:T,features:readonly Feature<T>[],fails:(x:T)=>Promise<boolean>):Promise<{value:T;removed:readonly string[]}>{
 let value=input;const removed:string[]=[];let changed=true;
 while(changed){changed=false;for(const f of features){if(removed.includes(f.id))continue;const candidate=f.remove(value);if(await fails(candidate)){value=candidate;removed.push(f.id);changed=true}}}
 return {value,removed};
}
