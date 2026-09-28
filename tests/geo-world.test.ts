import {expect,test} from "bun:test";
import {deflateSync} from "node:zlib";
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
import {autopilotControls} from "@flight/controller";
import {
 AirportIndex,AnchorFrame,GeoWorld,SAMPLE_AIRPORTS_CSV,SAMPLE_RUNWAYS_CSV,TerrainTile,decodePngAsync,destinationPoint,encodeTerrarium,
 haversineDistance,parseOurAirports,runwayAnchor,tileBounds,tileKey,type TileId,type TileSource,
} from "@flight/geospatial";
import type {TerrainPatch} from "@flight/protocol";

const index=new AirportIndex(parseOurAirports(SAMPLE_AIRPORTS_CSV,SAMPLE_RUNWAYS_CSV));
/** Synthetic DEM: 20 m everywhere except a ridge rising 1 m per 20 m north of 13.1°N (north of VOMM). */
const dem=(lat:number,_lon:number)=>20+Math.max(0,(lat-13.1)*111_000/20);
function source(delayMs=()=>0,log:string[]=[]):TileSource<TerrainTile>{
 return {layer:"terrain",maxZoom:15,sizeOf:t=>t.byteLength,load:async(tile,signal)=>{log.push(tileKey(tile));await Bun.sleep(delayMs());if(signal.aborted)throw new Error("aborted");
  const n=16,b=tileBounds(tile),h=new Float32Array(n*n);
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const f=(k:number)=>(k+.5)/n;const lat=b.north+(b.south-b.north)*f(j),lon=b.west+(b.east-b.west)*f(i);h[j*n+i]=dem(lat,lon)}
  return new TerrainTile(tile,n,n,h)}};
}

test("anchor frame: sim heading 0 flies the runway heading, +x is to the right, and it round-trips",()=>{
 const a=runwayAnchor(index.require("VOMM"),"07");expect(a.headingDegT).toBe(72);expect(a.runway).toBe("07");
 const f=new AnchorFrame(a.anchor,a.headingDegT),ahead=f.toGeo({x:0,y:0,z:1000}),right=f.toGeo({x:1000,y:0,z:0});
 expect(haversineDistance(a.anchor,destinationPoint(a.anchor,72,1000))).toBeCloseTo(haversineDistance(a.anchor,ahead),-1);
 expect(haversineDistance(ahead,destinationPoint(a.anchor,72,1000))).toBeLessThan(5);expect(haversineDistance(right,destinationPoint(a.anchor,162,1000))).toBeLessThan(5);
 expect(f.bearing(Math.PI/2)).toBeCloseTo(162,9);
 const v={x:-1234.5,y:456.7,z:8901.2},back=f.fromGeo(f.toGeo(v));expect(back.x).toBeCloseTo(v.x,5);expect(back.y).toBeCloseTo(v.y,5);expect(back.z).toBeCloseTo(v.z,5);
 const b=runwayAnchor(index.require("VOMM"),"25");expect(b.headingDegT).toBe(252);expect(b.runway).toBe("25");
 expect(()=>runwayAnchor(index.require("VOMM"),"99")).toThrow();
});

test("PNG decode through DecompressionStream (browser/worker path)",async()=>{
 const w=4,h=2,raw=new Uint8Array(h*(w*3+1));for(let y=0;y<h;y++)for(let x=0;x<w;x++)raw.set(encodeTerrarium(100*y+x),y*(w*3+1)+1+x*3);
 const chunk=(type:string,data:Uint8Array)=>{const b=new Uint8Array(12+data.length),dv=new DataView(b.buffer);dv.setUint32(0,data.length);b.set(new TextEncoder().encode(type),4);b.set(data,8);return b};
 const ihdr=new Uint8Array(13),dv=new DataView(ihdr.buffer);dv.setUint32(0,w);dv.setUint32(4,h);ihdr[8]=8;ihdr[9]=2;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",new Uint8Array(deflateSync(raw))),chunk("IEND",new Uint8Array())]);
 const huge=Buffer.from(png);new DataView(huge.buffer,huge.byteOffset).setUint32(16,1_000_000);
 await expect(decodePngAsync(new Uint8Array(huge))).rejects.toThrow("exceeds");
 const img=await decodePngAsync(new Uint8Array(png));const t=TerrainTile.fromTerrarium({z:1,x:0,y:0},img.pixels,w,h,3);expect([...t.heights]).toEqual([0,1,2,3,100,101,102,103]);
});

