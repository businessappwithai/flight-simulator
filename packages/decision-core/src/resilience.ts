import type { DecisionEngine, DecisionEngineHealth, DecisionRequest, DecisionResponse } from "./index.ts";
export interface CircuitState{failures:number;openUntil:number}
export class ResilientDecisionEngine implements DecisionEngine{
 readonly identity;
 #state:CircuitState={failures:0,openUntil:0};
 constructor(readonly primary:DecisionEngine,readonly fallback:DecisionEngine,readonly failureThreshold=3,readonly cooldownMs=5000){this.identity=primary.identity}
 async decide<T extends string>(r:DecisionRequest<T>):Promise<DecisionResponse<T>>{
  if(Date.now()<this.#state.openUntil)return this.fallback.decide(r);
  try{const x=await this.primary.decide(r);this.#state.failures=0;return x}catch{
   if(++this.#state.failures>=this.failureThreshold)this.#state.openUntil=Date.now()+this.cooldownMs;
   return this.fallback.decide(r);
  }
 }
 async health():Promise<DecisionEngineHealth>{if(Date.now()<this.#state.openUntil)return {healthy:false,detail:`circuit open after ${this.#state.failures} failures; using fallback ${this.fallback.identity.provider}`};return this.primary.health()}
}
