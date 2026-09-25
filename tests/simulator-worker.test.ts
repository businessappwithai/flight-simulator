import {expect,test} from "bun:test";
import {DeterministicSimulation,defaultScenario,scenarioForSeed} from "@flight/simulation";
import {autopilotControls} from "@flight/controller";
function worker(){const w=new Worker(new URL("../apps/simulator/src/sim.worker.ts",import.meta.url).href,{type:"module"});const inbox:any[]=[];w.onmessage=e=>inbox.push(e.data);
 const next=async(type:string,from=0)=>{for(let i=0;i<400;i++){const hit=inbox.slice(from).find(x=>x.type===type);if(hit)return hit;await Bun.sleep(5)}throw new Error(`no ${type}`)};return {w,inbox,next}}
async function fly(scenario:"default"|"seeded",seed:string){
 const {w,inbox,next}=worker();try{
  w.postMessage({type:"RESET",seed,scenario});w.postMessage({type:"SET_PILOT",pilot:"AUTOPILOT"});await next("WORLD");
  let seq=0,last:any;for(let i=0;i<200;i++){const from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:++seq});last=await next("WORLD",from);expect(last.seq).toBe(seq);if(last.world.objective.phase!=="OUTBOUND"&&last.world.objective.phase!=="RETURN")break}
  const from=inbox.length;w.postMessage({type:"STEP",ticks:1,seq:0});const chk=await next("CHECKSUM",from);return {last,chk};
 }finally{w.terminate()}
}
async function direct(scenario:ReturnType<typeof defaultScenario>){const sim=new DeterministicSimulation();let w=sim.reset(scenario);for(let i=0;i<120*300;i++){w=sim.step(autopilotControls(w));if(w.objective.phase==="COMPLETE"||w.objective.phase==="FAILED")break}return {w,chk:await sim.checksum()}}
test("worker autopilot lands and matches a direct deterministic run bit for bit",async()=>{
 const {last,chk}=await fly("default","1"),ref=await direct(defaultScenario(1n));
 expect(last.world.objective.phase).toBe("COMPLETE");expect(last.autopilotMode).toBe("LANDED");expect(last.world.tick).toBe(ref.w.tick);expect(chk.checksum).toBe(ref.chk);
},30_000);
test("seeded scenario selection reaches the worker",async()=>{const {last,chk}=await fly("seeded","33"),ref=await direct(scenarioForSeed(33n));expect(last.scenarioId).toBe("seeded-33");expect(chk.checksum).toBe(ref.chk)},30_000);
test("manual intents fly the aircraft and pause freezes time",async()=>{const {w,inbox,next}=worker();try{
 w.postMessage({type:"RESET",seed:"1"});await next("WORLD");w.postMessage({type:"SET_PILOT",pilot:"MANUAL"});w.postMessage({type:"SET_INTENT",intent:"CLIMB"});
 let from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:1});const a=await next("WORLD",from);expect(a.pilot).toBe("MANUAL");expect(a.intent).toBe("CLIMB");expect(a.world.aircraft.position.y).toBeGreaterThan(5);expect(a.controls.elevator).toBeGreaterThan(0);
 w.postMessage({type:"PAUSE"});from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:2});const b=await next("WORLD",from+1);expect(b.paused).toBe(true);expect(b.world.tick).toBe(a.world.tick);
}finally{w.terminate()}});
test("bad commands are rejected with ERROR and do not break the worker",async()=>{const {w,inbox,next}=worker();try{
 for(const c of [{type:"RESET",seed:"-1"},{type:"RESET",seed:"12abc"},{type:"SET_INTENT",intent:"BARREL_ROLL"},{type:"SET_PILOT",pilot:"ROBOT"},{type:"NOPE"},{type:"RESTORE",snapshot:{}},null])w.postMessage(c);
 await Bun.sleep(100);expect(inbox.filter(x=>x.type==="ERROR")).toHaveLength(7);
 const from=inbox.length;w.postMessage({type:"STEP",ticks:1e9,seq:9});const ok=await next("WORLD",from);expect(ok.world.tick).toBe(240n);
}finally{w.terminate()}});
