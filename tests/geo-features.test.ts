import {describe,expect,test} from "bun:test";
import {gzipSync} from "node:zlib";
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
import {
 AirportIndex,AnchorFrame,Compression,FeatureWorld,GeoWorld,PMTilesReader,SAMPLE_AIRPORTS_CSV,SAMPLE_RUNWAYS_CSV,TerrainTile,decodeMvt,defaultBuildingHeight,
 encodeMvt,featureTile,haversineDistance,lonLatToTile,lonLatToTilePoint,parseOpenMapTiles,pointInRings,refMatches,ringArea,runwayAnchor,surveyedRunwayAnchor,
 tileBounds,tileKey,triangulate,vectorSources,writePMTiles,zxyToTileId,type LonLat,type MvtFeature,type TileId,type TileSource,
} from "@flight/geospatial";
import type {FeaturePatch} from "@flight/protocol";

const index=new AirportIndex(parseOurAirportsSample());
function parseOurAirportsSample(){return (require("@flight/geospatial") as typeof import("@flight/geospatial")).parseOurAirports(SAMPLE_AIRPORTS_CSV,SAMPLE_RUNWAYS_CSV)}
const VOMM=index.require("VOMM");
/** VOMM 07/25 centreline as mapped in OpenStreetMap (via Overture 2026-09-23.1). */
const RWY_07_25:LonLat[]=[[80.1529491,12.9841489],[80.1686992,12.9900653],[80.1844492,12.9959816]];

