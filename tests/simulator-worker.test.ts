import {expect,test} from "bun:test";
import {DeterministicSimulation,defaultScenario,scenarioForSeed} from "@flight/simulation";
import type {Observation,PilotIntent} from "@flight/protocol";
import {decisionPilot,standInPolicy,serveStandInJev,type StandInJev} from "./jev-stand-in.ts";
function worker(){const w=new Worker(new URL("../apps/simulator/src/sim.worker.ts",import.meta.url).href,{type:"module"});const inbox:any[]=[];w.onmessage=e=>inbox.push(e.data);
 const next=async(type:string,from=0)=>{for(let i=0;i<400;i++){const hit=inbox.slice(from).find(x=>x.type===type);if(hit)return hit;await Bun.sleep(5)}throw new Error(`no ${type}`)};return {w,inbox,next}}
/** Waits (up to 5 s) for a condition on the worker's messages; the worker may still be loading its airport catalogue. */
async function until(ok:()=>boolean){for(let i=0;i<500&&!ok();i++)await Bun.sleep(10)}
/** Jev for the worker: a stand-in Jev service on localhost (SET_JEV with its base URL). */
const jevOn=(w:Worker,jev:StandInJev)=>w.postMessage({type:"SET_JEV",apiKey:"test-key",baseUrl:jev.url});
/** The WORLD that answers STEP `seq` (other WORLD events, e.g. from tile loads, may arrive in between). */
async function reply(inbox:any[],seq:number,from:number){for(let i=0;i<4000;i++){const hit=inbox.slice(from).find(x=>x.type==="WORLD"&&x.seq===seq);if(hit)return hit;await Bun.sleep(i<50?0:2)}throw new Error(`no WORLD for STEP ${seq}`)}
let stepSeq=0;
/** Steps the worker (up to 240 ticks a STEP) until `stop`, the flight ends, or exactly `maxTick`. `each` sees every reply. */
async function stepUntil(w:Worker,inbox:any[],_next:unknown,maxTick:bigint,stop:(e:any)=>boolean=()=>false,each:(e:any)=>void=()=>{}){
 let last:any,tick=0n;
 for(let i=0;i<60_000;i++){const from=inbox.length,left=maxTick-tick,seq=++stepSeq;w.postMessage({type:"STEP",ticks:Number(left<240n?left:240n),seq});last=await reply(inbox,seq,from);tick=last.world.tick;each(last);
  if(last.geo?.holding||last.geo?.state==="LOADING"){await Bun.sleep(2);continue}
  if(stop(last)||tick>=maxTick||last.world.objective.phase==="COMPLETE"||last.world.objective.phase==="FAILED")break}
 return last;
}
const checksumOf=async(w:Worker,inbox:any[],next:(t:string,f?:number)=>Promise<any>)=>{const from=inbox.length;w.postMessage({type:"STEP",ticks:0,seq:0});return (await next("CHECKSUM",from)).checksum as string};
/**
 * The same flight without the worker: intents from `decide` at the same ticks (every decisionTicks(intent)), flown by
 * the intent controller, up to `ticks`. The worker's autopilot must match it bit for bit.
 */
