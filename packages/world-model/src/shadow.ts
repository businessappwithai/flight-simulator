import type { PilotIntent, RewardVector } from "@flight/protocol";
import type { ActionPrediction } from "./index.ts";
const value=(r:RewardVector)=>r.survival*10+r.separation*4+r.objective*3+r.stability+r.efficiency;
export interface ShadowError {action:PilotIntent;horizonSeconds:number;rewardError:number;riskError:number;}
export function evaluateShadow(pred:readonly ActionPrediction[],actual:readonly {action:PilotIntent;horizonSeconds:number;reward:RewardVector;risk:number}[]):readonly ShadowError[]{
 const out:ShadowError[]=[];
 for(const p of pred){
  const a=actual.find(x=>x.action===p.action&&x.horizonSeconds===p.horizonSeconds);
  if(a)out.push({action:p.action,horizonSeconds:p.horizonSeconds,
   rewardError:Math.abs(value(p.predictedReward)-value(a.reward)),riskError:Math.abs(p.predictedRisk-a.risk)});
 }
 return out;
}
