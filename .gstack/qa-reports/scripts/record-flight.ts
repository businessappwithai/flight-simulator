// Records a real, deterministic replay fixture:
//  1) a training flight whose decision outcomes train the real XGBoost outcome model;
//  2) the recorded flight, with a scripted primary, a scripted shadow provider and the trained XGBoost as advisor.
// No world model is configured, so Dreamer evidence is honestly absent. Usage: bun record-flight.ts out.jsonl [seed]
import {ScriptedDecisionEngine,DecisionEngineManager} from "@flight/decision-core";
import {OutcomeAwareStrategy,CognitivePilot,observationFeatures} from "@flight/cognition";
import {InMemoryExperienceRepository,XGBoostBestPracticeClient,type BestPracticeExample} from "@flight/experience";
import {ObservableFlightRuntime,encodeTelemetry,type RuntimeEvent} from "@flight/runtime";
import {defaultScenario} from "@flight/simulation";
import type {Observation, PilotIntent} from "@flight/protocol";
const seed=BigInt(process.argv[3]??"42"),plan:PilotIntent[]=["CLIMB","DESCEND","DESCEND","TURN_LEFT","DESCEND","HOLD","TURN_RIGHT","CLIMB","SLOW","HOLD"];
/** Wraps an advisor so the features it saw can be paired with the decision's outcome for training. */
function capture(){let last:number[]=[];return {source:"capture",features:()=>last,predict:async(f:readonly number[])=>{last=[...f];return []}}}
async function fly(primary:string[],advisor:{source:string;predict:(f:readonly number[])=>Promise<any>},onEvent:(e:RuntimeEvent)=>void){
 const pilot=new CognitivePilot(new DecisionEngineManager(new ScriptedDecisionEngine(primary),[new ScriptedDecisionEngine([...primary].reverse())]),new OutcomeAwareStrategy(),new InMemoryExperienceRepository(),{bestPractice:advisor,timeoutMs:2000});
 const rt=new ObservableFlightRuntime(pilot);rt.events.subscribe(onEvent);return rt.run(defaultScenario(seed),3000);
}
// 1) training flight
const cap=capture(),feat=new Map<string,{features:number[];action:PilotIntent;override:boolean}>(),examples:BestPracticeExample[]=[];
await fly(Array.from({length:100},(_,i)=>plan[i%plan.length]!),cap,e=>{
 if(e.type==="DECISION")feat.set(e.frame.id,{features:cap.features(),action:e.frame.requestedIntent,override:false});
 if(e.type==="SAFETY_OVERRIDE"){const x=feat.get(e.decisionId);if(x)x.override=true}
 if(e.type==="OUTCOME"&&e.horizon==="3S"){const x=feat.get(e.decisionId);if(x){const r=e.reward,ok=r.survival>=1&&r.separation>0;examples.push({features:x.features,action:x.action,reward:r.survival+r.separation+r.objective+r.stability+r.efficiency,regret:ok?0:1,success:ok,safetyOverride:x.override,catastrophic:r.survival<1})}}
});
const xgb=new XGBoostBestPracticeClient(),model=await xgb.train("bp-flight-train-1",examples,80);
// 2) recorded flight with the trained model as advisor
const lines:string[]=[];
const r=await fly(plan.slice(0,6),{source:model.version,predict:f=>xgb.predict(f)},e=>lines.push(encodeTelemetry(e)));xgb.dispose();
await Bun.write(process.argv[2]??"flight.jsonl",lines.join("\n")+"\n");
const count=(t:string)=>lines.filter(l=>l.includes(`"type":"${t}"`)).length;
console.log(`training rows=${model.rows} | recorded phase=${r.world.objective.phase} events=${lines.length} decisions=${count("DECISION")} overrides=${count("SAFETY_OVERRIDE")} outcomes=${count("OUTCOME")} checksum=${r.checksum.slice(0,16)}`);
