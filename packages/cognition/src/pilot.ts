import type { DecisionFrame, Observation, PilotIntent } from "@flight/protocol";
import { disagreementScore, type DecisionEngineManager } from "@flight/decision-core";
import { RingBuffer } from "@flight/memory";
import type { TemporalStrategy } from "./index.ts";
import type { ExperienceRepository } from "@flight/experience";
import { situationFingerprint } from "@flight/experience";

const CANDIDATES=["HOLD","TURN_LEFT","TURN_RIGHT","CLIMB","DESCEND","SLOW","REROUTE","ABORT"] as const;
export class CognitivePilot {
 readonly memory=new RingBuffer<DecisionFrame>(256);
 #seq=0;
 constructor(
  readonly engines:DecisionEngineManager,
  readonly temporal:TemporalStrategy,
  readonly experience:ExperienceRepository
 ){}
 async decide(observation:Observation):Promise<{intent:PilotIntent;probability:number;decisionId:string;disagreement:number}>{
  const temporal=this.temporal.summarize(this.memory.snapshot());
  const fingerprint=situationFingerprint(observation);
  const experiences=await this.experience.retrieve(fingerprint,5);
  const decisionId=`d-${++this.#seq}`;
  const result=await this.engines.decide({
   id:decisionId,
   context:{schemaVersion:1,observation,temporal:{recentActions:temporal.recentActions}},
   question:`Choose the safest useful maneuver. Similar experience: ${JSON.stringify(experiences)}`,
   candidates:CANDIDATES,timeoutMs:250
  });
  const top=result.primary.candidates[0];
  return {intent:(top?.value??"HOLD"),probability:top?.probability??0,decisionId,disagreement:disagreementScore(result)};
 }
 remember(frame:DecisionFrame){this.memory.push(frame);}
}