async function direct(scenario:ReturnType<typeof defaultScenario>,ticks:bigint,decide:(o:Observation)=>PilotIntent=standInPolicy){
 const sim=new DeterministicSimulation(),pilot=decisionPilot(undefined,decide);let w=sim.reset(scenario);
 while(w.tick<ticks&&w.objective.phase!=="COMPLETE"&&w.objective.phase!=="FAILED")w=sim.step(pilot(w));
 return {w,chk:await sim.checksum()};
}
async function flyJev(scenario:"default"|"seeded",seed:string,jev:StandInJev,ticks:bigint,learning=false){
 const {w,inbox,next}=worker();try{
  jevOn(w,jev);w.postMessage({type:"RESET",seed,scenario});if(learning)w.postMessage({type:"SET_LEARNING",enabled:true});w.postMessage({type:"SET_PILOT",pilot:"AUTOPILOT"});await next("WORLD");
  const last=await stepUntil(w,inbox,next,ticks);return {last,chk:await checksumOf(w,inbox,next),inbox};
 }finally{w.terminate()}
}
test("the autopilot flies Jev's decisions: the same flight as those intents flown directly, however slowly Jev answers",async()=>{
 const fast=await serveStandInJev(),slow=await serveStandInJev({delayMs:()=>Math.floor(Math.random()*25)});
 try{
  const a=await flyJev("default","1",fast,3600n,true),b=await flyJev("default","1",slow,3600n),ref=await direct(defaultScenario(1n),3600n);
  expect(a.last.world.tick).toBe(3600n);expect(a.last.pilot).toBe("AUTOPILOT");expect(a.chk).toBe(ref.chk);expect(b.chk).toBe(ref.chk);
  expect(a.last.world.objective.phase).toBe("RETURN"); // the (stand-in) Jev's decisions took it through the gate
  expect(fast.calls).toBeGreaterThan(40);expect(fast.observations[0]).toMatchObject({objectivePhase:"OUTBOUND",altitude:2});
  // Each decision is published with where it came from, and what was flown is what Jev asked for.
  const decisions=a.inbox.filter(x=>x.type==="WORLD"&&x.copilot).map(x=>x.copilot);
  expect(decisions.length).toBeGreaterThan(5);expect(decisions.every((d:any)=>d.source==="JEV"&&d.provider==="jev"&&d.flown===d.intent)).toBe(true);
  expect(a.last.autopilotMode).toMatch(/^(DECIDING|(HOLD|CLIMB|DESCEND|TURN_LEFT|TURN_RIGHT|SLOW) · Jev)$/);
 }finally{await fast.stop();await slow.stop()}
},60_000);
test("seeded scenario selection reaches the worker",async()=>{const jev=await serveStandInJev();try{
 const {last,chk}=await flyJev("seeded","33",jev,1200n),ref=await direct(scenarioForSeed(33n),1200n);expect(last.scenarioId).toBe("seeded-33");expect(chk).toBe(ref.chk);
}finally{await jev.stop()}},30_000);
test("no built-in autopilot: it needs a Jev key, and when Jev cannot answer and nothing is learned it hands back the aircraft",async()=>{
 const down=await serveStandInJev({fail:true}),{w,inbox,next}=worker();try{
  w.postMessage({type:"RESET",seed:"1"});await next("WORLD");
  let from=inbox.length;w.postMessage({type:"SET_PILOT",pilot:"AUTOPILOT"});expect((await next("ERROR",from)).message).toBe("the autopilot needs a Jev key");
  jevOn(w,down);w.postMessage({type:"SET_PILOT",pilot:"AUTOPILOT"});
  from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:1});const held=await reply(inbox,1,from);expect(held.world.tick).toBe(0n);expect(held.autopilotMode).toBe("DECIDING");
  const off=await next("AUTOPILOT_OFF",from);expect(off.reason).toMatch(/^Autopilot disconnected: Jev could not be reached \(HTTP 503.*nothing has been learned yet/);
  from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:2});const manual=await reply(inbox,2,from);
  expect(manual.pilot).toBe("MANUAL");expect(manual.intent).toBe("HOLD");expect(manual.world.tick).toBe(240n);expect(manual.copilotStatus).toMatchObject({jev:"ERROR"});
 }finally{w.terminate();await down.stop()}
},30_000);
test("manual intents fly the aircraft and pause freezes time",async()=>{const {w,inbox,next}=worker();try{
 w.postMessage({type:"RESET",seed:"1"});await next("WORLD");w.postMessage({type:"SET_PILOT",pilot:"MANUAL"});w.postMessage({type:"SET_INTENT",intent:"CLIMB"});
 let from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:1});const a=await next("WORLD",from);expect(a.pilot).toBe("MANUAL");expect(a.intent).toBe("CLIMB");expect(a.world.aircraft.position.y).toBeGreaterThan(5);expect(a.world.aircraft.velocity.y).toBeGreaterThan(3);
 w.postMessage({type:"PAUSE"});from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:2});const b=await next("WORLD",from+1);expect(b.paused).toBe(true);expect(b.world.tick).toBe(a.world.tick);
}finally{w.terminate()}});
test("bad commands are rejected with ERROR and do not break the worker",async()=>{const {w,inbox,next}=worker();try{
 for(const c of [{type:"RESET",seed:"-1"},{type:"RESET",seed:"12abc"},{type:"SET_INTENT",intent:"BARREL_ROLL"},{type:"SET_PILOT",pilot:"ROBOT"},{type:"NOPE"},{type:"RESTORE",snapshot:{}},null])w.postMessage(c);
 await until(()=>inbox.filter(x=>x.type==="ERROR").length>=7);await Bun.sleep(50);expect(inbox.filter(x=>x.type==="ERROR")).toHaveLength(7);
 const from=inbox.length;w.postMessage({type:"STEP",ticks:1e9,seq:9});const ok=await next("WORLD",from);expect(ok.world.tick).toBe(240n);
}finally{w.terminate()}});
test("learning is off by default, loads saved books, rejects corrupt ones and can be cleared",async()=>{const {w,inbox,next}=worker();try{
 w.postMessage({type:"RESET",seed:"1"});const first=await next("WORLD");expect(first.learning).toBe(false);expect(first.insight).toBeUndefined();
 w.postMessage({type:"LOAD_LEARNING",book:{version:2,flights:2,landings:1,crashes:1,manual:{flights:1,landings:0,crashes:1},autopilot:{flights:1,landings:1,crashes:0},entries:{"X|HOLD":{visits:2,successes:1,failures:1,manual:1,autopilot:1}}}});
 expect(await next("LEARNING")).toMatchObject({reason:"LOADED",book:{flights:2}});
 let from=inbox.length;w.postMessage({type:"LOAD_LEARNING",book:{version:1,flights:"lots"}});expect(await next("LEARNING",from)).toMatchObject({reason:"REJECTED",book:{flights:0}});
 from=inbox.length;w.postMessage({type:"CLEAR_LEARNING"});expect(await next("LEARNING",from)).toMatchObject({reason:"CLEARED",book:{flights:0,entries:{}}});
 from=inbox.length;w.postMessage({type:"SET_LEARNING",enabled:"yes"});expect((await next("ERROR",from)).message).toMatch(/invalid learning flag/);
}finally{w.terminate()}});
test("a flight flown manually then on autopilot records both pilots, with Jev's decisions as the autopilot's frames",async()=>{
 const jev=await serveStandInJev(),{w,inbox,next}=worker();try{
  jevOn(w,jev);w.postMessage({type:"RESET",seed:"1",scenario:"default"});w.postMessage({type:"SET_LEARNING",enabled:true});w.postMessage({type:"SET_PILOT",pilot:"MANUAL"});w.postMessage({type:"SET_INTENT",intent:"CLIMB"});await next("WORLD");
  let seq=100,last:any;for(let i=0;i<3;i++){const from=inbox.length;w.postMessage({type:"STEP",ticks:240,seq:++seq});last=await next("WORLD",from)} // 6 s of manual climb
  expect(last.pilot).toBe("MANUAL");w.postMessage({type:"SET_PILOT",pilot:"AUTOPILOT"});
  last=await stepUntil(w,inbox,next,3600n);expect(last.pilot).toBe("AUTOPILOT");
  // The same flight directly: CLIMB for 720 ticks, then the stand-in's decisions.
  const ref=await direct(defaultScenario(1n),3600n,o=>o.tick<720n?"CLIMB":standInPolicy(o));
  expect(await checksumOf(w,inbox,next)).toBe(ref.chk);
  const from=inbox.length;w.postMessage({type:"RESET",seed:"1",scenario:"default"});const trace=(await next("TRACE",from)).trace;
  expect(trace).toMatchObject({outcome:"ABANDONED",pilots:["MANUAL","AUTOPILOT"]});
  const frames=trace.events.filter((x:any)=>x.type==="DECISION").map((x:any)=>x.frame);
  expect(frames[0]).toMatchObject({provider:"manual",executedIntent:"CLIMB",startTick:0n});
  // Jev advised while the person flew (copilot: frames, flown CLIMB); on autopilot its decisions were flown (autopilot: frames).
  const flown=frames.filter((f:any)=>f.id?.startsWith("autopilot:"));expect(flown.length).toBeGreaterThan(5);
  expect(flown.every((f:any)=>f.provider==="jev"&&f.executedIntent===f.requestedIntent&&f.startTick>=720n)).toBe(true);
 }finally{w.terminate();await jev.stop()}
},60_000);
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
test("while a person flies, Jev only advises: SET_JEV switches it, and the flight is the person's",async()=>{
 const jev=await serveStandInJev(),{w,inbox,next}=worker();try{
  w.postMessage({type:"RESET",seed:"1",scenario:"default"});w.postMessage({type:"SET_PILOT",pilot:"MANUAL"});w.postMessage({type:"SET_INTENT",intent:"CLIMB"});w.postMessage({type:"SET_LEARNING",enabled:true});await next("WORLD");
  let from=inbox.length;jevOn(w,jev);
  let on:any;for(let i=0;i<400&&!on;i++){on=inbox.slice(from).find(x=>x.type==="WORLD"&&x.copilotStatus);if(!on)await Bun.sleep(5)}
  expect(on?.copilotStatus).toMatchObject({jev:"READY"});
  const last=await stepUntil(w,inbox,next,1440n);expect(last.pilot).toBe("MANUAL");
  for(let i=0;i<200&&!inbox.some(x=>x.type==="WORLD"&&x.copilot);i++){const f=inbox.length;w.postMessage({type:"STEP",ticks:0,seq:0});await next("WORLD",f);await Bun.sleep(5)}
  expect(inbox.find(x=>x.type==="WORLD"&&x.copilot).copilot).toMatchObject({source:"JEV",flown:"CLIMB"});
  expect(await checksumOf(w,inbox,next)).toBe((await direct(defaultScenario(1n),1440n,()=>"CLIMB")).chk);
  from=inbox.length;w.postMessage({type:"SET_JEV",apiKey:null});const off=await next("WORLD",from);expect(off.copilotStatus).toBeUndefined();
  from=inbox.length;w.postMessage({type:"SET_JEV",apiKey:42});expect((await next("ERROR",from)).message).toBe("invalid Jev key");
  from=inbox.length;w.postMessage({type:"SET_JEV",apiKey:"k",baseUrl:"file:///etc"});expect((await next("ERROR",from)).message).toBe("invalid Jev URL");
 }finally{w.terminate();await jev.stop()}
},60_000);

