import type { DecisionEngine, DecisionEngineHealth, DecisionRequest, DecisionResponse } from "@flight/decision-core";
export interface JevTransport { invoke<T extends string>(request:DecisionRequest<T>):Promise<DecisionResponse<T>>; health?():Promise<DecisionEngineHealth> }
export class JevDecisionEngine implements DecisionEngine{
 readonly identity={provider:"jev",model:"configured",version:"adapter-v1"};
 constructor(readonly transport:JevTransport){}
 decide<T extends string>(request:DecisionRequest<T>){return this.transport.invoke(request)}
 async health():Promise<DecisionEngineHealth>{return this.transport.health?.()??{healthy:true,detail:"transport exposes no health probe"}}
}
