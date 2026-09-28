import {describe,expect,test} from "bun:test";
import {deflateSync,inflateSync} from "node:zlib";
import {
 AirportIndex,FloatingOrigin,GreatCircleRoute,LruByteCache,PRIORITY,SIM_GRID,SIM_ZOOM,SimulationWorld,TerrainTile,WorldStreamer,
 attributionFor,buildingVolume,decodePng,decodeTerrarium,destinationPoint,ecefToGeodetic,encodeTerrarium,enuToGeodetic,extractSimulationTile,
 geoSituation,geodeticToEcef,geodeticToEnu,haversineDistance,initialBearing,isAlternateCandidate,lodRings,lonLatToTile,parseCsv,parseOurAirports,
 parseTileKey,planAirportRoute,planTiles,runwayGeometry,simulationTilesForPath,terrainMesh,tileBounds,tileKey,tilesInRadius,
 type GeoPosition,type TileId,type TileSource,
} from "@flight/geospatial";

const dir="packages/geospatial/data/ourairports-sample";
const airports=parseOurAirports(await Bun.file(`${dir}/airports.csv`).text(),await Bun.file(`${dir}/runways.csv`).text());
const index=new AirportIndex(airports);
const VOMM=index.require("VOMM"),VIDP=index.require("VIDP");

describe("geodesy",()=>{
 test("geodetic ⇄ ECEF round-trips to sub-millimetre, including poles, antimeridian and Everest",()=>{
  for(const p of [{lat:12.99,lon:80.17,altMsl:15},{lat:27.9881,lon:86.925,altMsl:8848},{lat:89.9999,lon:0,altMsl:100},{lat:-45,lon:179.9999,altMsl:11000},{lat:0,lon:-180,altMsl:0}]){
   const q=ecefToGeodetic(geodeticToEcef(p));
   expect(haversineDistance(p,q)).toBeLessThan(1e-3);expect(Math.abs(q.altMsl-p.altMsl)).toBeLessThan(1e-3);
  }
 });
 test("ENU is metric and round-trips",()=>{
  const o={lat:28,lon:77,altMsl:0},p=destinationPoint(o,90,1000);
  // destinationPoint is spherical, ENU is ellipsoidal: they agree to ~0.3 %.
  const v=geodeticToEnu(p,o);expect(Math.abs(v.east-1000)).toBeLessThan(3);expect(Math.abs(v.north)).toBeLessThan(1);
  const back=enuToGeodetic({east:1234.5,north:-987.6,up:321},o),again=geodeticToEnu(back,o);
  expect(again.east).toBeCloseTo(1234.5,4);expect(again.north).toBeCloseTo(-987.6,4);expect(again.up).toBeCloseTo(321,4);
 });
 test("great-circle distance and bearing: Chennai → Delhi",()=>{
  const d=haversineDistance(VOMM.position,VIDP.position);
  expect(d).toBeGreaterThan(1_740_000);expect(d).toBeLessThan(1_780_000);
  const b=initialBearing(VOMM.position,VIDP.position);expect(b).toBeGreaterThan(340);expect(b).toBeLessThan(355);
  const q=destinationPoint(VOMM.position,b,d);expect(haversineDistance(q,VIDP.position)).toBeLessThan(1);
 });
});

describe("floating origin",()=>{
 test("rebases only beyond the threshold and keeps renderer coordinates small and float32-precise",()=>{
  const fo=new FloatingOrigin(VOMM.position,5000);
  expect(fo.update(destinationPoint(VOMM.position,0,4000)).rebased).toBe(false);
  const far={...destinationPoint(VOMM.position,340,1_500_000),altMsl:10_668};
  expect(fo.toLocal(far).z).toBeLessThan(-1_000_000); // before rebasing the numbers are huge
  const r=fo.update(far);expect(r.rebased).toBe(true);expect(fo.epoch).toBe(1);
  const near={...destinationPoint(far,45,350),altMsl:10_700},v=fo.toLocal(near);
  expect(Math.hypot(v.x,v.z)).toBeLessThan(400);expect(v.y).toBeCloseTo(10_700,0);
  const f32={x:Math.fround(v.x),y:Math.fround(v.y),z:Math.fround(v.z)};
  expect(haversineDistance(fo.fromLocal(f32),near)).toBeLessThan(0.01);
 });
});