// ---- Real-world anchoring: a local Terrarium tile server stands in for AWS (synthetic ridge north of Chennai).
import {deflateSync} from "node:zlib";
import {encodeTerrarium,tileBounds} from "@flight/geospatial";
function terrainServer(delayMs:()=>number){
 const png=(z:number,x:number,y:number)=>{const n=32,b=tileBounds({z,x,y}),raw=new Uint8Array(n*(n*3+1));
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const lat=b.north+(b.south-b.north)*(j+.5)/n,h=15+Math.max(0,(lat-13.1)*111_000/20);raw.set(encodeTerrarium(h),j*(n*3+1)+1+i*3)}
  const chunk=(type:string,data:Uint8Array)=>{const c=new Uint8Array(12+data.length),dv=new DataView(c.buffer);dv.setUint32(0,data.length);c.set(new TextEncoder().encode(type),4);c.set(data,8);return c};
  const ihdr=new Uint8Array(13),dv=new DataView(ihdr.buffer);dv.setUint32(0,n);dv.setUint32(4,n);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",new Uint8Array(deflateSync(raw))),chunk("IEND",new Uint8Array())])};
 let requests=0;
 const server=Bun.serve({port:0,async fetch(req){const m=/\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(new URL(req.url).pathname);if(!m)return new Response("no",{status:404});requests++;
  await Bun.sleep(delayMs());return new Response(png(+m[1]!,+m[2]!,+m[3]!),{headers:{"content-type":"image/png"}})}});
 return {url:`http://localhost:${server.port}/{z}/{x}/{y}.png`,stop:()=>server.stop(true),get requests(){return requests}};
}
/** 50 s of a manual climb out of VOMM 07: stays over the flat airfield, so it is the procedural flight bit for bit. */
const GEO_TICKS=6000n;
async function geoFlight(delay:()=>number){
 const srv=terrainServer(delay),{w,inbox,next}=worker();try{
  const catalog=await next("GEO_CATALOG");expect(catalog.airports.map((a:any)=>a.ident)).toContain("VOMM");
  w.postMessage({type:"SET_WORLD",airport:"VOMM",runway:"07",terrainUrl:srv.url,featuresUrl:null});w.postMessage({type:"RESET",seed:"1",scenario:"default"});w.postMessage({type:"SET_PILOT",pilot:"MANUAL"});w.postMessage({type:"SET_INTENT",intent:"CLIMB"});
  const first=await next("WORLD");expect(first.geo).toMatchObject({airport:"VOMM",runway:"07",surveyed:true});expect(first.geo.headingDeg).toBeCloseTo(68.7,0); // OurAirports' surveyed thresholds
  let seq=1000,holds=0;const last=await stepUntil(w,inbox,next,GEO_TICKS,undefined,e=>{if(e.geo.holding||e.geo.state==="LOADING")holds++});
  const chk={checksum:await checksumOf(w,inbox,next)};
  for(let i=0;i<100&&!inbox.some(x=>x.type==="TERRAIN"&&x.add.length);i++)await Bun.sleep(10);
  // The terrain manifest is hashed asynchronously after the last tile loads: read it once it has settled.
  let manifest:string|undefined;for(let i=0;i<100&&!manifest;i++){await Bun.sleep(10);const f=inbox.length;w.postMessage({type:"STEP",ticks:0,seq:++seq});manifest=(await next("WORLD",f)).geo.manifest}
  return {last,chk,holds,inbox,manifest,requests:srv.requests};
 }finally{w.terminate();srv.stop()}
}
test("anchored to VOMM 07 with real terrain: the flight streams terrain and matches whatever the tile latency",async()=>{
 const fast=await geoFlight(()=>0),slow=await geoFlight(()=>5+Math.floor(Math.random()*40));
 expect(fast.last.world.tick).toBe(GEO_TICKS);expect(fast.last.geo.state).toBe("READY");
 expect(fast.last.geo.anchor.elevationM).toBeCloseTo(15,0);expect(fast.last.geo.simTiles).toBeGreaterThanOrEqual(9);expect(fast.manifest).toMatch(/^[0-9a-f]{64}$/);
 expect(Math.abs(fast.last.geo.position.lat-12.99)).toBeLessThan(.05);expect(fast.last.geo.aglM).toBeGreaterThan(200);
 expect(slow.chk.checksum).toBe(fast.chk.checksum);expect(slow.last.world.tick).toBe(fast.last.world.tick);expect(slow.manifest).toBe(fast.manifest);
 expect(slow.holds).toBeGreaterThan(0);
 // Over the flat airfield the flight is identical to the procedural airfield's.
 const ref=await direct(defaultScenario(1n),GEO_TICKS,()=>"CLIMB");expect(fast.chk.checksum).toBe(ref.chk);
 const patches=fast.inbox.filter((x:any)=>x.type==="TERRAIN").flatMap((x:any)=>x.add);
 expect(patches.length).toBeGreaterThan(5);expect(patches[0].positions).toBeInstanceOf(Float32Array);expect(patches[0].indices).toBeInstanceOf(Uint16Array);
},60_000);
test("SET_WORLD validates its input, and null returns to the procedural airfield",async()=>{const {w,inbox,next}=worker();try{
 for(const c of [{type:"SET_WORLD",airport:"ZZZZ"},{type:"SET_WORLD",airport:"VOMM",runway:"99"},{type:"SET_WORLD",airport:"VOMM",terrainUrl:"javascript:alert(1)"},{type:"SET_WORLD",airport:"VOMM",terrainUrl:"https://x/tiles.png"}])w.postMessage(c);
 await until(()=>inbox.filter(x=>x.type==="ERROR").length>=4);await Bun.sleep(50);expect(inbox.filter(x=>x.type==="ERROR")).toHaveLength(4);
 const from=inbox.length;w.postMessage({type:"SET_WORLD",airport:null});const clear=await next("TERRAIN",from);expect(clear.clear).toBe(true);const wd=await next("WORLD",from);expect(wd.geo).toBeUndefined();
}finally{w.terminate()}});

