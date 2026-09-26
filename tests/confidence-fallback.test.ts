import {expect,test} from "bun:test";
import type {Observation,PilotIntent} from "@flight/protocol";
import {DecisionEngineManager,type DecisionEngine} from "@flight/decision-core";
import {CognitivePilot,DEFAULT_MIN_PROVIDER_CONFIDENCE,NoMemoryStrategy,observationFeatures} from "@flight/cognition";
import {InMemoryExperienceRepository,XGBoostBestPracticeClient,type BestPracticeExample} from "@flight/experience";
import {ObservableFlightRuntime,encodeTelemetry,decodeTelemetry} from "@flight/runtime";
import {defaultScenario} from "@flight/simulation";
import {parseFlightConfig} from "@flight/config";
import {LiveDashboardModel} from "../apps/control-room/src/live-dashboard.ts";
/** A Jev-like engine answering with a fixed distribution over the candidates. */
const jev=(dist:Partial<Record<PilotIntent,number>>):DecisionEngine=>({identity:{provider:"jev",model:"test",version:"1"},health:async()=>({healthy:true}),
 decide:async r=>({requestId:r.id,engine:{provider:"jev",model:"test",version:"1"},latencyMs:1,candidates:r.candidates.map(value=>({value,probability:dist[value as PilotIntent]??0}))})});
const xgb=(ranked:{action:PilotIntent;probability:number}[])=>({source:"xgb-v1",predict:async()=>ranked});
const obs:Observation={tick:0n,speed:30,altitude:40,heading:0,objectivePhase:"OUTBOUND",nearestObstacle:{distance:300,bearing:.2},attitude:{pitch:0,roll:0,verticalSpeed:0}};
const pilot=(dist:Partial<Record<PilotIntent,number>>,advisors:any)=>new CognitivePilot(new DecisionEngineManager(jev(dist)),new NoMemoryStrategy(),new InMemoryExperienceRepository(),advisors);
const unsure={HOLD:.3,TURN_LEFT:.25,DESCEND:.25,CLIMB:.2},sure={HOLD:.9,CLIMB:.1};
test("low Jev confidence: the XGBoost best-practice model decides",async()=>{
 const d=await pilot(unsure,{bestPractice:xgb([{action:"CLIMB",probability:.82},{action:"HOLD",probability:.4}])}).decide(obs);
 expect(d).toMatchObject({intent:"CLIMB",probability:.82,provider:"xgb-v1"});
 expect(d.evidence.selection).toMatchObject({source:"BEST_PRACTICE",providerConfidence:.3,threshold:DEFAULT_MIN_PROVIDER_CONFIDENCE});
 expect(d.evidence.selection!.reason).toMatch(/jev confidence 30% was below 50%.*xgb-v1.*CLIMB at 82%/);
 expect(d.evidence.candidates[0]).toEqual({intent:"HOLD",probability:.3}); // Jev's own view is still recorded
});
test("confident Jev decides, whatever the model says",async()=>{
 const d=await pilot(sure,{bestPractice:xgb([{action:"CLIMB",probability:.99}])}).decide(obs);
 expect(d).toMatchObject({intent:"HOLD",probability:.9,provider:"jev"});expect(d.evidence.selection).toMatchObject({source:"PROVIDER",providerConfidence:.9});
});
test("exactly at the threshold counts as confident",async()=>{
 const d=await pilot({HOLD:.5,CLIMB:.5},{bestPractice:xgb([{action:"DESCEND",probability:.9}])}).decide(obs);expect(d.provider).toBe("jev");
});
test("without a usable model, low-confidence Jev is kept and the reason says why",async()=>{
 const none=await pilot(unsure,{}).decide(obs);
 expect(none).toMatchObject({intent:"HOLD",provider:"jev"});expect(none.evidence.selection!.reason).toMatch(/no best-practice model is configured/);
 const broken=await pilot(unsure,{bestPractice:{source:"xgb-v1",predict:async()=>{throw new Error("model unavailable")}}}).decide(obs);
 expect(broken).toMatchObject({intent:"HOLD",provider:"jev"});expect(broken.evidence.selection!.reason).toMatch(/unavailable \(model unavailable\)/);
 const empty=await pilot(unsure,{bestPractice:xgb([])}).decide(obs);expect(empty.provider).toBe("jev");expect(empty.evidence.selection!.reason).toMatch(/returned no ranking/);
});
test("the threshold is configurable",async()=>{
 expect((await pilot(unsure,{minProviderConfidence:.25,bestPractice:xgb([{action:"CLIMB",probability:.8}])}).decide(obs)).provider).toBe("jev");
 expect((await pilot(sure,{minProviderConfidence:.95,bestPractice:xgb([{action:"CLIMB",probability:.8}])}).decide(obs)).intent).toBe("CLIMB");
 expect(parseFlightConfig({decision:{primary:{provider:"jev",model:"m"}}}).decision.minProviderConfidence).toBe(.5);
 expect(()=>parseFlightConfig({decision:{primary:{provider:"jev",model:"m"},minProviderConfidence:1.5}})).toThrow();
});
test("runtime frames credit the model and the Control Room explains the fallback",async()=>{
 const rt=new ObservableFlightRuntime(pilot(unsure,{bestPractice:xgb([{action:"CLIMB",probability:.82}])})),events:any[]=[];
 rt.events.subscribe(e=>events.push(decodeTelemetry(encodeTelemetry(e))));await rt.run(defaultScenario(7n),60);
 const frame=events.find(e=>e.type==="DECISION").frame;
 expect(frame).toMatchObject({provider:"xgb-v1",requestedIntent:"CLIMB",probability:.82,evidence:{selection:{source:"BEST_PRACTICE"}}});
 const m=new LiveDashboardModel();for(const e of events)m.ingest(e);
 expect(m.explain(frame.id)![0]).toMatch(/^Low-confidence fallback: jev confidence 30% was below 50%/);
});
test("a trained XGBoost model's learning takes the decision when Jev is unsure",async()=>{
 // Learned: at low altitude CLIMB ends well and DESCEND ends badly; the model must pick CLIMB for Jev's unsure HOLD.
 const features=observationFeatures(obs),examples:BestPracticeExample[]=[];
 for(let i=0;i<60;i++)for(const [action,success] of [["CLIMB",true],["DESCEND",false],["HOLD",i%2===0],["TURN_LEFT",false]] as const)
  examples.push({features:features.map((v,k)=>v+(k===0?(i%7)-3:0)),action,reward:success?1:-1,regret:success?0:1,success,safetyOverride:false,catastrophic:false});
 const c=new XGBoostBestPracticeClient();try{
  await c.train("fallback-t1",examples,60);
  const d=await pilot(unsure,{bestPractice:{source:"xgb:fallback-t1",predict:(f:readonly number[])=>c.predict(f)},timeoutMs:5000}).decide(obs);
  expect(d.provider).toBe("xgb:fallback-t1");expect(d.intent).toBe("CLIMB");expect(d.probability).toBeGreaterThan(.8);
 }finally{c.dispose()}
},60_000);
