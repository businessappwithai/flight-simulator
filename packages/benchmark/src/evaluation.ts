import type { PilotIntent, RewardVector, WorldSnapshot } from "@flight/protocol";

export interface HorizonOutcome { horizonSeconds:number; reward:RewardVector; }
export interface DecisionEvaluation {
  decisionId:string; selected:PilotIntent; probability:number;
  horizons:readonly HorizonOutcome[]; bestCounterfactual?:PilotIntent; regret?:number;
}
export const scalarReward=(r:RewardVector)=>
  r.survival*10+r.separation*4+r.objective*3+r.stability+r.efficiency;
export const decisionRegret=(actual:RewardVector, alternatives:readonly {action:PilotIntent;reward:RewardVector}[])=>{
  if(!alternatives.length)return {};
  const best=[...alternatives].sort((a,b)=>scalarReward(b.reward)-scalarReward(a.reward))[0]!;
  return {bestCounterfactual:best.action,regret:Math.max(0,scalarReward(best.reward)-scalarReward(actual))};
};
export function rewardBetween(before:WorldSnapshot,after:WorldSnapshot):RewardVector{
 const obstacle=after.entities.find(e=>e.kind==="OBSTACLE");
 const sep=obstacle?Math.hypot(after.aircraft.position.x-obstacle.position.x,after.aircraft.position.y-obstacle.position.y,after.aircraft.position.z-obstacle.position.z):1000;
 const speed=Math.hypot(after.aircraft.velocity.x,after.aircraft.velocity.y,after.aircraft.velocity.z);
 return {
  survival:after.aircraft.crashed?-10:1,
  separation:Math.min(2,sep/100)-1,
  objective:after.objective.phase==="COMPLETE"?10:after.objective.checkpointReached&&!before.objective.checkpointReached?3:0,
  stability:1-Math.min(1,Math.abs(after.aircraft.roll)+Math.abs(after.aircraft.pitch)),
  efficiency:Math.max(-1,1-Math.abs(speed-35)/35)
 };
}
