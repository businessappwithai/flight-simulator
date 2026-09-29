import {expect,test} from "bun:test";
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
import {GeoWorld,encodeCatalog,decodeCatalog,searchAirports,haversineDistance} from "@flight/geospatial";
import {catalogIndex,demSource,inland} from "./geo-route.helpers.ts";
import {flyDecisions} from "./jev-stand-in.ts";

const catalog=catalogIndex();

test("the shipped catalogue has the world's airports, with surveyed runway ends where OurAirports has them",()=>{
 expect(catalog.size).toBeGreaterThan(20_000);
 for(const code of ["VOMM","VOBL","KSFO","EGLL","NZQN","SCIP","FAOR","VNKT"])expect(catalog.find(code)).toBeDefined();
 const vomm=catalog.require("VOMM"),r=vomm.runways.find(x=>x.le.ident==="07")!;
 expect(r.le.position).toBeDefined();expect(r.le.headingDegT).toBeCloseTo(68.7,0);
 // IATA codes resolve too; encode → decode round-trips.
 expect(catalog.find("MAA")?.ident).toBe("VOMM");
 const again=decodeCatalog(encodeCatalog([vomm],"test","now"))[0]!;expect(again.runways[0]!.le.position!.lat).toBeCloseTo(r.le.position!.lat,4);
});

test("airport search: exact codes first, then names and cities, larger airports first",()=>{
 expect(searchAirports(catalog.airports,"vobl")[0]!.ident).toBe("VOBL");
 expect(searchAirports(catalog.airports,"BLR")[0]!.ident).toBe("VOBL");
 const chennai=searchAirports(catalog.airports,"chennai",5);expect(chennai[0]!.ident).toBe("VOMM");
 expect(searchAirports(catalog.airports,"queenstown",20).map(a=>a.ident)).toContain("NZQN");
 expect(searchAirports(catalog.airports,"   ")).toEqual([]);
 expect(searchAirports(catalog.airports,"a",7)).toHaveLength(7);
});

test("cross-country on decisions: Chennai → Bengaluru, re-anchoring every 25 km, landing on the destination runway",async()=>{
 // Every control input comes from pilot intents chosen from the observation (the stand-in for Jev), as in the simulator.
 const r=await flyDecisions({airports:catalog,from:"VOMM",runway:"07",to:"VOBL"});
 expect(r.w.objective.phase).toBe("COMPLETE");expect(r.w.aircraft.crashed).toBe(false);
 expect(r.status.arrived).toBe("VOBL");expect(r.status.runwayBelow).toBe("VOBL 09L/27R");
 // ~265 km: about ten re-anchorings, each moving the frame (and the home airfield) under the aircraft.
 expect(r.rebases).toBeGreaterThanOrEqual(8);expect(r.status.frameEpoch).toBe(r.rebases);
 expect(Math.hypot(r.w.aircraft.position.x,r.w.aircraft.position.z)).toBeLessThan(25_001);
 expect(Math.hypot(r.status.home.position[0],r.status.home.position[2])).toBeGreaterThan(200_000);
 for(const intent of ["CLIMB","TURN_LEFT","TURN_RIGHT","DESCEND","HOLD","SLOW"] as const)expect(r.intents.map(x=>x.intent)).toContain(intent);
 expect(r.status.route).toMatchObject({destination:"VOBL",phase:"FINAL"});expect(r.status.route!.distanceM).toBeLessThan(4000);expect(Math.abs(r.status.route!.crossTrackM)).toBeLessThan(23);
 // The DEM put Bengaluru ~750 m above Chennai; the aircraft is on the ground there.
 expect(r.status.position.altMsl).toBeGreaterThan(600);expect(r.status.aglM!).toBeCloseTo(0,1);
},120_000);

test("a route flight is the same however slowly terrain arrives, and lands on a catalogue runway without buildings data",async()=>{
 const fast=await flyDecisions({airports:catalog,from:"VOMM",runway:"07",to:"VOAR"});
 const slow=await flyDecisions({airports:catalog,from:"VOMM",runway:"07",to:"VOAR",delayMs:()=>Math.floor(Math.random()*8)});
 expect(fast.w.objective.phase).toBe("COMPLETE");expect(fast.status.arrived).toBe("VOAR");expect(fast.rebases).toBeGreaterThanOrEqual(2);
 expect(slow.holds).toBeGreaterThan(0);
 expect(slow.checksum).toBe(fast.checksum);expect(slow.w.tick).toBe(fast.w.tick);
},120_000);

