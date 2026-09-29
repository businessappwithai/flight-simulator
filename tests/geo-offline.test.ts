import {expect,test} from "bun:test";
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
import {steerTo} from "@flight/controller";
import {FlightTraceRecorder} from "@flight/learning";
import {GeoWorld,MemoryTileStore,cachingFetch,encodeTerrarium,routePackTiles,terrariumSource,tileBounds,type TileId} from "@flight/geospatial";
import {LiveDashboardModel} from "../apps/control-room/src/live-dashboard.ts";
import {catalogIndex,inland} from "./geo-route.helpers.ts";

const catalog=catalogIndex();
/** A fake Terrarium server: the body names the tile; `decode` renders the synthetic DEM for it (no PNG needed). */
function server(){
 let requests=0,up=true;
 const f=(async(input:RequestInfo|URL)=>{requests++;if(!up)throw new TypeError("Failed to fetch (offline)");
  const m=/\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(String(input));return new Response(m?`${m[1]}/${m[2]}/${m[3]}`:"",{status:m?200:404})}) as typeof fetch;
 const decode=(b:Uint8Array)=>{const [z,x,y]=new TextDecoder().decode(b).split("/").map(Number) as [number,number,number];const n=16,t:TileId={z,x,y},bb=tileBounds(t),px=new Uint8Array(n*n*3);
  for(let j=0;j<n;j++)for(let i=0;i<n;i++)px.set(encodeTerrarium(inland(bb.north+(bb.south-bb.north)*(j+.5)/n,bb.west+(bb.east-bb.west)*(i+.5)/n)),(j*n+i)*3);
  return {width:n,height:n,channels:3,pixels:px}};
 return {fetch:f,decode,get requests(){return requests},set up(v:boolean){up=v}};
}
async function fly(g:GeoWorld,maxTicks=200_000){
 await g.prepare();expect(g.state).toBe("READY");
 const sim=new DeterministicSimulation();sim.setGround(g.ground,g.landable);let w=sim.reset(defaultScenario(1n));
 for(let t=0;t<maxTicks;t++){const wait=g.ensureAround(w.aircraft.position.x,w.aircraft.position.z);if(wait){await wait;t--;continue}
  w=sim.step(steerTo(w,g.routeTarget(w)!));const m=g.maybeRebase(w);if(m){sim.restore(m);w=m}
  if(g.arrived(w)){w={...w,objective:{phase:"COMPLETE",checkpointReached:true}};sim.restore(w)}
  if(w.objective.phase!=="OUTBOUND")break}
 return {w,checksum:await sim.checksum()};
}

test("caching fetch: answers from the store, keys Range requests separately, and stores only successes",async()=>{
 const store=new MemoryTileStore();let calls=0;
 const base=(async(_u:RequestInfo|URL,init?:RequestInit)=>{calls++;const r=new Headers(init?.headers).get("range");return r==="bytes=9-9"?new Response("",{status:404}):new Response(r?`part ${r}`:"whole")}) as typeof fetch;
 const f=cachingFetch(store,base);
 expect(await (await f("https://x/a")).text()).toBe("whole");expect(await (await f("https://x/a")).text()).toBe("whole");
 expect(await (await f("https://x/a",{headers:{Range:"bytes=0-3"}})).text()).toBe("part bytes=0-3");
 expect(await (await f("https://x/a",{headers:{Range:"bytes=0-3"}})).text()).toBe("part bytes=0-3");
 expect((await f("https://x/a",{headers:{Range:"bytes=9-9"}})).status).toBe(404);expect((await f("https://x/a",{headers:{Range:"bytes=9-9"}})).status).toBe(404);
 expect(calls).toBe(4);expect(f.stats).toMatchObject({hits:2,stored:2});expect(await store.count()).toBe(2);
});

