import type { Scenario } from "@flight/simulation";
export type FailurePredicate=(scenario:Scenario)=>Promise<boolean>;
export async function minimizeScenario(
 scenario:Scenario,candidates:readonly ((s:Scenario)=>Scenario)[],fails:FailurePredicate
):Promise<Scenario>{
 let current=scenario;
 for(const simplify of candidates){
   const proposed=simplify(current);
   if(await fails(proposed)) current=proposed;
 }
 return current;
}
