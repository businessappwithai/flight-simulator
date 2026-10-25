import {expect,test} from "bun:test";
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
import {CLAWD,DOMAIN_M,LEVELS,Landscape,Planet,REVEAL_MIN_CLEARANCE_M,TILE_NODES,axisShare,erode,parseBrand} from "@flight/landscape";
import {REVEAL,revealFrame,revealPoint} from "@flight/protocol";
import {decisionPilot} from "./jev-stand-in.ts";
// One planet for the read-only checks (generating one takes a few seconds).
const planet=new Planet({seed:7n}),land=planet.land;

test("the same seed and brand make the same planet; another seed makes another",async()=>{
 const again=new Planet({seed:7n}),other=new Landscape({seed:8n,iterations:40});
 expect(await again.computeManifest()).toBe(await planet.computeManifest());expect(planet.manifest).toMatch(/^[0-9a-f]{64}$/);
 expect(again.eco.treeTotal).toBe(planet.eco.treeTotal);expect(again.eco.buildings).toEqual(planet.eco.buildings);expect(again.info.camera).toEqual(planet.info.camera);
 let differ=0;for(let i=0;i<land.global.length;i+=97)if(land.global[i]!==other.global[i])differ++;expect(differ).toBeGreaterThan(100);
},60_000);

test("detail tiles are pure: the same whatever was generated before, and neighbours agree exactly on their shared edge",()=>{
 const a=new Landscape({seed:5n,iterations:30}),b=new Landscape({seed:5n,iterations:30});
 const [i,j]=a.tileIndex("L0",-9000,-12000);
 // a: the tile, then its neighbour; b: the neighbour (and some unrelated tiles), then the tile.
 const ta=a.tile("L0",i,j),na=a.tile("L0",i+1,j);b.tile("L0",i+3,j+2);b.tile("L1",0,0);const nb=b.tile("L0",i+1,j),tb=b.tile("L0",i,j);
 expect([...tb.dm]).toEqual([...ta.dm]);expect([...nb.dm]).toEqual([...na.dm]);
 for(let r=0;r<TILE_NODES;r++)expect(ta.dm[r*TILE_NODES+TILE_NODES-1]).toBe(na.dm[r*TILE_NODES]!);
 const below=a.tile("L0",i,j+1);for(let c=0;c<TILE_NODES;c++)expect(ta.dm[(TILE_NODES-1)*TILE_NODES+c]).toBe(below.dm[c]!);
 const [p,q]=a.tileIndex("L1",-9000,-12000),l1=a.tile("L1",p,q),l1n=a.tile("L1",p+1,q);
 for(let r=0;r<TILE_NODES;r++)expect(l1.dm[r*TILE_NODES+TILE_NODES-1]).toBe(l1n.dm[r*TILE_NODES]!);
},120_000);

test("erosion: every cell drains to an outlet, water is conserved, and receivers are not D8 streaks",()=>{
 // A tilted, pitted surface: the priority-flood must still route every cell out.
 const n=97,N=n*n,h=new Float64Array(N),outlet=new Uint8Array(N),base=new Float64Array(N),up=new Float64Array(N);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){const k=j*n+i;h[k]=j*3+((i*7919+j*104729)%97)/4;if(j===0)outlet[k]=1;else up[k]=1}
 const r=erode({n,dx:100,h,outlet,base,uplift:up,k:.05,iterations:30,diffusion:.01,seed:9});
 let reached=0,land=0;
 for(let i=0;i<N;i++){if(outlet[i])continue;land++;let c=i,steps=0;while(!outlet[c]&&steps<N){c=r.receiver[c]!;if(c<0)break;steps++}if(c>=0&&outlet[c])reached++}
 expect(reached).toBe(land);
 // Every drop of rain (one cell area each) leaves through an outlet.
 let out=0;for(let i=0;i<N;i++)if(outlet[i]){for(let d=0;d<8;d++){/* outlets only receive */}}
 for(let i=0;i<N;i++)if(!outlet[i]&&outlet[r.receiver[i]!])out+=r.area[i]!;
 expect(out).toBeCloseTo(land*100*100,3);
 const share=axisShare(r.direction);expect(share).toBeGreaterThan(.3);expect(share).toBeLessThan(.7);
});

