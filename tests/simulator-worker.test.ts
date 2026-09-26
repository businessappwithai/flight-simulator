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
 let from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:1});const a=await next("WORLD",from);expect(a.pilot).toBe("MANUAL");expect(a.intent).toBe("CLIMB");expect(a.world.aircraft.position.y).toBeGreaterThan(5);expect(a.world.aircraft.velocity.y).toBeGreaterThan(3);
 w.postMessage({type:"PAUSE"});from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:2});const b=await next("WORLD",from+1);expect(b.paused).toBe(true);expect(b.world.tick).toBe(a.world.tick);
}finally{w.terminate()}});
test("bad commands are rejected with ERROR and do not break the worker",async()=>{const {w,inbox,next}=worker();try{
 for(const c of [{type:"RESET",seed:"-1"},{type:"RESET",seed:"12abc"},{type:"SET_INTENT",intent:"BARREL_ROLL"},{type:"SET_PILOT",pilot:"ROBOT"},{type:"NOPE"},{type:"RESTORE",snapshot:{}},null])w.postMessage(c);
 await Bun.sleep(100);expect(inbox.filter(x=>x.type==="ERROR")).toHaveLength(7);
 const from=inbox.length;w.postMessage({type:"STEP",ticks:1e9,seq:9});const ok=await next("WORLD",from);expect(ok.world.tick).toBe(240n);
}finally{w.terminate()}});
test("learning records a finished autopilot flight without changing the flight itself",async()=>{const {w,inbox,next}=worker();try{
 w.postMessage({type:"RESET",seed:"1",scenario:"default"});w.postMessage({type:"SET_PILOT",pilot:"AUTOPILOT"});w.postMessage({type:"SET_LEARNING",enabled:true});await next("WORLD");
 let seq=0,last:any;for(let i=0;i<200;i++){const from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:++seq});last=await next("WORLD",from);if(last.world.objective.phase==="COMPLETE"||last.world.objective.phase==="FAILED")break}
 const learned=inbox.filter(x=>x.type==="LEARNING");expect(learned).toHaveLength(1);expect(learned[0].reason).toBe("RECORDED");
 expect(learned[0].book).toMatchObject({flights:1,landings:1,crashes:0});expect(Object.keys(learned[0].book.entries).length).toBeGreaterThan(3);
 // Autopilot flying is learned as pilot intents, credited to the autopilot.
 expect(Object.keys(learned[0].book.entries).every((k:string)=>/\|(HOLD|CLIMB|DESCEND|TURN_LEFT|TURN_RIGHT|SLOW)$/.test(k))).toBe(true);
 expect(learned[0].book).toMatchObject({autopilot:{flights:1,landings:1},manual:{flights:0}});
 const traces=inbox.filter(x=>x.type==="TRACE");expect(traces).toHaveLength(1);expect(traces[0].trace).toMatchObject({outcome:"LANDED",pilots:["AUTOPILOT"]});
 const from=inbox.length;w.postMessage({type:"STEP",ticks:1,seq:0});const chk=await next("CHECKSUM",from);const ref=await direct(defaultScenario(1n));
 expect(chk.checksum).toBe(ref.chk);expect(inbox.filter(x=>x.type==="LEARNING")).toHaveLength(1);
 // The next flight starts from what was learned: the worker reports the best action for the runway situation.
 w.postMessage({type:"RESET",seed:"1",scenario:"default"});const f2=inbox.length;w.postMessage({type:"STEP",ticks:1,seq:++seq});const again=await next("WORLD",f2);
 expect(again.learning).toBe(true);expect(again.insight).toMatchObject({action:"CLIMB",autopilot:1,manual:0});
}finally{w.terminate()}},30_000);
test("learning is off by default, loads saved books, rejects corrupt ones and can be cleared",async()=>{const {w,inbox,next}=worker();try{
 w.postMessage({type:"RESET",seed:"1"});const first=await next("WORLD");expect(first.learning).toBe(false);expect(first.insight).toBeUndefined();
 w.postMessage({type:"LOAD_LEARNING",book:{version:2,flights:2,landings:1,crashes:1,manual:{flights:1,landings:0,crashes:1},autopilot:{flights:1,landings:1,crashes:0},entries:{"X|HOLD":{visits:2,successes:1,failures:1,manual:1,autopilot:1}}}});
 expect(await next("LEARNING")).toMatchObject({reason:"LOADED",book:{flights:2}});
 let from=inbox.length;w.postMessage({type:"LOAD_LEARNING",book:{version:1,flights:"lots"}});expect(await next("LEARNING",from)).toMatchObject({reason:"REJECTED",book:{flights:0}});
 from=inbox.length;w.postMessage({type:"CLEAR_LEARNING"});expect(await next("LEARNING",from)).toMatchObject({reason:"CLEARED",book:{flights:0,entries:{}}});
 from=inbox.length;w.postMessage({type:"SET_LEARNING",enabled:"yes"});expect((await next("ERROR",from)).message).toMatch(/invalid learning flag/);
}finally{w.terminate()}});
test("a flight flown manually then on autopilot teaches and traces both pilots",async()=>{const {w,inbox,next}=worker();try{
 w.postMessage({type:"RESET",seed:"1",scenario:"default"});w.postMessage({type:"SET_LEARNING",enabled:true});w.postMessage({type:"SET_PILOT",pilot:"MANUAL"});w.postMessage({type:"SET_INTENT",intent:"CLIMB"});await next("WORLD");
 let seq=0,last:any;for(let i=0;i<3;i++){const from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:++seq});last=await next("WORLD",from)} // 6 s of manual climb
 expect(last.pilot).toBe("MANUAL");w.postMessage({type:"SET_PILOT",pilot:"AUTOPILOT"});
 for(let i=0;i<200;i++){const from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:++seq});last=await next("WORLD",from);if(last.world.objective.phase==="COMPLETE"||last.world.objective.phase==="FAILED")break}
 expect(last.world.objective.phase).toBe("COMPLETE");await next("TRACE");
 const book=inbox.find(x=>x.type==="LEARNING").book;
 expect(book).toMatchObject({flights:1,landings:1,manual:{flights:1,landings:1},autopilot:{flights:1,landings:1}});
 const e=Object.values(book.entries) as any[];expect(e.some(x=>x.manual>0)).toBe(true);expect(e.some(x=>x.autopilot>0)).toBe(true);
 const trace=inbox.find(x=>x.type==="TRACE").trace,frames=trace.events.filter((x:any)=>x.type==="DECISION").map((x:any)=>x.frame);
 expect(trace).toMatchObject({outcome:"LANDED",pilots:["MANUAL","AUTOPILOT"]});
 expect(frames[0]).toMatchObject({provider:"manual",executedIntent:"CLIMB",startTick:0n,outcome:{terminal:{objective:1}}});
 expect(frames.some((f:any)=>f.provider==="autopilot")).toBe(true);
 const end=trace.events.at(-1);const from=inbox.length;w.postMessage({type:"STEP",ticks:1,seq:0});const chk=await next("CHECKSUM",from);
 expect(end).toMatchObject({type:"EPISODE_END",phase:"COMPLETE",checksum:chk.checksum});
}finally{w.terminate()}},30_000);
test("a restarted manual flight leaves an ABANDONED trace but teaches nothing",async()=>{const {w,inbox,next}=worker();try{
 w.postMessage({type:"RESET",seed:"1"});w.postMessage({type:"SET_LEARNING",enabled:true});w.postMessage({type:"SET_PILOT",pilot:"MANUAL"});w.postMessage({type:"SET_INTENT",intent:"CLIMB"});await next("WORLD");
 let from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:1});await next("WORLD",from);w.postMessage({type:"SET_INTENT",intent:"TURN_LEFT"});
 from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:2});await next("WORLD",from);
 from=inbox.length;w.postMessage({type:"RESET",seed:"1"});const t=(await next("TRACE",from)).trace;
 expect(t).toMatchObject({outcome:"ABANDONED",pilots:["MANUAL"]});
 const frames=t.events.filter((x:any)=>x.type==="DECISION").map((x:any)=>x.frame);
 expect(frames.map((f:any)=>f.executedIntent)).toEqual(["CLIMB","TURN_LEFT"]);expect(frames.every((f:any)=>f.outcome===undefined)).toBe(true);
 expect(t.events.at(-1)).toMatchObject({type:"EPISODE_END",tick:"480",phase:"OUTBOUND"});expect(t.events.at(-1).checksum).toMatch(/^[0-9a-f]{64}$/);
 expect(inbox.some(x=>x.type==="LEARNING")).toBe(false);
 // Clearing learning discards the flight in progress, so a cleared trace store is not refilled by the restart that follows.
 from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:3});await next("WORLD",from);w.postMessage({type:"CLEAR_LEARNING"});w.postMessage({type:"RESET",seed:"1"});
 await Bun.sleep(100);expect(inbox.slice(from).some(x=>x.type==="TRACE")).toBe(false);
}finally{w.terminate()}},30_000);
test("without learning (no Jev key) flights are neither learned nor traced",async()=>{const {w,inbox,next}=worker();try{
 w.postMessage({type:"RESET",seed:"1"});w.postMessage({type:"SET_PILOT",pilot:"MANUAL"});w.postMessage({type:"SET_INTENT",intent:"CLIMB"});await next("WORLD");
 const from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:1});await next("WORLD",from);w.postMessage({type:"RESET",seed:"1"});await Bun.sleep(100);
 expect(inbox.some(x=>x.type==="TRACE"||x.type==="LEARNING")).toBe(false);
}finally{w.terminate()}});
test("the Jev copilot switches with SET_JEV and never changes the flight, even when Jev is unreachable",async()=>{const {w,inbox,next}=worker();try{
 w.postMessage({type:"RESET",seed:"1",scenario:"default"});w.postMessage({type:"SET_PILOT",pilot:"AUTOPILOT"});w.postMessage({type:"SET_LEARNING",enabled:true});await next("WORLD");
 let from=inbox.length;w.postMessage({type:"SET_JEV",apiKey:"not-a-real-key-000"});const on=await next("WORLD",from);expect(on.copilotStatus).toMatchObject({jev:"READY"});
 // An unreachable endpoint (the key goes nowhere real): the copilot reports it; the autopilot flies on regardless.
 let seq=0,last:any;for(let i=0;i<200;i++){from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:++seq});last=await next("WORLD",from);if(last.world.objective.phase==="COMPLETE"||last.world.objective.phase==="FAILED")break}
 expect(last.world.objective.phase).toBe("COMPLETE");
 from=inbox.length;w.postMessage({type:"STEP",ticks:1,seq:0});const chk=await next("CHECKSUM",from);expect(chk.checksum).toBe((await direct(defaultScenario(1n))).chk);
 from=inbox.length;w.postMessage({type:"SET_JEV",apiKey:null});const off=await next("WORLD",from);expect(off.copilotStatus).toBeUndefined();
 from=inbox.length;w.postMessage({type:"SET_JEV",apiKey:42});expect((await next("ERROR",from)).message).toBe("invalid Jev key");
}finally{w.terminate()}},60_000);
