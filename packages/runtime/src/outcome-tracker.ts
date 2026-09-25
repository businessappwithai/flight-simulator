import type { WorldSnapshot } from "@flight/protocol";
import { rewardBetween } from "@flight/benchmark";
import type { RuntimeEventBus, PendingOutcome } from "./telemetry.ts";
export class OutcomeTracker{
 #pending:PendingOutcome[]=[];
 constructor(readonly bus:RuntimeEventBus){}
 start(decisionId:string,before:WorldSnapshot){this.#pending.push({decisionId,before,startTick:before.tick})}
 observe(now:WorldSnapshot){
  for(const p of this.#pending){
   const d=Number(now.tick-p.startTick);
   if(d===1)this.bus.publish({type:"OUTCOME",decisionId:p.decisionId,horizon:"IMMEDIATE",reward:rewardBetween(p.before,now)});
   if(d===120)this.bus.publish({type:"OUTCOME",decisionId:p.decisionId,horizon:"1S",reward:rewardBetween(p.before,now)});
   if(d===360)this.bus.publish({type:"OUTCOME",decisionId:p.decisionId,horizon:"3S",reward:rewardBetween(p.before,now)});
  }
  this.#pending=this.#pending.filter(p=>Number(now.tick-p.startTick)<360);
 }
}