test("re-anchoring moves the frame, not the aircraft: position, speed, track and terrain height are continuous",async()=>{
 const g=new GeoWorld({airports:catalog,airport:"VOMM",runway:"07",destination:"VOBL",terrain:demSource(inland)});await g.prepare();
 const sim=new DeterministicSimulation();sim.setGround(g.ground,g.landable);sim.reset(defaultScenario(1n));
 const before={...sim.snapshot()},a=before.aircraft;
 const moved={...before,aircraft:{...a,position:{x:-18_000,y:1500,z:19_000},velocity:{x:-40,y:3,z:70},heading:Math.atan2(-40,70),pitch:.04,grounded:false}};
 await g.ensureAround(-18_000,19_000);
 const geoBefore=g.frame.toGeo(moved.aircraft.position),trackBefore=g.frame.bearing(moved.aircraft.heading),groundBefore=g.frame.toGeo({x:-18_000,y:g.ground(-18_000,19_000),z:19_000}).altMsl;
 const out=g.maybeRebase(moved)!;expect(out).toBeDefined();expect(g.frameEpoch).toBe(1);
 const p=out.aircraft.position;expect(Math.hypot(p.x,p.z)).toBeLessThan(20); // the new origin is under the aircraft on the ground; at 1.5 km up the old "up" leans ~6 m
 expect(haversineDistance(g.frame.toGeo(p),geoBefore)).toBeLessThan(.01);expect(g.frame.toGeo(p).altMsl).toBeCloseTo(geoBefore.altMsl,2);
 const v=out.aircraft.velocity;expect(Math.hypot(v.x,v.y,v.z)).toBeCloseTo(Math.hypot(-40,3,70),3);
 // Same direction over the ground (bearings are measured at each frame's origin: meridians converge ~0.03° in 26 km).
 expect(Math.abs(g.frame.bearing(out.aircraft.heading)-trackBefore)).toBeLessThan(.1);
 // Pitch changes only by the angle between the two frames' "up" (~26 km / Earth radius).
 expect(Math.abs(out.aircraft.pitch-.04)).toBeLessThan(.01);
 expect(g.frame.toGeo({x:p.x,y:g.ground(p.x,p.z),z:p.z}).altMsl).toBeCloseTo(groundBefore,0);
 // Not far enough out: nothing happens. A new flight goes back to the frame on the home runway.
 expect(g.maybeRebase(out)).toBeUndefined();
 g.resetFrame();expect(g.frameEpoch).toBe(2);expect(g.ground(0,0)).toBe(0);expect(g.landable(0,0)).toBe(false);
 g.dispose();
});

test("the home airfield stays landable after re-anchoring, and catalogue runways are landable anywhere",async()=>{
 const g=new GeoWorld({airports:catalog,airport:"VOMM",runway:"07",destination:"VOBL",terrain:demSource(inland)});await g.prepare();
 // Any open catalogue runway counts, even with no buildings/aeroway data: the middle of VOBL's first runway.
 const r=catalog.require("VOBL").runways[0]!,mid={lat:(r.le.position!.lat+r.he.position!.lat)/2,lon:(r.le.position!.lon+r.he.position!.lon)/2};
 expect(g.catalogRunwayAt(mid.lat,mid.lon)?.airport).toBe("VOBL");expect(g.catalogRunwayAt(mid.lat+.02,mid.lon)).toBeUndefined();
 const s={aircraft:{position:{x:0,y:300,z:26_000},velocity:{x:0,y:0,z:80},heading:0,pitch:0,roll:0,throttle:1,grounded:false,crashed:false},entities:[]};
 const out=g.maybeRebase(s)!,st=g.status({position:out.aircraft.position,velocity:out.aircraft.velocity,heading:0});
 const hx=-st.home.position[0],hz=st.home.position[2];expect(Math.hypot(hx,hz)).toBeCloseTo(26_000,-2);
 // The runway the flight left from is still where it was, flat and landable, in the new frame.
 expect(g.landable(hx,hz)).toBe(true);expect(g.ground(hx,hz)).toBeCloseTo(st.home.position[1],2);
 g.dispose();
});
