import {TypeSafeClient,choice,type Fetch} from "@typesafe-ai/sdk";
import type {DecisionEngineHealth,DecisionRequest,DecisionResponse} from "@flight/decision-core";
import type {JevTransport} from "./index.ts";
/** What each semantic intent means, as the choice criteria Jev weighs. */
export const INTENT_CRITERIA:Readonly<Record<string,string>>={
 HOLD:"Keep the current heading and height.",
 TURN_LEFT:"Bank left and turn at a steady rate while holding height.",
 TURN_RIGHT:"Bank right and turn at a steady rate while holding height.",
 CLIMB:"Pitch up and climb at a steady rate.",
 DESCEND:"Pitch down and descend at a steady rate.",
 SLOW:"Reduce power and slow down while holding height.",
 REROUTE:"Turn away onto a new route around a hazard.",
 ABORT:"Climb away at full power to abandon the current approach or manoeuvre."
};
/** Jev takes plain JSON: bigint ticks become decimal strings. */
export const jevState=(x:unknown)=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==="bigint"?v.toString():v));
export interface TypeSafeJevOptions{
 apiKey:string;
 /** Jev model; the API defaults to `jev-latest`. */
 model?:string;baseURL?:string;fetch?:Fetch;
 /** Browser use exposes the key to the page's user (the simulator keeps it in that user's own localStorage). */
 browser?:boolean;
 /** Test seam: a client with the same `systemOne` / `models.list` surface. */
 client?:Pick<TypeSafeClient,"systemOne"|"models">;
}
/**
 * TypeSafe Jev over the official SDK: one `choice` question whose criteria are the candidate intents.
 * Jev's per-label probabilities become the DecisionResponse candidates, so its confidence is the top
 * probability. Physics never waits for it: callers give each request its own timeout budget, and the
 * request is not retried (a late answer is useless to a flying aircraft).
 */
export class TypeSafeJevTransport implements JevTransport{
 readonly #client:Pick<TypeSafeClient,"systemOne"|"models">;readonly #model?:string;
 constructor(o:TypeSafeJevOptions){
  if(!o.client&&!o.apiKey?.trim())throw new Error("Jev API key is required");
  this.#model=o.model;
  this.#client=o.client??new TypeSafeClient({apiKey:o.apiKey.trim(),baseURL:o.baseURL,fetch:o.fetch,dangerouslyAllowBrowser:o.browser,logLevel:"off",retry:{maxRetries:0}});
 }
 async invoke<T extends string>(request:DecisionRequest<T>):Promise<DecisionResponse<T>>{
  const started=performance.now();
  const criteria=Object.fromEntries(request.candidates.map(c=>[c,INTENT_CRITERIA[c]??c])) as Record<T,string>;
  const r=await this.#client.systemOne({state:jevState(request.context),questions:{maneuver:choice(request.question,criteria)},...(this.#model?{model:this.#model}:{})},
   {timeout:request.timeoutMs,retry:{maxRetries:0}});
  const probs=(r.answers.maneuver?.probabilities??{}) as Record<string,number>;
  return {requestId:request.id,engine:{provider:"jev",model:r.model,version:"typesafe-sdk"},latencyMs:performance.now()-started,
   candidates:request.candidates.map(value=>({value,probability:Number(probs[value]??0)})).sort((a,b)=>b.probability-a.probability)};
 }
 async health():Promise<DecisionEngineHealth>{
  try{const models=await this.#client.models.list({timeout:5000});return {healthy:true,detail:`${models.length} models: ${models.map(m=>m.name).join(", ")}`}}
  catch(e){return {healthy:false,detail:e instanceof Error?e.message:String(e)}}
 }
}
