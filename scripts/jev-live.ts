// Live Jev check (needs network access to api.typesafe.ai): JEV_API_KEY=… bun scripts/jev-live.ts
// Health, one decision at the runway and a few in the air through CognitivePilot, with the XGBoost fallback.
// The key is read from the environment only and never printed.
import {TypeSafeJevTransport,JevDecisionEngine} from "@flight/decision-jev";
import {DecisionEngineManager} from "@flight/decision-core";
import {CognitivePilot,NoMemoryStrategy} from "@flight/cognition";
import {InMemoryExperienceRepository} from "@flight/experience";
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
import {PerfectSensorSuite} from "@flight/sensors";
import {autopilotControls,autopilotIntent} from "@flight/controller";
const key=process.env.JEV_API_KEY?.trim();if(!key){console.error("Set JEV_API_KEY");process.exit(2)}
const transport=new TypeSafeJevTransport({apiKey:key}),engine=new JevDecisionEngine(transport);
const health=await engine.health();console.log("health",JSON.stringify(health));if(!health.healthy)process.exit(1);
const pilot=new CognitivePilot(new DecisionEngineManager(engine),new NoMemoryStrategy(),new InMemoryExperienceRepository(),
 {decisionTimeoutMs:8000,bestPractice:{source:"stub-xgb",predict:async()=>[{action:"HOLD",probability:.7}]}});
const sim=new DeterministicSimulation(),sensors=new PerfectSensorSuite();let w=sim.reset(defaultScenario(1n));const rows=[];
for(let t=0;t<120*40;t++){
 if(t%(120*5)===0){const o=sensors.observe(w),t0=performance.now(),d=await pilot.decide(o);
  rows.push({t:t/120,flown:autopilotIntent(w),jev:d.evidence.candidates[0],decided:d.intent,by:d.provider,ms:Math.round(performance.now()-t0),model:d.evidence.model});}
 w=sim.step(autopilotControls(w));
}
console.table(rows.map(r=>({t:r.t,flown:r.flown,jevTop:`${r.jev?.intent} ${((r.jev?.probability??0)*100).toFixed(0)}%`,decided:r.decided,by:r.by,ms:r.ms,model:r.model})));
const valid=rows.every(r=>r.jev&&r.jev.probability>=0&&r.jev.probability<=1);console.log(valid?"LIVE OK":"LIVE FAILED");process.exit(valid?0:1);
