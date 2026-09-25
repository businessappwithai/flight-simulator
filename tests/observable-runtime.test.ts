import {expect,test} from "bun:test";
import {ScriptedDecisionEngine,DecisionEngineManager} from "@flight/decision-core";
import {OutcomeAwareStrategy,CognitivePilot} from "@flight/cognition";
import {InMemoryExperienceRepository} from "@flight/experience";
import {ObservableFlightRuntime} from "@flight/runtime";
import {defaultScenario} from "@flight/simulation";
test("observable runtime emits decisions outcomes and episode end",async()=>{
 const exp=new InMemoryExperienceRepository(),engine=new ScriptedDecisionEngine(["CLIMB","HOLD"]);
 const pilot=new CognitivePilot(new DecisionEngineManager(engine),new OutcomeAwareStrategy(),exp);
 const rt=new ObservableFlightRuntime(pilot),events:any[]=[];rt.events.subscribe(e=>events.push(e));
 await rt.run(defaultScenario(99n),400);
 expect(events.some(e=>e.type==="DECISION")).toBe(true);
 expect(events.some(e=>e.type==="OUTCOME"&&e.horizon==="1S")).toBe(true);
 expect(events.some(e=>e.type==="EPISODE_END")).toBe(true);
});
