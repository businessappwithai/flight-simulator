import {expect,test} from "bun:test";
import {ScriptedDecisionEngine,DecisionEngineManager} from "@flight/decision-core";
import {OutcomeAwareStrategy,CognitivePilot} from "@flight/cognition";
import {InMemoryExperienceRepository} from "@flight/experience";
import {FlightRuntime} from "@flight/runtime";
import {defaultScenario} from "@flight/simulation";
test("cognition controls deterministic runtime through semantic intents",async()=>{
 const exp=new InMemoryExperienceRepository();
 const engine=new ScriptedDecisionEngine(["CLIMB","HOLD","HOLD"]);
 const pilot=new CognitivePilot(new DecisionEngineManager(engine),new OutcomeAwareStrategy(),exp);
 const runtime=new FlightRuntime(pilot,exp);
 const r=await runtime.run(defaultScenario(123n),240);
 expect(r.decisions.length).toBeGreaterThan(0);expect(r.checksum).toHaveLength(64);
});