// ---- Buildings and airport surfaces from a PMTiles archive served with HTTP Range (OpenMapTiles schema).
import {gzipSync} from "node:zlib";
import {Compression,encodeMvt,lonLatToTile,lonLatToTilePoint,ringArea,writePMTiles} from "@flight/geospatial";
function featureServer(){
 const rwy:[number,number][]=[[80.1529491,12.9841489],[80.1686992,12.9900653],[80.1844492,12.9959816]]; // VOMM 07/25 (OSM)
 const tiles=new Map<string,{t:{z:number;x:number;y:number};b:any[];a:any[]}>(),at=(lon:number,lat:number)=>{const t=lonLatToTile(lon,lat,14),k=`${t.x}/${t.y}`;return tiles.get(k)??tiles.set(k,{t,b:[],a:[]}).get(k)!};
 for(const p of rwy){const e=at(p[0],p[1]);if(!e.a.length)e.a.push({id:1,type:2,properties:{class:"runway",ref:"07/25"},geometry:[rwy.map(q=>lonLatToTilePoint(e.t,4096,q[0],q[1]))]})}
 // A block of 20 m buildings 7 km east-north-east, well off the airfield.
 for(let i=0;i<5;i++){const lon=80.225+i*.0008,lat=13.005,e=at(lon,lat),d=.0003,ring=[[lon-d,lat-d],[lon+d,lat-d],[lon+d,lat+d],[lon-d,lat+d],[lon-d,lat-d]].map(q=>lonLatToTilePoint(e.t,4096,q[0]!,q[1]!));
  e.b.push({id:10+i,type:3,properties:{render_height:20},geometry:[ringArea(ring)<0?ring.reverse():ring]})}
 const bytes=writePMTiles([...tiles.values()].map(v=>({tile:v.t,data:gzipSync(encodeMvt([{name:"building",extent:4096,features:v.b},{name:"aeroway",extent:4096,features:v.a}]))})),{compress:b=>gzipSync(b),tileCompression:Compression.Gzip});
 const server=Bun.serve({port:0,fetch(req){const m=/bytes=(\d+)-(\d+)/.exec(req.headers.get("range")??"");if(!m)return new Response(bytes as Uint8Array<ArrayBuffer>);return new Response(bytes.slice(+m[1]!,+m[2]!+1) as Uint8Array<ArrayBuffer>,{status:206})}});
 return {url:`http://localhost:${server.port}/features.pmtiles`,stop:()=>server.stop(true)};
}
test("with buildings and a surveyed runway from PMTiles, features stream and the flight is unchanged",async()=>{
 const terrain=terrainServer(()=>0),features=featureServer(),{w,inbox,next}=worker();try{
  w.postMessage({type:"SET_WORLD",airport:"VOMM",runway:"07",terrainUrl:terrain.url,featuresUrl:features.url});w.postMessage({type:"RESET",seed:"1",scenario:"default"});w.postMessage({type:"SET_PILOT",pilot:"MANUAL"});w.postMessage({type:"SET_INTENT",intent:"CLIMB"});
  const last=await stepUntil(w,inbox,next,GEO_TICKS);expect(last.world.tick).toBe(GEO_TICKS);
  expect(last.geo).toMatchObject({surveyed:true,features:{state:"READY"}});expect(last.geo.headingDeg).toBeCloseTo(68.9,1);
  for(let i=0;i<200&&!inbox.some(x=>x.type==="FEATURES"&&x.add.some((p:any)=>p.layer==="airports"));i++)await Bun.sleep(10);
  const patches=inbox.filter(x=>x.type==="FEATURES").flatMap(x=>x.add);expect(patches.some((p:any)=>p.layer==="airports"&&p.lights?.length)).toBe(true);
  // The flat airfield means the flight is bit-for-bit the procedural one.
  expect(await checksumOf(w,inbox,next)).toBe((await direct(defaultScenario(1n),GEO_TICKS,()=>"CLIMB")).chk);
 }finally{w.terminate();terrain.stop();features.stop()}
},60_000);

