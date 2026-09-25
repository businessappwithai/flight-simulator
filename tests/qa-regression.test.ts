// Regressions for issues found by /qa on 2026-09-25.
// Report: .gstack/qa-reports/qa-report-flight-world-2026-09-25.md
import {expect,test} from "bun:test";
import {ScriptedDecisionEngine,DecisionEngineManager,ResilientDecisionEngine,compareResponses,topCandidate} from "@flight/decision-core";
import {JevDecisionEngine} from "@flight/decision-jev";
import {OpenJevPlugin} from "@flight/decision-open-jev";
import {OutcomeAwareStrategy,CognitivePilot} from "@flight/cognition";
import {InMemoryExperienceRepository,XGBoostBestPracticeClient} from "@flight/experience";
import {ObservableFlightRuntime} from "@flight/runtime";
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
import {PerfectSensorSuite} from "@flight/sensors";
import {parseFlightConfig} from "@flight/config";
import {ddmin} from "@flight/scenario-generator";
import {LiveDashboardModel} from "../apps/control-room/src/live-dashboard.ts";
import {explanationIntegrity} from "../apps/control-room/src/explanation-integrity.ts";
import {ReplayController} from "../apps/control-room/src/replay-controller.ts";
const req={id:"r",context:{schemaVersion:1} as any,question:"q",candidates:["HOLD","CLIMB","DESCEND"] as const,timeoutMs:250};
// ISSUE-014 — pilot flew HOLD whatever the provider recommended (took candidates[0], not the most probable)
test("pilot executes the provider's highest-probability intent",async()=>{const pilot=new CognitivePilot(new DecisionEngineManager(new ScriptedDecisionEngine(["DESCEND"])),new OutcomeAwareStrategy(),new InMemoryExperienceRepository());const obs=new PerfectSensorSuite().observe(new DeterministicSimulation().reset(defaultScenario(1n)));const d=await pilot.decide(obs);expect(d.intent).toBe("DESCEND");expect(d.probability).toBe(1)});
test("compareResponses compares top choices by probability, not position",async()=>{const a=await new ScriptedDecisionEngine(["CLIMB"]).decide(req),b=await new ScriptedDecisionEngine(["DESCEND"]).decide(req);expect(topCandidate(a)?.value).toBe("CLIMB");const c=compareResponses(a,b);expect(c.sameTopChoice).toBe(false);expect(c.shadowTop).toBe("DESCEND")});
test("safety overrides reach telemetry once the pilot follows the provider",async()=>{const pilot=new CognitivePilot(new DecisionEngineManager(new ScriptedDecisionEngine(["DESCEND"])),new OutcomeAwareStrategy(),new InMemoryExperienceRepository());const rt=new ObservableFlightRuntime(pilot),events:any[]=[];rt.events.subscribe(e=>events.push(e));await rt.run(defaultScenario(42n),60);expect(events.some(e=>e.type==="SAFETY_OVERRIDE"&&e.requested==="DESCEND")).toBe(true)});
// ISSUE-010 — adapters lacked health()
test("provider adapters and circuit breaker expose health()",async()=>{const t={invoke:async()=>{throw new Error("down")}} as any;const jev=new JevDecisionEngine(t);expect((await jev.health()).healthy).toBe(true);expect((await new OpenJevPlugin({...t,health:async()=>({healthy:false,detail:"x"})}).health()).healthy).toBe(false);const r=new ResilientDecisionEngine(jev,new ScriptedDecisionEngine([]),1,60_000);await r.decide(req);expect((await r.health()).healthy).toBe(false)});
// ISSUE-011 — zod 4 .default({}) skipped nested runtime defaults
test("config fills runtime defaults when runtime is omitted",()=>expect(parseFlightConfig({decision:{primary:{provider:"scripted",model:"x"}}}).runtime).toEqual({decisionIntervalTicks:30,maxEpisodeTicks:7200}));
// ISSUE-008 — ddmin never terminated when a removal kept failing
test("ddmin terminates and removes each feature at most once",async()=>{const r=await ddmin({a:true,b:true,c:true},["a","b","c"].map(id=>({id,remove:(x:any)=>({...x,[id]:false})})),async()=>true);expect([...r.removed].sort()).toEqual(["a","b","c"])});
// ISSUE-003/004/021 — dashboard must not invent evidence
test("canonical frame without recorded evidence is reported incomplete",()=>{const m=new LiveDashboardModel();m.ingest({type:"DECISION",frame:{id:"d",startTick:1n,requestedIntent:"CLIMB",executedIntent:"CLIMB",provider:"jev",probability:.8}});const d=m.latest()!;expect(d.model).toBe("unknown");expect(d.alternatives).toEqual([]);expect(explanationIntegrity(d).missing).toEqual(["model","alternatives"])});
// ISSUE-019 — replay state changes are observable (drives LIVE/REPLAY badge and Play label)
test("replay controller reports PAUSED then DONE",()=>{const states:string[]=[];const r=new ReplayController(()=>{},s=>states.push(s));r.loadJsonl('{"type":"EPISODE_END","tick":"1","phase":"COMPLETE","checksum":"c"}');r.step();r.step();expect(states).toEqual(["PAUSED","DONE"])});
// ISSUE-013 — predict() hung forever when the worker reported an error
test("XGBoost client rejects predict() before a model exists",async()=>{const c=new XGBoostBestPracticeClient();try{await expect(c.predict([0,0])).rejects.toThrow("best-practice model unavailable")}finally{c.dispose()}});