test("a packed route flies offline, bit for bit the same as online",async()=>{
 const net=server(),store=new MemoryTileStore(),f=cachingFetch(store,net.fetch);
 const make=()=>new GeoWorld({airports:catalog,airport:"VOMM",runway:"07",destination:"VOAR",terrain:terrariumSource({fetch:f,template:"https://t/{z}/{x}/{y}.png",decode:net.decode})});
 const online=make();await online.prepare();
 const tiles=routePackTiles(online.route!);expect(tiles.terrain.length).toBeGreaterThan(50);expect(tiles.features).toHaveLength(0);
 let progress=0;const r=await online.packRoute(()=>progress++);expect(r.failed).toBe(0);expect(r.total).toBe(tiles.terrain.length);expect(progress).toBe(r.total);
 const a=await fly(online);online.dispose();expect(a.w.objective.phase).toBe("COMPLETE");
 // No network at all now: everything comes from the pack.
 net.up=false;const before=net.requests,offline=make();const b=await fly(offline);offline.dispose();
 expect(b.w.objective.phase).toBe("COMPLETE");expect(b.checksum).toBe(a.checksum);
 expect(net.requests).toBe(before); // not one request reached the (dead) network
},120_000);

test("GeoTelemetry: a stream sample describes physics, render and destination, travels in the trace and fills the Control Room panel",async()=>{
 const net=server(),g=new GeoWorld({airports:catalog,airport:"VOMM",runway:"07",destination:"VOBL",terrain:terrariumSource({fetch:net.fetch,template:"https://t/{z}/{x}/{y}.png",decode:net.decode})});
 await g.prepare();g.holding=true;g.holding=false;
 const pose={position:{x:0,y:2,z:0},velocity:{x:0,y:0,z:0},heading:0};g.update(pose);
 const s=g.streamSample(pose);g.dispose();
 expect(s).toMatchObject({airport:"VOMM",state:"READY",frameEpoch:0,features:"OFF",physics:{missingAround:0,holds:1,holding:false},destination:{ident:"VOBL",terrainReady:true,featuresReady:null}});
 expect(s.physics.terrainTiles).toBeGreaterThanOrEqual(18);expect(s.destination!.distanceKm).toBeGreaterThan(250);expect(s.render.wanted).toBeGreaterThan(0);
 const tr=new FlightTraceRecorder();tr.begin("f1","vomm");tr.record(0n,"CLIMB","AUTOPILOT","s","m");tr.stream(600n,s);tr.record(1200n,"HOLD","AUTOPILOT","s","m");
 const trace=tr.finish("LANDED",2400n,"c","COMPLETE")!;
 expect(trace.events.map(e=>e.type)).toEqual(["DECISION","WORLD_STREAM","DECISION","EPISODE_END"]);
 const m=new LiveDashboardModel();for(const e of trace.events)m.ingest(e);
 expect(m.worldStream()).toMatchObject({tick:"600",latest:{airport:"VOMM"}});expect(m.worldStream()!.history).toHaveLength(1);
});

import {AnchorFrame,destinationPoint as dp,geodeticToEcef} from "@flight/geospatial";
test("frame.ecefToThree places ECEF data (3D Tiles) exactly where the local frame puts the same point, after re-anchoring too",()=>{
 for(const [lat,lon,hdg] of [[12.98,80.16,68.7],[27.7,85.36,20],[-45.02,168.74,230],[64.13,-21.94,0]] as const){
  const f=new AnchorFrame({lat,lon,altMsl:120},hdg),m=f.ecefToThree();
  for(const [b,d,alt] of [[0,0,120],[45,20_000,3000],[200,60_000,10]] as const){
   const p={...dp({lat,lon,altMsl:0},b,d),altMsl:alt},c=geodeticToEcef(p),v=f.fromGeo(p);
   const x=m[0]!*c.x+m[4]!*c.y+m[8]!*c.z+m[12]!,y=m[1]!*c.x+m[5]!*c.y+m[9]!*c.z+m[13]!,z=m[2]!*c.x+m[6]!*c.y+m[10]!*c.z+m[14]!;
   expect(x).toBeCloseTo(-v.x,3);expect(y).toBeCloseTo(v.y,3);expect(z).toBeCloseTo(v.z,3);
  }
 }
});