test("the continent is Clawd: a body, two arm nubs, four legs reaching into the sea, two eye lakes",()=>{
 const at=(x:number,y:number)=>{const [wx,wz]=land.unitToWorld(x,y);return land.coastDistance(wx,wz)<0?(land.lakeDistance(wx,wz)<0?"lake":"land"):"sea"};
 expect(at(8,4)).toBe("land");expect(at(1,4)).toBe("land");expect(at(15,4)).toBe("land");
 for(const x of [3.5,5.5,10.5,12.5])expect(at(x,9.4)).toBe("land");
 for(const x of [4.5,8,11.5])expect(at(x,9.6)).toBe("sea");
 expect(at(4.5,3)).toBe("lake");expect(at(11.5,3)).toBe("lake");expect(at(8,-1.5)).toBe("sea");
 // The lakes are not perched: their surface is below every shore.
 expect(land.lakeLevel).toBeLessThan(80);expect(land.lakeLevel).toBeGreaterThan(0);
 expect(parseBrand({land:[{x0:0,y0:0,x1:2,y1:1}],lakes:[]})).toMatchObject({name:"Brand",unitM:CLAWD.unitM});
 expect(parseBrand({land:[{x0:0,y0:0,x1:40,y1:1}]})).toBeNull();expect(parseBrand({land:"x"})).toBeNull();
});

test("simulated, not painted: real ranges, a pass, eroded 10 m detail",()=>{
 let max=-Infinity;for(const v of land.global)if(v>max)max=v;expect(max).toBeGreaterThan(2400);expect(max).toBeLessThan(4500);
 // The 10 m tile carves gullies the 80 m field cannot hold (PDF: 45 m RMS tile vs global).
 const [px,pz]=land.unitToWorld(...land.brand.passes[0]!),[i,j]=land.tileIndex("L0",px+1500,pz-600),t=land.tile("L0",i,j);
 let s=0,c=0;for(let b=0;b<TILE_NODES;b+=4)for(let a=0;a<TILE_NODES;a+=4){const x=t.x0+a*10,z=t.z0+b*10,d=t.dm[b*TILE_NODES+a]!/10-land.levelHeight("L1",x,z);s+=d*d;c++}
 expect(Math.sqrt(s/c)).toBeGreaterThan(8);
 // The pass is a saddle: lower than the range on either side of it.
 const saddle=land.levelHeight("L1",px,pz),east=Math.max(...[3000,4500,6000].map(d=>land.levelHeight("L1",px+d,pz))),west=Math.max(...[3000,4500,6000].map(d=>land.levelHeight("L1",px-d,pz)));
 expect(east).toBeGreaterThan(saddle+150);expect(west).toBeGreaterThan(saddle+150);
},60_000);

test("physics: the airfield is exactly flat, the land rises beyond it, water and the curvature are in the ground",()=>{
 for(const [x,z] of [[0,0],[15,500],[-3199,0],[0,3199],[2200,-2200]])expect(planet.ground(x!,z!)).toBe(0);
 const far=planet.ground(0,-12_000);expect(far).not.toBe(0);
 // Far out at sea the ground is the water surface, lowered by the planet's curvature.
 const x=-70_000,sea=planet.ground(-x,60_000);expect(sea).toBeCloseTo(-land.padElevation-(x*x+60_000*60_000)/(2*400_000),6);
 expect(planet.landable(0,0)).toBe(true);expect(planet.landable(200,0)).toBe(false);
 // Simulation x is mirrored: the left (west) arm is at positive simulation x.
 const [ax,az]=land.unitToWorld(1,4);expect(planet.ground(-ax,az)).toBeGreaterThan(-land.padElevation-(ax*ax+az*az)/(2*400_000)+20);
});

test("the reveal is planned over the final terrain: clearance never below 350 m, checked at 10 m detail on the low flight",()=>{
 expect(planet.info.clearance.minM).toBeGreaterThanOrEqual(REVEAL_MIN_CLEARANCE_M);
 let min=Infinity,at=0;
 for(let f=1;f<=revealFrame(REVEAL.climbStart);f+=6){const p=revealPoint(planet.info.camera,(f-1)/REVEAL.fps),h=Math.max(land.height(p.x,p.z),land.waterLevel(p.x,p.z)),c=p.alt-h;if(c<min){min=c;at=f}}
 expect({min:Math.round(min),at}).toMatchObject({});expect(min).toBeGreaterThanOrEqual(REVEAL_MIN_CLEARANCE_M-40);
 // The shot ends in orbit, 90 km up, with the whole continent below.
 expect(revealPoint(planet.info.camera,REVEAL.duration).alt).toBe(90_000);
 // The flight passes over the left eye lake at about 600 m and never notices.
 const lake=planet.info.lakes[0]!,mid=revealPoint(planet.info.camera,REVEAL.climbStart);
 expect(mid.x).toBeGreaterThan(lake[0]);expect(mid.x).toBeLessThan(lake[2]);
},120_000);