describe("tiles",()=>{
 test("keys, bounds and containment",()=>{
  expect(lonLatToTile(0.0001,0.0001,1)).toEqual({z:1,x:1,y:0});
  const t=lonLatToTile(80.17,12.99,12),b=tileBounds(t);
  expect(80.17).toBeGreaterThanOrEqual(b.west);expect(80.17).toBeLessThan(b.east);expect(12.99).toBeLessThanOrEqual(b.north);expect(12.99).toBeGreaterThan(b.south);
  expect(parseTileKey(tileKey(t))).toEqual(t);expect(()=>parseTileKey("3/9/0")).toThrow();
 });
 test("tilesInRadius wraps the antimeridian and contains the centre",()=>{
  const ts=tilesInRadius({lat:-17,lon:179.95},30_000,10),n=2**10;
  expect(ts.some(t=>t.x===0)).toBe(true);expect(ts.some(t=>t.x===n-1)).toBe(true);
  const c=tilesInRadius({lat:28.5,lon:77.1},10_000,14);expect(c.map(tileKey)).toContain(tileKey(lonLatToTile(77.1,28.5,14)));
  expect(new Set(c.map(tileKey)).size).toBe(c.length);
 });
});

describe("level of detail",()=>{
 test("1,500 ft / 80 kt: very high detail with buildings near the aircraft",()=>{
  const r=lodRings({aglM:457,groundSpeedMps:41});
  expect(r.map(x=>x.level)).toEqual(["VERY_HIGH","HIGH","MEDIUM","LOW"]);expect(r[0]!.layers).toContain("buildings");expect(r[0]!.outerM).toBe(10_000);
 });
 test("35,000 ft / 450 kt: medium detail at most, no buildings or roads, rings stretched ahead, capped near the horizon",()=>{
  const r=lodRings({aglM:10_668,groundSpeedMps:231});
  expect(r[0]!.level).toBe("MEDIUM");for(const x of r){expect(x.layers).not.toContain("buildings");expect(x.layers).not.toContain("roads")}
  expect(r[0]!.outerM).toBeGreaterThan(19_000);expect(r[r.length-1]!.outerM).toBeLessThanOrEqual(600_000);
 });
});

describe("predictive planning",()=>{
 const pos={lat:13.3,lon:80.1,altMsl:600},vel={groundSpeedMps:200,trackDeg:0,verticalSpeedMps:0};
 test("current 100, 30 s ahead 90, 60 s ahead 70, behind 5",()=>{
  const plan=planTiles({position:pos,velocity:vel,aglM:600,layers:["terrain"]});
  const by=(p:{lat:number;lon:number},z:number)=>plan.find(r=>r.key===`terrain:${tileKey(lonLatToTile(p.lon,p.lat,z))}`);
  expect(plan[0]!.priority).toBe(PRIORITY.CURRENT);expect(by(pos,14)!.priority).toBe(100);
  expect(by(destinationPoint(pos,0,6000),14)!.priority).toBe(PRIORITY.AHEAD_30S);
  expect(by(destinationPoint(pos,0,12_000),14)!.priority).toBe(PRIORITY.AHEAD_60S);
  expect(by(destinationPoint(pos,0,24_000),14)!.priority).toBe(PRIORITY.AHEAD_120S);
  expect(by(destinationPoint(pos,180,30_000),12)!.priority).toBe(PRIORITY.BEHIND);
  for(let i=1;i<plan.length;i++)expect(plan[i-1]!.priority).toBeGreaterThanOrEqual(plan[i]!.priority);
 });
 test("deterministic: same state, same requests in the same order",()=>{
  const a=planTiles({position:pos,velocity:vel}),b=planTiles({position:pos,velocity:vel});expect(a.map(r=>r.key)).toEqual(b.map(r=>r.key));
 });
 test("with a route, prediction follows the route and the destination is requested",()=>{
  const route=planAirportRoute(VOMM,VIDP),start=route.pointAt(50_000);
  const plan=planTiles({position:start,velocity:{groundSpeedMps:231,trackDeg:(initialBearing(VOMM.position,VIDP.position)+90)%360,verticalSpeedMps:0},aglM:10_000,route});
  const dest=plan.filter(r=>r.reason==="DESTINATION");expect(dest.length).toBeGreaterThan(0);
  const ahead=plan.find(r=>r.reason==="AHEAD_120S")!;const c=tileBounds(ahead.tile);
  // 120 s along the route, not along the (90° off) track.
  expect(route.progress({lat:(c.north+c.south)/2,lon:(c.east+c.west)/2,altMsl:0}).crossTrackM).toBeLessThan(40_000);
 });
});

