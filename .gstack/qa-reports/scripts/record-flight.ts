// Records a real episode through ObservableFlightRuntime and writes JSONL telemetry for replay QA.
import {ScriptedDecisionEngine,DecisionEngineManager} from "@flight/decision-core";
import {OutcomeAwareStrategy,CognitivePilot} from "@flight/cognition";
import {InMemoryExperienceRepository} from "@flight/experience";
import {ObservableFlightRuntime,encodeTelemetry} from "@flight/runtime";
import {defaultScenario} from "@flight/simulation";
const engine=new ScriptedDecisionEngine(["CLIMB","DESCEND","DESCEND","TURN_LEFT","DESCEND","HOLD"]);
const pilot=new CognitivePilot(new DecisionEngineManager(engine),new OutcomeAwareStrategy(),new InMemoryExperienceRepository());
const rt=new ObservableFlightRuntime(pilot),lines:string[]=[];rt.events.subscribe(e=>lines.push(encodeTelemetry(e)));
const r=await rt.run(defaultScenario(42n),3000);
await Bun.write(process.argv[2]??".gstack/qa-reports/fixtures/flight-42.jsonl",lines.join("\n")+"\n");
const count=(t:string)=>lines.filter(l=>l.includes(`"type":"${t}"`)).length;
console.log(`phase=${r.world.objective.phase} ticks=${r.world.tick} events=${lines.length} decisions=${count("DECISION")} overrides=${count("SAFETY_OVERRIDE")} outcomes=${count("OUTCOME")} checksum=${r.checksum.slice(0,16)}`);