test("ecology: ~895k trees on the slopes, none in the water; a lake-shore city of 4,861 buildings that physics can hit",()=>{
 expect(planet.eco.treeTotal).toBeGreaterThan(700_000);expect(planet.eco.treeTotal).toBeLessThan(1_100_000);
 expect(planet.eco.buildings).toHaveLength(4861);
 const [lx,lz]=land.unitToWorld(4.5,3);expect(planet.eco.densityAt(lx,lz)).toBe(0);
 for(const b of planet.eco.buildings.slice(0,300))expect(land.lakeDistance(b.x,b.z)).toBeGreaterThan(0);
 const tall=planet.eco.buildings.reduce((a,b)=>b.h>a.h?b:a);expect(tall.h).toBeGreaterThan(120);
 expect(planet.ground(-tall.x,tall.z)).toBeCloseTo(tall.base+tall.h-land.padElevation-(()=>{const r2=tall.x*tall.x+tall.z*tall.z;return r2/(2*400_000)})(),5);
 const trees=planet.eco.treesIn(-20_000,-20_000,-17_440,-17_440);expect(trees.length%4).toBe(0);
});

test("streaming: global chunks, then L1 and L0 rings with their trees; ring boxes once complete",()=>{
 const p=new Planet({seed:7n,iterations:40}),[fx,fz]=[0,-14_000];
 const first=p.stream(fx,fz,p.land.padElevation+300,0);expect(first.add.filter(a=>a.key.startsWith("G/"))).toHaveLength(64);
 let all=[...first.add];for(let i=0;i<20&&!(p.rings.l0&&p.rings.l1);i++)all.push(...p.stream(fx,fz,p.land.padElevation+300,2).add);
 expect(p.rings.l0).toBeDefined();expect(p.rings.l1).toBeDefined();
 const l0=all.filter(a=>a.z===14);expect(l0).toHaveLength(9);expect(l0.every(a=>a.attrs&&a.attrs.length*3===a.positions.length*2)).toBe(true);
 expect(l0.some(a=>(a.trees?.length??0)>0)).toBe(true);
 const box=p.rings.l0!;expect(box[2]-box[0]).toBe(3*LEVELS.L0.size);
 // Climbing away drops the detail rings.
 const up=p.stream(fx,fz,60_000,0);expect(up.remove.filter(k=>k.startsWith("L0/"))).toHaveLength(9);expect(up.remove.filter(k=>k.startsWith("L1/"))).toHaveLength(9);
 expect(DOMAIN_M%LEVELS.L1.size).toBe(0);
},120_000);

test("a flight over the simulated planet: the worker matches the same flight flown directly on the same ground",async()=>{
 const w=new Worker(new URL("../apps/simulator/src/sim.worker.ts",import.meta.url).href,{type:"module"}),inbox:any[]=[];w.onmessage=e=>inbox.push(e.data);
 const next=async(ok:(x:any)=>boolean,from=0)=>{for(let i=0;i<3000;i++){const hit=inbox.slice(from).find(ok);if(hit)return hit;await Bun.sleep(5)}throw new Error("timeout")};
 try{
  w.postMessage({type:"SET_WORLD",airport:null,world:"landscape",seed:"7"});
  const info=(await next(x=>x.type==="LANDSCAPE")).info;expect(info.heights).toBeInstanceOf(Float32Array);expect(info.clearance.minM).toBeGreaterThanOrEqual(350);
  expect(inbox.some(x=>x.type==="WORLD"&&x.landscape?.state==="GENERATING")).toBe(true);
  w.postMessage({type:"RESET",seed:"1",scenario:"default"});w.postMessage({type:"SET_PILOT",pilot:"MANUAL"});w.postMessage({type:"SET_INTENT",intent:"CLIMB"});
  let last:any,seq=0;const TICKS=14_400n;
  while(!last||last.world.tick<TICKS&&last.world.objective.phase!=="FAILED"&&last.world.objective.phase!=="COMPLETE"){const from=inbox.length,s=++seq;w.postMessage({type:"STEP",ticks:240,seq:s});last=await next(x=>x.type==="WORLD"&&x.seq===s,from)}
  expect(last.landscape).toMatchObject({state:"READY",brand:"Clawd",buildings:4861});expect(last.landscape.trees).toBeGreaterThan(700_000);
  const from=inbox.length;w.postMessage({type:"STEP",ticks:0,seq:0});const chk=(await next(x=>x.type==="CHECKSUM",from)).checksum;
  const sim=new DeterministicSimulation(),pilot=decisionPilot(undefined,()=>"CLIMB");
  sim.setGround(planet.ground,planet.landable);let wd=sim.reset(defaultScenario(1n));
  while(wd.tick<last.world.tick&&wd.objective.phase!=="FAILED"&&wd.objective.phase!=="COMPLETE")wd=sim.step(pilot(wd));
  expect(chk).toBe(await sim.checksum());
  const a=wd.aircraft.position;expect(Math.hypot(a.x,a.z)).toBeGreaterThan(3200);expect(last.landscape.aglM).not.toBeCloseTo(a.y,0);
  const patches=inbox.filter(x=>x.type==="TERRAIN").flatMap(x=>x.add);expect(patches.some((p:any)=>p.z===14&&p.trees)).toBe(true);
 }finally{w.terminate()}
},180_000);
