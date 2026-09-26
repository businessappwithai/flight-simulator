// Regression: ISSUE-002 — saved learning loaded while the aircraft was parked on the runway never reached
// the page: a parked aircraft does not step, so no WORLD event carried the learned insight.
// Found by /qa on 2026-09-26
// Report: .gstack/qa-reports/qa-report-flight-world-2026-09-26.md
import {expect,test} from "bun:test";
import {PerfectSensorSuite} from "@flight/sensors";
import {situationFingerprint} from "@flight/experience/fingerprint";
test("loading learning publishes the insight for the parked aircraft without stepping",async()=>{
 const w=new Worker(new URL("../apps/simulator/src/sim.worker.ts",import.meta.url).href,{type:"module"});const inbox:any[]=[];w.onmessage=e=>inbox.push(e.data);
 const next=async(type:string,from=0)=>{for(let i=0;i<400;i++){const hit=inbox.slice(from).find(x=>x.type===type);if(hit)return hit;await Bun.sleep(5)}throw new Error(`no ${type}`)};
 try{
  w.postMessage({type:"RESET",seed:"1"});w.postMessage({type:"SET_LEARNING",enabled:true});await next("WORLD");
  const parked=inbox.filter(x=>x.type==="WORLD").at(-1);expect(parked.world.tick).toBe(0n);
  const runway=situationFingerprint(new PerfectSensorSuite().observe(parked.world));
  const from=inbox.length;w.postMessage({type:"LOAD_LEARNING",book:{version:2,flights:1,landings:1,crashes:0,manual:{flights:0,landings:0,crashes:0},autopilot:{flights:1,landings:1,crashes:0},entries:{[`${runway}|CLIMB`]:{visits:1,successes:1,failures:0,manual:0,autopilot:1}}}});
  const world=await next("WORLD",from);
  expect(world.world.tick).toBe(0n);expect(world.insight).toMatchObject({action:"CLIMB",successRate:1,visits:1});
 }finally{w.terminate()}
});