describe("LRU byte cache",()=>{
 test("evicts least recently used by bytes and rejects oversize entries",()=>{
  const evicted:string[]=[],c=new LruByteCache<string,number>(100,Infinity,k=>evicted.push(k));
  c.set("a",1,40);c.set("b",2,40);c.get("a");c.set("c",3,40);
  expect(evicted).toEqual(["b"]);expect(c.bytes).toBe(80);expect(c.set("huge",0,101)).toBe(false);expect(c.has("a")&&c.has("c")).toBe(true);
  c.touch("a");c.set("d",4,40);expect(evicted).toEqual(["b","c"]);
 });
});

function fakeSource(layer:"terrain"|"buildings",maxZoom=16){
 const pending=new Map<string,{resolve:(v:string)=>void;signal:AbortSignal}>(),loads:string[]=[];
 const src:TileSource<string>={layer,maxZoom,load:(t,signal)=>new Promise(resolve=>{const k=tileKey(t);loads.push(k);pending.set(k,{resolve,signal})}),sizeOf:()=>1000};
 const resolveAll=async()=>{for(let i=0;i<50&&pending.size;i++){const ps=[...pending.entries()];pending.clear();for(const [k,p] of ps)if(!p.signal.aborted)p.resolve(k);await Bun.sleep(0)}};
 return {src,pending,loads,resolveAll};
}

describe("WorldStreamer",()=>{
 const pos={lat:13.3,lon:80.1,altMsl:600};
 test("loads the highest priority first, within the concurrency limit, and caches",async()=>{
  const f=fakeSource("terrain"),loaded:string[]=[];
  const s=new WorldStreamer({sources:[f.src],maxConcurrent:3,onTile:t=>loaded.push(t.key)});
  const u=s.update(pos,{groundSpeedMps:60,trackDeg:0,verticalSpeedMps:0},undefined,600);
  expect(u.started.length).toBe(3);expect(u.started[0]).toBe(`terrain:${tileKey(lonLatToTile(80.1,13.3,14))}`);
  await f.resolveAll();expect(s.stats().loaded).toBeGreaterThan(3);
  expect(s.get<string>("terrain",lonLatToTile(80.1,13.3,14))).toBe(tileKey(lonLatToTile(80.1,13.3,14)));
  const again=s.update(pos,{groundSpeedMps:60,trackDeg:0,verticalSpeedMps:0},undefined,600);expect(again.started.length).toBeLessThanOrEqual(3);
  expect(again.started.some(k=>loaded.includes(k))).toBe(false);
  s.dispose();
 });
 test("a sharp turn aborts in-flight loads that are now behind",async()=>{
  const f=fakeSource("terrain");const s=new WorldStreamer({sources:[f.src],maxConcurrent:40});
  s.update(pos,{groundSpeedMps:200,trackDeg:0,verticalSpeedMps:0},undefined,600);
  const before=s.inFlight();
  const u=s.update(pos,{groundSpeedMps:200,trackDeg:180,verticalSpeedMps:0},undefined,600);
  expect(u.sharpTurn).toBe(true);expect(u.aborted.length).toBeGreaterThan(0);
  for(const k of u.aborted){expect(before).toContain(k);expect(f.pending.get(k.split(":")[1]!)?.signal.aborted).toBe(true)}
  const small=s.update(pos,{groundSpeedMps:200,trackDeg:190,verticalSpeedMps:0},undefined,600);expect(small.sharpTurn).toBe(false);
  s.dispose();
 });
 test("overzoom: requests deeper than the source's max zoom collapse onto one ancestor tile",()=>{
  const f=fakeSource("terrain",10);const s=new WorldStreamer({sources:[f.src],maxConcurrent:100});
  s.update(pos,{groundSpeedMps:0,trackDeg:0,verticalSpeedMps:0},undefined,300);
  expect(f.loads.every(k=>parseTileKey(k).z<=10)).toBe(true);expect(new Set(f.loads).size).toBe(f.loads.length);
  s.dispose();
 });
 test("the byte budget evicts tiles no longer wanted before wanted ones",async()=>{
  const f=fakeSource("terrain");const evicted:string[]=[],far=destinationPoint(pos,90,2_000_000),still={groundSpeedMps:0,trackDeg:0,verticalSpeedMps:0};
  // Budget: room for the second wanted set plus a little, so the first set has to make way.
  const budget=planTiles({position:far,velocity:still,aglM:10_000,layers:["terrain"]}).length+5;
  const s=new WorldStreamer({sources:[f.src],maxConcurrent:1000,cacheBytes:1000*budget,onEvict:t=>evicted.push(t.key)});
  s.update(pos,still,undefined,10_000);await f.resolveAll();
  s.update(far,{groundSpeedMps:0,trackDeg:0,verticalSpeedMps:0},undefined,10_000);await f.resolveAll();
  const wantedNow=new Set(s.wanted().map(r=>r.key));
  expect(evicted.length).toBeGreaterThan(0);expect(evicted.filter(k=>wantedNow.has(k)).length).toBe(0);
  expect(s.stats().cache.bytes).toBeLessThanOrEqual(1000*budget);expect(s.visible().length).toBe(wantedNow.size);
  s.dispose();
 });
});

