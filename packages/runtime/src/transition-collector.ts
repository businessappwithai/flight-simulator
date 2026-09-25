import type { PilotIntent, RewardVector } from "@flight/protocol";
import type { SituationVector, WorldModelTransition } from "@flight/world-model";
export class TransitionCollector{
 #rows:WorldModelTransition[]=[];
 add(episodeId:string,tick:bigint,state:SituationVector,action:PilotIntent,reward:RewardVector,nextState:SituationVector,terminal:boolean){
  this.#rows.push({episodeId,tick:tick.toString(),state,action,reward,nextState,terminal});
 }
 rows(){return this.#rows.slice()}
}
