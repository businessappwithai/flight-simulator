import type { PilotIntent } from "@flight/protocol";
import type { ActionPrediction, SituationVector, WorldModel } from "./index.ts";
export class HttpWorldModel implements WorldModel{
 readonly id:string;
 constructor(readonly endpoint:string,id="dreamer-http"){this.id=id}
 async imagine(state:SituationVector,actions:readonly PilotIntent[],horizons:readonly number[]):Promise<readonly ActionPrediction[]>{
  const r=await fetch(`${this.endpoint.replace(/\/$/,"")}/imagine`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({state,actions,horizons})});
  if(!r.ok)throw new Error(`world model HTTP ${r.status}`);
  return await r.json() as ActionPrediction[];
 }
}