function pngOf(width:number,height:number,rgb:(x:number,y:number)=>[number,number,number]){
 const raw=new Uint8Array(height*(width*3+1));
 for(let y=0;y<height;y++){raw[y*(width*3+1)]=y%2?2:0;for(let x=0;x<width;x++){const [r,g,b]=rgb(x,y),o=y*(width*3+1)+1+x*3;
  // filter 2 (Up) on odd rows: store the difference to the row above
  const up=y%2?rgb(x,y-1):[0,0,0];raw[o]=(r-up[0]!+256)&255;raw[o+1]=(g-up[1]!+256)&255;raw[o+2]=(b-up[2]!+256)&255}}
 const chunk=(type:string,data:Uint8Array)=>{const b=new Uint8Array(12+data.length),dv=new DataView(b.buffer);dv.setUint32(0,data.length);b.set(new TextEncoder().encode(type),4);b.set(data,8);return b};
 const ihdr=new Uint8Array(13),dv=new DataView(ihdr.buffer);dv.setUint32(0,width);dv.setUint32(4,height);ihdr[8]=8;ihdr[9]=2;
 const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",new Uint8Array(deflateSync(raw))),chunk("IEND",new Uint8Array())];
 const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out;
}

describe("terrain",()=>{
 test("Terrarium encode/decode round-trips to 1/256 m",()=>{
  for(const h of [-10_994,-0.5,0,52.3,8848.86]){const [r,g,b]=encodeTerrarium(h);expect(decodeTerrarium([r,g,b,255],1,1)[0]!).toBeCloseTo(h,2)}
 });
 test("PNG decoder reads filtered RGB rows into Terrarium heights",()=>{
  const tile:TileId={z:12,x:2958,y:1807},heightAt=(x:number,y:number)=>100+x*2+y*3;
  const png=pngOf(16,16,(x,y)=>encodeTerrarium(heightAt(x,y)));
  const img=decodePng(png,d=>new Uint8Array(inflateSync(d)));
  expect([img.width,img.height,img.channels]).toEqual([16,16,3]);
  const t=TerrainTile.fromTerrarium(tile,img.pixels,img.width,img.height,img.channels);
  expect(t.heights[5*16+7]!).toBeCloseTo(heightAt(7,5),2);
  const b=tileBounds(tile);expect(t.sample(b.north,b.west)).toBeCloseTo(100,2);expect(t.sample(b.south,b.east)).toBeCloseTo(heightAt(15,15),2);
 });
 test("terrain mesh is in the floating-origin frame and neighbouring tiles share edge vertices",()=>{
  const flat=(tile:TileId)=>new TerrainTile(tile,4,4,new Float32Array(16).fill(250));
  const a:TileId={z:12,x:2958,y:1807},b:TileId={z:12,x:2959,y:1807},fo=new FloatingOrigin({...tileBounds(a),lat:tileBounds(a).south,lon:tileBounds(a).east,altMsl:0});
  const ma=terrainMesh(flat(a),fo,8),mb=terrainMesh(flat(b),fo,8),n=9;
  expect(ma.positions.length).toBe(n*n*3);expect(ma.indices.length).toBe(8*8*6);
  for(let j=0;j<n;j++)for(let k=0;k<3;k++)expect(ma.positions[(j*n+8)*3+k]!).toBeCloseTo(mb.positions[(j*n)*3+k]!,2);
 });
});