test("the airfield is flat at 0, real terrain rises beyond it, and the runway elevation comes from the DEM",async()=>{
 const g=new GeoWorld({airports:index,airport:"VOMM",runway:"07",terrain:source()});
 expect(g.state).toBe("LOADING");expect(g.ground(0,20_000)).toBe(0);
 await g.prepare();expect(g.state).toBe("READY");expect(g.elevation).toBeCloseTo(20,0);
 expect(g.ground(0,0)).toBe(0);expect(g.ground(3000,0)).toBe(0);
 // 25 km to the left of runway 07 is roughly north (bearing 342°): the ridge.
 const far=g.frame.toGeo({x:-25_000,y:0,z:0});expect(g.ensureAround(-25_000,0)).not.toBeNull();await g.ensureAround(-25_000,0);
 expect(g.ground(-25_000,0)).toBeCloseTo(dem(far.lat,far.lon)-20-25_000**2/(2*6_371_000),-1);
 g.dispose();
});

test("physics with real terrain is independent of how slowly tiles arrive",async()=>{
 async function run(delay:()=>number){
  const g=new GeoWorld({airports:index,airport:"VOMM",runway:"07",terrain:source(delay)});await g.prepare();
  const sim=new DeterministicSimulation();sim.setGround(g.ground);let w=sim.reset(defaultScenario(1n)),holds=0;
  // Straight climb-out along the runway, far past the airfield, holding the clock whenever terrain is missing.
  const climb=(a:typeof w.aircraft)=>{const v=Math.hypot(a.velocity.x,a.velocity.y,a.velocity.z),target=v<30?0:a.position.y<400?.12:0;return {aileron:-a.roll*2,elevator:(target-a.pitch)*4,rudder:0,throttle:1}};
  for(let step=0;step<90;step++){const wait=g.ensureAround(w.aircraft.position.x,w.aircraft.position.z);if(wait){holds++;await wait;step--;continue}
   for(let i=0;i<240;i++)w=sim.step(climb(w.aircraft))}
  const out={chk:await sim.checksum(),z:w.aircraft.position.z,phase:w.objective.phase,holds,tiles:g.simulationWorld.size,manifest:await g.simulationWorld.checksum()};g.dispose();return out;
 }
 const fast=await run(()=>0),slow=await run(()=>Math.floor(Math.random()*15));
 expect(slow.chk).toBe(fast.chk);expect(slow.manifest).toBe(fast.manifest);expect(fast.z).toBeGreaterThan(12_000);expect(fast.holds).toBeGreaterThan(0);expect(fast.tiles).toBeGreaterThan(9);expect(fast.phase).not.toBe("FAILED");
},30_000);

test("terrain contact off the airfield is a crash; the default flat world is unchanged",async()=>{
 const sim=new DeterministicSimulation();sim.setGround((x,z)=>Math.hypot(x,z)>100?50:0);let w=sim.reset(defaultScenario(1n));
 for(let i=0;i<120*30&&w.objective.phase!=="FAILED";i++)w=sim.step({aileron:0,elevator:0,rudder:0,throttle:1});
 expect(w.objective.phase).toBe("FAILED");expect(w.aircraft.position.y).toBe(50);
 const a=new DeterministicSimulation(),b=new DeterministicSimulation();b.setGround(undefined);let wa=a.reset(defaultScenario(3n)),wb=b.reset(defaultScenario(3n));
 for(let i=0;i<3000;i++){wa=a.step(autopilotControls(wa));wb=b.step(autopilotControls(wb))}expect(await a.checksum()).toBe(await b.checksum());
});

