import type { DecisionEngine, DecisionRequest, DecisionResponse } from "@flight/decision-core";
export interface OpenJevTransport{invoke<T extends string>(request:DecisionRequest<T>):Promise<DecisionResponse<T>>}
export class OpenJevPlugin implements DecisionEngine{
 readonly identity={provider:"open-jev",model:"configured",version:"adapter-v1"};
 constructor(readonly transport:OpenJevTransport){}
 decide<T extends string>(request:DecisionRequest<T>){return this.transport.invoke(request)}
}