describe("airports",()=>{
 test("OurAirports CSV: quoted fields, codes, runways, synthesized thresholds",()=>{
  expect(parseCsv('a,"b,""c""\nd",e\r\n1,2,3')).toEqual([["a",'b,"c"\nd',"e"],["1","2","3"]]);
  expect(index.find("maa")?.ident).toBe("VOMM");expect(index.find("DEL")?.name).toContain("Indira Gandhi");
  const rw=runwayGeometry(VOMM,VOMM.runways[0]!)!;
  expect(rw.synthesized).toBe(true);expect(haversineDistance(rw.le,rw.he)).toBeCloseTo(12001*0.3048,-1);expect(rw.headingDegT).toBe(72);
 });
 test("surveyed thresholds are used when present",()=>{
  const a=parseOurAirports('id,ident,type,name,latitude_deg,longitude_deg,elevation_ft\n1,TEST,small_airport,T,10,20,100','id,airport_ref,airport_ident,length_ft,width_ft,surface,lighted,closed,le_ident,le_latitude_deg,le_longitude_deg,le_elevation_ft,le_heading_degT,he_ident,he_latitude_deg,he_longitude_deg\n5,1,TEST,3000,60,ASP,1,0,18,10.01,20,100,180,36,9.99,20')[0]!;
  const g=runwayGeometry(a,a.runways[0]!)!;expect(g.synthesized).toBe(false);expect(g.headingDegT).toBeCloseTo(180,3);expect(a.position.altMsl).toBeCloseTo(30.48,2);
 });
 test("nearest alternates are sorted and exclude small strips",()=>{
  const near=index.nearest({lat:22.8,lon:77.0},3,isAlternateCandidate());
  expect(near.map(n=>n.airport.ident)).not.toContain("XX01");
  for(let i=1;i<near.length;i++)expect(near[i]!.distanceM).toBeGreaterThanOrEqual(near[i-1]!.distanceM);
  expect(index.nearest({lat:23.29,lon:77.34},1)[0]!.airport.ident).toBe("XX01");
 });
});

describe("routes",()=>{
 test("VOMM → VIDP: great-circle length, 3° descent, progress and cross-track",()=>{
  const r=planAirportRoute(VOMM,VIDP,{cruiseAltM:10_668});
  expect(Math.abs(r.totalM-haversineDistance(VOMM.position,VIDP.position))).toBeLessThan(50);
  expect(Math.max(...r.waypoints.map(w=>w.altMsl))).toBeCloseTo(10_668,0);expect(r.destination.altMsl).toBeCloseTo(VIDP.position.altMsl,0);
  const mid=r.pointAt(r.totalM/2),off=destinationPoint(mid,(initialBearing(mid,VIDP.position)+90)%360,5000),pr=r.progress(off);
  expect(Math.abs(pr.alongM-r.totalM/2)).toBeLessThan(200);expect(Math.abs(Math.abs(pr.crossTrackM)-5000)).toBeLessThan(50);
  const path=r.remainingPath(mid,100_000);expect(haversineDistance(path[0]!,mid)).toBeLessThan(50);expect(haversineDistance(path[0]!,path[path.length-1]!)).toBeCloseTo(100_000,-3);
 });
});