test("streamed patches: finer tiles replace fully covered parents, meshes face up and sit in the anchored frame",async()=>{
 const batches:{add:TerrainPatch[];remove:string[]}[]=[];
 const g=new GeoWorld({airports:index,airport:"VOMM",runway:"07",terrain:source(),patchDebounceMs:1,maxConcurrent:64,onPatches:(add,remove)=>batches.push({add,remove})});
 await g.prepare();g.update({position:{x:0,y:0,z:0},velocity:{x:0,y:0,z:0},heading:0});
 for(let i=0;i<200&&(batches.length===0||g.status({position:{x:0,y:0,z:0},velocity:{x:0,y:0,z:0},heading:0}).streaming.inFlight>0);i++)await Bun.sleep(5);
 await Bun.sleep(20);
 const shown=new Map<string,TerrainPatch>();for(const b of batches){for(const k of b.remove)shown.delete(k);for(const p of b.add)shown.set(p.key,p)}
 expect(shown.size).toBeGreaterThan(10);
 const keys=[...shown.keys()].map(k=>k.split("/").map(Number) as [number,number,number]);
 // No shown tile has all four children shown too.
 for(const [z,x,y] of keys){const kids=[[x*2,y*2],[x*2+1,y*2],[x*2,y*2+1],[x*2+1,y*2+1]].map(([a,b])=>`${z+1}/${a}/${b}`);expect(kids.every(k=>shown.has(k))).toBe(false)}
 const fine=[...shown.values()].sort((a,b)=>b.z-a.z)[0]!;
 const P=(i:number)=>[fine.positions[i*3]!,fine.positions[i*3+1]!,fine.positions[i*3+2]!];
 const [a,b,c]=[P(fine.indices[0]!),P(fine.indices[1]!),P(fine.indices[2]!)],u=[b[0]!-a[0]!,b[1]!-a[1]!,b[2]!-a[2]!],v=[c[0]!-a[0]!,c[1]!-a[1]!,c[2]!-a[2]!];
 expect(u[2]!*v[0]!-u[0]!*v[2]!).toBeGreaterThan(0); // normal.y of (b−a)×(c−a)
 // The tile under the runway is flattened just below the airfield (y ≤ −0.6) and centred near the origin.
 const home=[...shown.values()].filter(p=>p.z===14).sort((p,q)=>Math.hypot(p.center[0],p.center[2])-Math.hypot(q.center[0],q.center[2]))[0]!;
 expect(Math.hypot(home.center[0],home.center[2])).toBeLessThan(3000);expect(home.center[1]).toBeLessThanOrEqual(-0.6);
 const s=g.status({position:{x:0,y:0,z:0},velocity:{x:0,y:0,z:0},heading:0});
 expect(s).toMatchObject({airport:"VOMM",runway:"07",state:"READY",aglM:0,holding:false});expect(s.terrainElevationM!).toBeCloseTo(20,0);
 expect(s.airports.find(m=>m.ident==="VOMM")!.runways.map(r=>r.ident)).toEqual(["12/30"]);expect(s.attribution.join()).toContain("OurAirports");
 g.dispose();
},20_000);

test("unreachable terrain degrades to a flat world with an explanation",async()=>{
 const g=new GeoWorld({airports:index,airport:"VOMM",terrain:{layer:"terrain",maxZoom:15,sizeOf:()=>1,load:async()=>{throw new Error("offline")}},simRetries:1});
 await g.prepare();expect(g.state).toBe("ERROR");expect(g.detail).toContain("offline");expect(g.ground(0,50_000)).toBe(0);expect(g.ensureAround(0,50_000)).toBeNull();
 expect(()=>new GeoWorld({airports:index,airport:"ZZZZ",terrain:source()})).toThrow("unknown airport");
});