// ---- Fixture: an OpenMapTiles-schema PMTiles archive built from lon/lat features.
interface FixtureBuilding{ring:LonLat[];height?:number}interface FixtureAeroway{kind:string;ref?:string;line?:LonLat[];ring?:LonLat[]}
function orient(t:TileId,ring:LonLat[],exterior:boolean){const pts=ring.map(p=>lonLatToTilePoint(t,4096,p[0],p[1]));const a=ringArea(pts);return (exterior?a<0:a>0)?pts.reverse():pts}
function archive(buildings:FixtureBuilding[],aeroways:FixtureAeroway[]){
 const tiles=new Map<string,{tile:TileId;b:MvtFeature[];a:MvtFeature[]}>(),at=(t:TileId)=>tiles.get(tileKey(t))??tiles.set(tileKey(t),{tile:t,b:[],a:[]}).get(tileKey(t))!;let id=0;
 for(const b of buildings){const c=b.ring.reduce((s,p)=>[s[0]+p[0]/b.ring.length,s[1]+p[1]/b.ring.length],[0,0]),t=lonLatToTile(c[0],c[1],14);
  at(t).b.push({id:++id,type:3,properties:b.height!==undefined?{render_height:b.height}:{},geometry:[orient(t,b.ring,true)]})}
 for(const a of aeroways){const pts=a.line??a.ring!,xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),lo=lonLatToTile(Math.min(...xs),Math.max(...ys),14),hi=lonLatToTile(Math.max(...xs),Math.min(...ys),14);
  for(let x=lo.x;x<=hi.x;x++)for(let y=lo.y;y<=hi.y;y++){const t={z:14,x,y};at(t).a.push({id:++id,type:a.line?2:3,properties:{class:a.kind,...(a.ref?{ref:a.ref}:{})},geometry:a.line?[a.line.map(p=>lonLatToTilePoint(t,4096,p[0],p[1]))]:[orient(t,a.ring!,true)]})}}
 return writePMTiles([...tiles.values()].map(v=>({tile:v.tile,data:gzipSync(encodeMvt([{name:"building",extent:4096,features:v.b},{name:"aeroway",extent:4096,features:v.a}]))})),{compress:b=>gzipSync(b),tileCompression:Compression.Gzip});
}
/** fetch() serving one archive with HTTP Range, optionally slow or failing. */
function rangeFetch(bytes:Uint8Array,delay=()=>0,fail=false):typeof fetch{return (async(_u:string|URL|Request,init?:RequestInit)=>{await Bun.sleep(delay());if(fail)throw new Error("offline");
 const m=/bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range")??"")!;return new Response(bytes.slice(+m[1]!,+m[2]!+1),{status:206})}) as typeof fetch}
const square=(c:LonLat,halfM:number):LonLat[]=>{const dLat=halfM/110_574,dLon=halfM/(111_320*Math.cos(c[1]*Math.PI/180));return [[c[0]-dLon,c[1]-dLat],[c[0]+dLon,c[1]-dLat],[c[0]+dLon,c[1]+dLat],[c[0]-dLon,c[1]+dLat],[c[0]-dLon,c[1]-dLat]]};
const flatTerrain=(h=20):TileSource<TerrainTile>=>({layer:"terrain",maxZoom:15,sizeOf:t=>t.byteLength,load:async t=>new TerrainTile(t,8,8,new Float32Array(64).fill(h))});

describe("vector tiles",()=>{
 test("MVT polygons keep holes and orientation; lines and properties round-trip",()=>{
  const outer:[number,number][]=[[100,100],[900,100],[900,900],[100,900],[100,100]],hole:[number,number][]=[[300,300],[300,600],[600,600],[600,300],[300,300]];
  expect(ringArea(outer)).toBeGreaterThan(0);expect(ringArea(hole)).toBeLessThan(0);
  const [l]=decodeMvt(encodeMvt([{name:"building",extent:4096,features:[{id:5,type:3,properties:{render_height:31.5},geometry:[outer,hole]}]}]));
  expect(l!.features[0]).toEqual({id:5,type:3,properties:{render_height:31.5},geometry:[outer,hole]});
 });
 test("PMTiles: Hilbert ids match the spec and archives with leaf directories read back",async()=>{
  expect([zxyToTileId(0,0,0),zxyToTileId(1,0,0),zxyToTileId(1,0,1),zxyToTileId(1,1,1),zxyToTileId(1,1,0),zxyToTileId(2,0,0)]).toEqual([0,1,2,3,4,5]);
  const tiles=Array.from({length:300},(_,i)=>({tile:{z:14,x:11600+(i%20),y:7500+Math.floor(i/20)},data:new TextEncoder().encode(`tile ${i}`)}));
  for(const leafSize of [undefined,32]){const bytes=writePMTiles(tiles,{compress:b=>gzipSync(b),leafSize}),r=new PMTilesReader(async(o,n)=>bytes.slice(o,o+n));
   for(const i of [0,31,32,150,299])expect(new TextDecoder().decode((await r.tile(tiles[i]!.tile))!)).toBe(`tile ${i}`);expect(await r.tile({z:14,x:1,y:1})).toBeUndefined()}
 });
 test("OpenMapTiles parsing: heights, deterministic defaults, runway refs",()=>{
  const t=lonLatToTile(80.17,12.99,14),bytes=encodeMvt([{name:"building",extent:4096,features:[{id:1,type:3,properties:{render_height:44},geometry:[[[10,10],[60,10],[60,60],[10,60],[10,10]]]},{id:2,type:3,properties:{},geometry:[[[100,100],[160,100],[160,160],[100,160],[100,100]]]}]},
   {name:"aeroway",extent:4096,features:[{id:3,type:2,properties:{class:"runway",ref:"07/25"},geometry:[[[0,0],[4096,4096]]]},{id:4,type:1,properties:{class:"gate"},geometry:[[[5,5]]]}]}]);
  const v=parseOpenMapTiles(t,bytes);
  expect(v.buildings.map(b=>b.heightM)).toEqual([44,defaultBuildingHeight("building:2")]);expect(defaultBuildingHeight("x")).toBe(defaultBuildingHeight("x"));
  expect(v.aeroways).toHaveLength(1);expect(v.aeroways[0]).toMatchObject({kind:"runway",ref:"07/25",widthM:45});
  expect(refMatches("07/25","7")).toBe(true);expect(refMatches("09L/27R","27r")).toBe(true);expect(refMatches("09L/27R","27L")).toBe(false);expect(refMatches(undefined,"07")).toBe(false);
 });
 test("triangulation covers concave footprints exactly; point-in-polygon honours holes",()=>{
  const L=[0,0,10,0,10,4,4,4,4,10,0,10],idx=triangulate(L);let a=0;
  for(let i=0;i<idx.length;i+=3){const [p,q,r]=[idx[i]!,idx[i+1]!,idx[i+2]!];a+=Math.abs((L[q*2]!-L[p*2]!)*(L[r*2+1]!-L[p*2+1]!)-(L[r*2]!-L[p*2]!)*(L[q*2+1]!-L[p*2+1]!))/2}
  expect(idx.length).toBe(12);expect(a).toBeCloseTo(64,9);
  const ring:LonLat[]=[[0,0],[10,0],[10,10],[0,10],[0,0]],hole:LonLat[]=[[4,4],[6,4],[6,6],[4,6],[4,4]];
  expect(pointInRings(2,2,[ring,hole])).toBe(true);expect(pointInRings(5,5,[ring,hole])).toBe(false);expect(pointInRings(11,5,[ring])).toBe(false);
 });
});

describe("surveyed runways",()=>{
 test("VOMM 07 from its OSM centreline: heading, length and threshold replace the synthesized runway",()=>{
  const syn=runwayAnchor(VOMM,"07"),s=surveyedRunwayAnchor(syn,VOMM.position,[{id:"r",kind:"runway",ref:"07/25",line:RWY_07_25,widthM:45}])!;
  expect(s.synthesized).toBe(false);expect(s.headingDegT).toBeCloseTo(68.9,1);expect(s.lengthM!).toBeCloseTo(3658,-1);
  expect(haversineDistance(s.anchor,{lat:12.9841489,lon:80.1529491})).toBeCloseTo(320,0);
  const back=surveyedRunwayAnchor(runwayAnchor(VOMM,"25"),VOMM.position,[{id:"r",kind:"runway",ref:"07/25",line:RWY_07_25,widthM:45}])!;expect(back.headingDegT).toBeCloseTo(248.9,1);
  expect(surveyedRunwayAnchor(syn,VOMM.position,[{id:"r",kind:"runway",ref:"12/30",line:RWY_07_25,widthM:45}])).toBeUndefined();
 });
});

// A city 6 km down runway 07 (a 60 m tower in a block of 25 m buildings), and a second runway 18/36 9 km out.
function scenario(){
 const anchor=surveyedRunwayAnchor(runwayAnchor(VOMM,"07"),VOMM.position,[{id:"r",kind:"runway",ref:"07/25",line:RWY_07_25,widthM:45}])!;
 const f=new AnchorFrame({...anchor.anchor,altMsl:20},anchor.headingDegT),ll=(x:number,z:number):LonLat=>{const g=f.toGeo({x,y:0,z});return [g.lon,g.lat]};
 const buildings:FixtureBuilding[]=[{ring:square(ll(0,6000),40),height:60},{ring:square(ll(0,1500),30),height:40}]; // the second sits on the airfield
 for(let i=-4;i<=4;i++)for(let j=0;j<4;j++)if(i||j)buildings.push({ring:square(ll(i*120,6000+j*120),25),height:25});
 const other:LonLat[]=[ll(0,8500),ll(0,9500)];
 return {anchor,frame:f,ll,buildings,aeroways:[{kind:"runway",ref:"07/25",line:RWY_07_25},{kind:"runway",ref:"18/36",line:other},{kind:"apron",ring:square(ll(80,300),60)}] as FixtureAeroway[]};
}
const world=(bytes:Uint8Array,o:{delay?:()=>number;fail?:boolean;onFeatures?:(a:FeaturePatch[],r:string[])=>void}={})=>new GeoWorld({airports:index,airport:"VOMM",runway:"07",terrain:flatTerrain(),
 features:vectorSources({url:"http://fixture/features.pmtiles",fetch:rangeFetch(bytes,o.delay,o.fail)}),simRetries:1,surveyTimeoutMs:3000,patchDebounceMs:1,maxConcurrent:64,...(o.onFeatures?{onFeatures:o.onFeatures}:{})});

describe("buildings and runways in the physics",()=>{
 const sc=scenario(),bytes=archive(sc.buildings,sc.aeroways);
 test("the runway is surveyed, buildings raise the ground (not on the airfield), real runways are landable",async()=>{
  const g=world(bytes);await g.prepare();
  expect(g.runway.synthesized).toBe(false);expect(g.runway.headingDegT).toBeCloseTo(sc.anchor.headingDegT,1);expect(g.featuresState).toBe("READY");
  await g.ensureAround(0,6000);await g.ensureAround(0,9000);
  const terrain=g.terrainY(0,6000);expect(g.ground(0,6000)).toBeCloseTo(terrain+60,1);expect(g.ground(60,5800)).toBeCloseTo(g.terrainY(60,5800),6);
  expect(g.ground(0,1500)).toBe(0); // airfield: no real buildings
  expect(g.landable(0,9000)).toBe(true);expect(g.landable(100,9000)).toBe(false);expect(g.landable(0,0)).toBe(false);
  const s=g.status({position:{x:0,y:g.ground(0,9000),z:9000},velocity:{x:0,y:0,z:0},heading:0});
  expect(s).toMatchObject({surveyed:true,runwayBelow:"18/36",features:{state:"READY"}});expect(s.features.buildings).toBeGreaterThan(30);
  g.dispose();
 });
 test("flying into the tower is a crash; a gentle touchdown on the far runway is a landing, anywhere else it is not",async()=>{
  const g=world(bytes);await g.prepare();await g.ensureAround(0,6000);await g.ensureAround(0,9000);
  const fly=(z:number,y:number,vy:number,ticks:number)=>{const sim=new DeterministicSimulation();sim.setGround(g.ground,g.landable);const w0=sim.reset(defaultScenario(1n)),s=sim.snapshot();
   sim.restore({...s,aircraft:{...w0.aircraft,position:{x:0,y,z},velocity:{x:0,y:vy,z:40},pitch:Math.asin(vy/40),throttle:.3,grounded:false}});let w=w0;
   for(let i=0;i<ticks;i++)w=sim.step({aileron:0,elevator:0,rudder:0,throttle:.35});return w};
  const t=g.terrainY(0,6000),hit=fly(5700,t+30,0,120*12);expect(hit.objective.phase).toBe("FAILED");expect(hit.aircraft.position.y).toBeCloseTo(g.ground(hit.aircraft.position.x,hit.aircraft.position.z),3);
  const land=fly(8700,g.terrainY(0,8700)+4,-1.5,120*4);expect(land.aircraft.grounded).toBe(true);expect(land.aircraft.crashed).toBe(false);expect(land.objective.phase).not.toBe("FAILED");
  const field=fly(7300,g.terrainY(0,7300)+4,-1.5,120*4);expect(field.aircraft.crashed).toBe(true);
  g.dispose();
 });
 test("with buildings, physics is still independent of how slowly tiles arrive",async()=>{
  async function run(delay:()=>number){
   const g=world(bytes,{delay});await g.prepare();const sim=new DeterministicSimulation();sim.setGround(g.ground,g.landable);let w=sim.reset(defaultScenario(1n)),holds=0;
   const climb=(a:typeof w.aircraft)=>{const v=Math.hypot(a.velocity.x,a.velocity.y,a.velocity.z),target=v<30?0:a.position.y<140?.1:0;return {aileron:-a.roll*2,elevator:(target-a.pitch)*4,rudder:0,throttle:1}};
   for(let step=0;step<70;step++){const wait=g.ensureAround(w.aircraft.position.x,w.aircraft.position.z);if(wait){holds++;await wait;step--;continue}for(let i=0;i<240;i++)w=sim.step(climb(w.aircraft))}
   const out={chk:await sim.checksum(),phase:w.objective.phase,z:w.aircraft.position.z,holds,features:await g.featureWorld.checksum()};g.dispose();return out;
  }
  const fast=await run(()=>0),slow=await run(()=>Math.floor(Math.random()*20));
  expect(slow.chk).toBe(fast.chk);expect(slow.features).toBe(fast.features);expect(fast.z).toBeGreaterThan(9000);expect(fast.holds).toBeGreaterThan(0);
  // Climbing to ~140 m clears the 60 m tower: the flight continues.
  expect(fast.phase).not.toBe("FAILED");
 },30_000);
 test("unreachable feature source: synthesized runway, no buildings, and the flight still works",async()=>{
  const g=world(bytes,{fail:true});await g.prepare();expect(g.state).toBe("READY");expect(g.featuresState).toBe("UNAVAILABLE");expect(g.runway.synthesized).toBe(true);
  expect(g.ensureAround(0,6000)).not.toBeNull();await g.ensureAround(0,6000);expect(g.ground(0,6000)).toBeCloseTo(g.terrainY(0,6000),6);
  expect(g.status({position:{x:0,y:0,z:0},velocity:{x:0,y:0,z:0},heading:0}).features).toMatchObject({state:"UNAVAILABLE",buildings:0});g.dispose();
 });
});

describe("feature meshes",()=>{
 const sc=scenario(),bytes=archive(sc.buildings,sc.aeroways);
 test("buildings stream as extruded meshes off the airfield; runways bring edge lights",async()=>{
  const got=new Map<string,FeaturePatch>(),g=world(bytes,{onFeatures:(a,r)=>{for(const k of r)got.delete(k);for(const p of a)got.set(p.key,p)}});
  await g.prepare();g.update({position:{x:0,y:0,z:4500},velocity:{x:0,y:0,z:1},heading:0});
  for(let i=0;i<300&&![...got.values()].some(p=>p.layer==="buildings");i++)await Bun.sleep(10);await Bun.sleep(50);
  const b=[...got.values()].filter(p=>p.layer==="buildings"),a=[...got.values()].filter(p=>p.layer==="airports");
  expect(b.length).toBeGreaterThan(0);expect(a.some(p=>(p.lights?.length??0)>0)).toBe(true);
  const tops=b.flatMap(p=>{const ys:number[]=[];for(let i=1;i<p.positions.length;i+=3)ys.push(p.positions[i]!+p.center[1]);return ys});
  expect(Math.max(...tops)).toBeCloseTo(g.terrainY(0,6000)+60,0);
  // The 40 m building on the airfield is not drawn.
  expect(tops.some(y=>Math.abs(y-40)<0.2)).toBe(false);
  for(const p of b){expect(p.positions.length%9).toBe(0);expect(p.colors.length).toBe(p.positions.length)}
  g.dispose();
 },20_000);
});

test("feature tiles hash the same whatever order their buildings arrive in",async()=>{
 const t=lonLatToTile(80.2,13,14),b=tileBounds(t),c:LonLat=[(b.west+b.east)/2,(b.north+b.south)/2];
 const one={tile:t,buildings:[{id:"a",rings:[square(c,10)],heightM:10,minHeightM:0},{id:"b",rings:[square([c[0]+.001,c[1]],10)],heightM:12,minHeightM:0}],aeroways:[],byteLength:0};
 const w1=new FeatureWorld(),w2=new FeatureWorld();w1.add(featureTile(one));w2.add(featureTile({...one,buildings:[...one.buildings].reverse()}));
 expect(await w1.checksum()).toBe(await w2.checksum());expect(w1.buildingTopAt(c[0],c[1])).toBe(10);
});