describe("simulation world",()=>{
 // Synthetic ridge: 1 m per 50 m north of 13.3°N plus a gentle east-west slope.
 const dem=(lat:number,lon:number)=>Math.max(0,(lat-13.3)*111_000/50)+(lon-80)*100;
 const tilesAround=(p:{lat:number;lon:number})=>tilesInRadius(p,12_000,SIM_ZOOM);
 test("queries and checksum are independent of load order; serialization round-trips",async()=>{
  const ts=tilesAround({lat:13.3,lon:80.1});
  const a=new SimulationWorld(),b=new SimulationWorld();
  for(const t of ts)a.add(extractSimulationTile(t,dem));for(const t of [...ts].reverse())b.add(extractSimulationTile(t,dem));
  expect(await a.checksum()).toBe(await b.checksum());
  const c=SimulationWorld.deserialize(JSON.parse(JSON.stringify(a.serialize())));expect(await c.checksum()).toBe(await a.checksum());
  expect(await c.missingFrom(await a.manifest())).toEqual([]);
  b.remove(ts[0]!);expect(await b.missingFrom(await a.manifest())).toEqual([tileKey(ts[0]!)]);
  for(const p of [{lat:13.31,lon:80.1},{lat:13.35,lon:80.05}]){expect(a.elevationAt(p.lat,p.lon)!).toBeCloseTo(dem(p.lat,p.lon),0);expect(a.elevationAt(p.lat,p.lon)).toBe(c.elevationAt(p.lat,p.lon))}
  expect(a.elevationAt(40,10)).toBeNull();
 });
 test("neighbouring tiles agree exactly on their shared edge",()=>{
  const t:TileId={z:SIM_ZOOM,x:2958,y:1870},u:TileId={...t,x:t.x+1},w=new SimulationWorld();w.add(extractSimulationTile(t,dem));w.add(extractSimulationTile(u,dem));
  const e=w.serialize();expect(e.length).toBe(2);
  for(let j=0;j<SIM_GRID;j++)expect(e[0]!.elevationDm[j*SIM_GRID+SIM_GRID-1]).toBe(e[1]!.elevationDm[j*SIM_GRID]!);
 });
 test("obstacles, runways and the situation the AI pilot sees",()=>{
  const p:GeoPosition={lat:13.25,lon:80.1,altMsl:400},w=new SimulationWorld();
  const route=new GreatCircleRoute([p,destinationPoint(p,0,200_000)]);
  const tower=buildingVolume("bldg:tower",[{lat:13.25,lon:80.1},{lat:13.2503,lon:80.1003}],10,450);
  const rwCenter=destinationPoint(p,90,3000),rw={airport:"TEST",ident:"09/27",le:destinationPoint(rwCenter,270,1500),he:destinationPoint(rwCenter,90,1500),headingDegT:90,lengthM:3000,widthM:45,synthesized:true};
  const tiles=simulationTilesForPath(route.waypoints,20_000);expect(tiles.every(t=>t.z===SIM_ZOOM)).toBe(true);
  for(const t of tiles){const b=tileBounds(t),inside=(q:{lat:number;lon:number})=>q.lat<=b.north&&q.lat>=b.south&&q.lon>=b.west&&q.lon<=b.east;
   w.add(extractSimulationTile(t,dem,{obstacles:inside(p)?[tower]:[],runways:inside(rw.le)?[rw]:[]}))}
  expect(w.obstacleAt(p)?.id).toBe("bldg:tower");expect(w.obstacleAt({...p,altMsl:500})).toBeUndefined();
  expect(w.runwayAt(rwCenter)?.ident).toBe("09/27");expect(w.runwayAt(destinationPoint(rwCenter,0,100))).toBeUndefined();
  const s=geoSituation(w,index,{...p,altMsl:3000},{groundSpeedMps:120,trackDeg:0,verticalSpeedMps:0},route,{mountainReliefM:800});
  expect(s.terrainClearanceM!).toBeCloseTo(3000-dem(p.lat,p.lon),0);expect(s.mountainRangeAhead).toBe(true);
  expect(s.terrainAhead.maxElevationM!).toBeGreaterThan(1000);expect(s.route!.crossTrackM).toBeCloseTo(0,0);
  expect(s.alternates[0]!.ident).toBe("VOMM");expect(s.alternates.length).toBe(3);
 });
});

test("attribution covers every data source whose layers are shown",()=>{
 expect(attributionFor(["terrain"]).join()).toContain("SRTM");expect(attributionFor(["buildings"]).join()).toContain("OpenStreetMap");
 expect(attributionFor(["airports"]).join()).toContain("OurAirports");
});
