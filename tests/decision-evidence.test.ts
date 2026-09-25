import {expect,test} from "bun:test";
import {ScriptedDecisionEngine,DecisionEngineManager,type DecisionEngine} from "@flight/decision-core";
import {OutcomeAwareStrategy,CognitivePilot,observationFeatures,OBSERVATION_FEATURES_V1} from "@flight/cognition";
import {InMemoryExperienceRepository} from "@flight/experience";
import {ObservableFlightRuntime,encodeTelemetry,decodeTelemetry} from "@flight/runtime";
import {defaultScenario} from "@flight/simulation";
import type {WorldModel} from "@flight/world-model";
import {LiveDashboardModel} from "../apps/inspector/src/live-dashboard.ts";
import {explanationIntegrity} from "../apps/inspector/src/explanation-integrity.ts";
const failing:DecisionEngine={identity:{provider:"open-jev",model:"broken",version:"1"},decide:async()=>{throw new Error("503 upstream")},health:async()=>({healthy:false})};
const dreamer:WorldModel={id:"dreamer-test",imagine:async(_s,actions,h)=>actions.flatMap(action=>h.map(horizonSeconds=>({action,horizonSeconds,predictedRisk:action==="DESCEND"?.9:.1,uncertainty:.05,predictedReward:{survival:1,separation:0,objective:0,stability:0,efficiency:0}})))};
async function fly(advisors:any){
 const pilot=new CognitivePilot(new DecisionEngineManager(new ScriptedDecisionEngine(["DESCEND","CLIMB"]),[new ScriptedDecisionEngine(["CLIMB"]),failing]),new OutcomeAwareStrategy(),new InMemoryExperienceRepository(),advisors);
 const rt=new ObservableFlightRuntime(pilot),events:any[]=[];rt.events.subscribe(e=>events.push(decodeTelemetry(encodeTelemetry(e))));await rt.run(defaultScenario(42n),90);return events;
}
test("runtime frames carry evidence end to end (through JSONL)",async()=>{
 const ev=await fly({bestPractice:{source:"xgb-v1",predict:async()=>[{action:"CLIMB",probability:.9},{action:"DESCEND",probability:.1}]},worldModel:dreamer});
 const first=ev.find(e=>e.type==="DECISION").frame,e=first.evidence;
 expect(e.model).toBe("scripted");expect(e.candidates[0]).toEqual({intent:"DESCEND",probability:1});expect(e.candidates).toHaveLength(8);
 expect(e.shadows).toEqual([{provider:"scripted",model:"scripted",top:"CLIMB",probability:1},{provider:"open-jev",model:"broken",error:"503 upstream"}]);
 expect(e.providerDisagreement).toBe(1);expect(e.fingerprint).toContain("ALT_VLOW");
 expect(e.bestPractice.status).toBe("OK");expect(e.worldModel.result).toHaveLength(16);
 expect(e.safetyReason).toBe("TERRAIN_CLEARANCE");
 const second=ev.filter(x=>x.type==="DECISION")[1].frame.evidence;expect(second.temporalPatterns[0]).toBe("recent: CLIMB");
});
test("dashboard explains every recorded source and integrity is complete",async()=>{
 const m=new LiveDashboardModel();for(const e of await fly({bestPractice:{source:"xgb-v1",predict:async()=>[{action:"CLIMB",probability:.9},{action:"DESCEND",probability:.1}]},worldModel:dreamer}))m.ingest(e);
 const d=m.decisions().at(-1)!,why=m.explain(d.decisionId)!.join("\n");
 expect(why).toContain("scripted/scripted requested DESCEND at 100.0%");
 expect(why).toContain("Shadow scripted/scripted preferred CLIMB");expect(why).toContain("Shadow open-jev/broken failed: 503 upstream");
 expect(why).toContain("XGBoost best-practice (xgb-v1) rates CLIMB most likely to succeed (90.0%); DESCEND 10.0%");
 expect(why).toContain("World model dreamer-test: DESCEND risk 0.90");expect(why).toContain("Safety changed DESCEND to CLIMB: TERRAIN_CLEARANCE");
 expect(explanationIntegrity(d).complete).toBe(true);
});
test("advisor failures and timeouts are recorded, never block or change the decision",async()=>{
 const slow={id:"dreamer-slow",imagine:()=>new Promise<never>(()=>{})} as WorldModel;
 const t0=performance.now();const ev=await fly({timeoutMs:20,worldModel:slow,bestPractice:{source:"xgb-x",predict:async()=>{throw new Error("model unavailable")}}});
 const e=ev.find(x=>x.type==="DECISION").frame;
 expect(e.requestedIntent).toBe("DESCEND");expect(e.evidence.worldModel).toMatchObject({status:"TIMEOUT",source:"dreamer-slow"});
 expect(e.evidence.bestPractice).toMatchObject({status:"ERROR",detail:"model unavailable"});expect(performance.now()-t0).toBeLessThan(2000);
 const m=new LiveDashboardModel();for(const x of ev)m.ingest(x);expect(m.explain(e.id)!.join(" ")).toContain("World model dreamer-slow timeout: no answer within 20ms");
});
test("advisors are omitted, not invented, when not configured",async()=>{const e=(await fly({})).find(x=>x.type==="DECISION").frame.evidence;expect(e.bestPractice).toBeUndefined();expect(e.worldModel).toBeUndefined()});
test("observation features are fixed-width and finite",()=>{const f=observationFeatures({tick:0n,speed:10,altitude:5,heading:1,objectivePhase:"RETURN"});expect(f).toHaveLength(OBSERVATION_FEATURES_V1.length);expect(f.every(Number.isFinite)).toBe(true);expect(f[4]).toBe(1000);expect(f[7]).toBe(1)});
test("outcomes flow back into temporal memory and the experience repository",async()=>{
 const exp=new InMemoryExperienceRepository(),pilot=new CognitivePilot(new DecisionEngineManager(new ScriptedDecisionEngine([])),new OutcomeAwareStrategy(),exp);
 const rt=new ObservableFlightRuntime(pilot),frames:any[]=[];rt.events.subscribe(e=>{if(e.type==="DECISION")frames.push(e.frame)});await rt.run(defaultScenario(42n),1500);
 expect(pilot.memory.snapshot().some(f=>f.outcome?.after3s)).toBe(true);
 expect(frames.some(f=>f.evidence.retrievedExperienceIds.length>0)).toBe(true);
 expect(frames.some(f=>f.evidence.temporalPatterns.some((p:string)=>p.startsWith("worked before")))).toBe(true);
});