test("airport search and a cross-country flight flown by Jev's decisions: Chennai → Arakkonam, landing there, and learning from it",async()=>{
 const srv=terrainServer(()=>0),jev=await serveStandInJev(),{w,inbox,next}=worker();try{
  let from=inbox.length;w.postMessage({type:"FIND_AIRPORTS",query:"arakkonam",limit:5});const found=await next("AIRPORTS_FOUND",from);
  expect(found.query).toBe("arakkonam");expect(found.airports[0]).toMatchObject({ident:"VOAR"});
  // The full catalogue is loaded: the picker's list stays short, the total counts every airport.
  expect(inbox.filter(x=>x.type==="GEO_CATALOG").at(-1).total).toBeGreaterThan(20_000);
  from=inbox.length;w.postMessage({type:"SET_WORLD",airport:"VOMM",runway:"07",destination:"ZZZZ",terrainUrl:srv.url,featuresUrl:null});expect((await next("ERROR",from)).message).toBe("unknown destination ZZZZ");
  jevOn(w,jev);w.postMessage({type:"SET_LEARNING",enabled:true});
  w.postMessage({type:"SET_WORLD",airport:"VOMM",runway:"07",destination:"VOAR",terrainUrl:srv.url,featuresUrl:null});w.postMessage({type:"RESET",seed:"1",scenario:"default"});w.postMessage({type:"SET_PILOT",pilot:"AUTOPILOT"});
  const epochs=new Set<number>(),last=await stepUntil(w,inbox,next,1_000_000n,undefined,e=>{if(e.geo?.state==="READY")epochs.add(e.geo.frameEpoch)});
  expect(last.world.objective.phase).toBe("COMPLETE");expect(last.autopilotMode).toBe("LANDED");expect(last.pilot).toBe("AUTOPILOT");
  // Jev saw the flight plan: distance, bearing and height relative to the plan to VOAR 24.
  expect(jev.observations[0]).toMatchObject({objectivePhase:"RETURN",altitude:2});expect(jev.observations[0]!.objective!.distance).toBeGreaterThan(45_000);
  expect(last.geo.arrived).toBe("VOAR");expect(last.geo.route).toMatchObject({destination:"VOAR"});expect(last.geo.route.path.length).toBeGreaterThan(3);
  expect(last.geo.frameEpoch).toBeGreaterThanOrEqual(2);expect(epochs.size).toBeGreaterThanOrEqual(3);
  // Every re-anchoring cleared the old frame's meshes under a new epoch.
  expect(inbox.filter(x=>x.type==="TERRAIN"&&x.clear).length).toBeGreaterThanOrEqual(3);
  // Learning credits the landing to the autopilot, and the trace holds Jev's decisions.
  const learned=inbox.find(x=>x.type==="LEARNING"&&x.reason==="RECORDED");expect(learned.book).toMatchObject({flights:1,landings:1,autopilot:{flights:1,landings:1},manual:{flights:0}});
  expect(learned.book.examples.length).toBeGreaterThan(20);expect(learned.book.examples[0].f).toHaveLength(15);
  await until(()=>inbox.some(x=>x.type==="TRACE"));const trace=inbox.find(x=>x.type==="TRACE").trace;expect(trace).toMatchObject({outcome:"LANDED",pilots:["AUTOPILOT"]});
  expect(trace.events.filter((x:any)=>x.type==="DECISION"&&x.frame.provider==="jev").length).toBeGreaterThan(100);
 }finally{w.terminate();srv.stop();await jev.stop()}
},240_000);
