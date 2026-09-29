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

import {Compression,GreatCircleRoute,cacheApiStore,encodeMvt,lonLatToTile,lonLatToTilePoint,planTiles,tileKey,vectorSources,writePMTiles} from "@flight/geospatial";
import {gzipSync} from "node:zlib";
/** Just enough of the Cache API (insertion-ordered keys) to exercise cacheApiStore. */
function fakeCaches(){
 const stores=new Map<string,Map<string,Uint8Array>>();
 const cache=(m:Map<string,Uint8Array>)=>({
  async match(r:Request){const b=m.get(r.url);return b?new Response(b as Uint8Array<ArrayBuffer>):undefined},
  async put(r:Request,res:Response){m.delete(r.url);m.set(r.url,new Uint8Array(await res.arrayBuffer()))},
  async keys(){return [...m.keys()].map(u=>new Request(u))},async delete(r:Request){return m.delete(r.url)}});
 return {async open(n:string){if(!stores.has(n))stores.set(n,new Map());return cache(stores.get(n)!)},async delete(n:string){return stores.delete(n)},async keys(){return [...stores.keys()]}};
}
test("the browser tile store keeps at most maxEntries, dropping the oldest first",async()=>{
 const g=globalThis as {caches?:unknown},saved=g.caches;g.caches=fakeCaches();
 try{
  const s=cacheApiStore("t",{maxEntries:5,trimEvery:4})!;
  for(let i=0;i<12;i++)await s.put(`k${i}`,new Uint8Array([i]));
  expect(await s.count()).toBeLessThanOrEqual(8);expect(await s.get("k0")).toBeUndefined();expect([...(await s.get("k11"))!]).toEqual([11]);
  await s.clear();expect(await s.count()).toBe(0);
 }finally{g.caches=saved}
 expect(cacheApiStore()).toBeUndefined(); // no Cache API in Bun: the worker then fetches from the network only
});

test("a route pack holds the physics blocks and the render tiles the LOD planner asks for along the way",()=>{
 const r=new GreatCircleRoute([{lat:12.99,lon:80.17,altMsl:0},{lat:13.07,lon:79.69,altMsl:0}],10_000),pack=routePackTiles(r,{features:true});
 const keys=new Set(pack.terrain.map(tileKey)),fkeys=new Set(pack.features.map(tileKey));
 for(const d of [0,.3,.7,1].map(f=>f*r.totalM)){const p=r.pointAt(d),c=lonLatToTile(p.lon,p.lat,12);
  for(const dx of [-1,0,1])for(const dy of [-1,0,1])expect(keys.has(`12/${c.x+dx}/${c.y+dy}`)).toBe(true);
  const f=lonLatToTile(p.lon,p.lat,14);expect(fkeys.has(`14/${f.x}/${f.y}`)).toBe(true)}
 // Near the departure the streamer wants z14 terrain close in and buildings: all in the pack.
 const low=planTiles({position:r.pointAt(0),velocity:{groundSpeedMps:85,trackDeg:r.progress(r.pointAt(0)).desiredTrackDeg,verticalSpeedMps:0},aglM:150,layers:["terrain","buildings"],horizonsS:[]});
 const near=low.filter(q=>q.level!=="LOW"&&q.layer==="terrain"),blds=low.filter(q=>q.layer==="buildings");
 expect(near.length).toBeGreaterThan(50);for(const q of near)expect(keys.has(tileKey(q.tile))).toBe(true);
 expect(blds.length).toBeGreaterThan(0);for(const q of blds)expect(fkeys.has(tileKey(q.tile))).toBe(true);
 expect(pack.terrain.length).toBeLessThan(1500);
});

test("with buildings and runways from a PMTiles archive, a packed route also flies offline bit for bit",async()=>{
 // VOAR 06/24 surveyed centreline and a block of buildings beside the route, in one archive served with Range.
 const rwy:[number,number][]=[[79.6827,13.0626],[79.6988,13.0727]],tiles=new Map<string,{t:{z:number;x:number;y:number};b:any[];a:any[]}>();
 const at=(lon:number,lat:number)=>{const t=lonLatToTile(lon,lat,14),k=tileKey(t);return tiles.get(k)??tiles.set(k,{t,b:[],a:[]}).get(k)!};
 for(const p of rwy){const e=at(p[0],p[1]);if(!e.a.length)e.a.push({id:1,type:2,properties:{class:"runway",ref:"06/24"},geometry:[rwy.map(q=>lonLatToTilePoint(e.t,4096,q[0],q[1]))]})}
 for(let i=0;i<4;i++){const lon=79.9+i*.001,lat=13.02,e=at(lon,lat),d=.0003,ring=[[lon-d,lat-d],[lon+d,lat-d],[lon+d,lat+d],[lon-d,lat+d],[lon-d,lat-d]].map(q=>lonLatToTilePoint(e.t,4096,q[0]!,q[1]!));
  e.b.push({id:10+i,type:3,properties:{render_height:30},geometry:[ring]})}
 const archive=writePMTiles([...tiles.values()].map(v=>({tile:v.t,data:gzipSync(encodeMvt([{name:"building",extent:4096,features:v.b},{name:"aeroway",extent:4096,features:v.a}]))})),{compress:b=>gzipSync(b),tileCompression:Compression.Gzip});
 const net=server(),base=net.fetch,both=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(!String(input).endsWith(".pmtiles"))return base(input,init);await base("https://t/0/0/0.png");// counts, and fails while offline
  const m=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("range")??"");return m?new Response(archive.slice(+m[1]!,+m[2]!+1) as Uint8Array<ArrayBuffer>,{status:206}):new Response(archive as Uint8Array<ArrayBuffer>)}) as typeof fetch;
 const store=new MemoryTileStore(),f=cachingFetch(store,both);
 const make=()=>new GeoWorld({airports:catalog,airport:"VOMM",runway:"07",destination:"VOAR",terrain:terrariumSource({fetch:f,template:"https://t/{z}/{x}/{y}.png",decode:net.decode}),features:vectorSources({url:"https://f/area.pmtiles",fetch:f})});
 const online=make();await online.prepare();expect(online.featuresState).toBe("READY");expect(online.destinationRunway!.synthesized).toBe(false);
 const r=await online.packRoute();expect(r.failed).toBe(0);const a=await fly(online);online.dispose();expect(a.w.objective.phase).toBe("COMPLETE");
 net.up=false;const before=net.requests,offline=make();const b=await fly(offline);
 expect(offline.featuresState).toBe("READY");expect(offline.destinationRunway!.synthesized).toBe(false);offline.dispose();
 expect(b.w.objective.phase).toBe("COMPLETE");expect(b.checksum).toBe(a.checksum);expect(net.requests).toBe(before);
},120_000);
