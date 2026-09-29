// The autopilot is Jev and learning: decisions (never a built-in flyer), the flight plan they decide from, and the
// intent semantics they rely on.
import {expect,test} from "bun:test";
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
import {IntentController,decisionTicks,DECIDE_EVERY_TICKS,TURN_DECIDE_TICKS} from "@flight/controller";
import {PerfectSensorSuite} from "@flight/sensors";
import {Copilot,ERROR_BACKOFF_TICKS,MISSION_QUESTION,copilotFeatures} from "@flight/copilot";
import {XGBoostBestPracticeClient} from "@flight/experience/xgboost-client";
import type {JevTransport} from "@flight/decision-jev";
import type {LearningBook,Observation,PilotIntent,WorldSnapshot} from "@flight/protocol";
import {emptyBook} from "@flight/learning";
import {GeoWorld,destinationPoint} from "@flight/geospatial";
import {catalogIndex,demSource,inland} from "./geo-route.helpers.ts";

const obs:Observation={tick:120n,speed:54,altitude:300,heading:0,objectivePhase:"RETURN",objective:{distance:9000,bearing:.2,heightAbove:40},attitude:{pitch:0,roll:0,verticalSpeed:0}};
const jev=(p:Partial<Record<PilotIntent,number>>|Error,calls:{n:number;question?:string}={n:0}):(()=>JevTransport)=>()=>({invoke:async r=>{calls.n++;calls.question=r.question;if(p instanceof Error)throw p;
 return {requestId:r.id,engine:{provider:"jev",model:"jev-test",version:"x"},latencyMs:1,candidates:r.candidates.map(value=>({value,probability:(p as any)[value]??0}))}}});
/** A book whose examples say: in this situation TURN_RIGHT lands and the rest crash. */
function book():LearningBook{const f=copilotFeatures(obs),b=emptyBook();b.examples=[];
 for(let i=0;i<40;i++)for(const [a,ok] of [["TURN_RIGHT",1],["DESCEND",0],["TURN_LEFT",0]] as const)b.examples.push({f:f.map((v,k)=>k===1?v+(i%9)-4:v),a,ok});return b}
const settle=async(c:Copilot)=>{for(let i=0;i<600&&!c.status.xgboost.trained&&!c.status.xgboost.detail?.startsWith("training failed");i++)await Bun.sleep(25)};

test("decide: Jev chooses, asked with the mission and what the observation means",async()=>{
 const calls={n:0} as {n:number;question?:string},c=new Copilot({xgboost:()=>{throw new Error("unused")},transport:jev({TURN_RIGHT:.8,HOLD:.2},calls)});
 await expect(c.decide(0n,obs)).rejects.toThrow("no Jev key");
 c.setKey("k");const d=await c.decide(0n,obs);
 expect(d.advice).toMatchObject({intent:"TURN_RIGHT",source:"JEV",provider:"jev",confidence:.8});expect(d.frame).toMatchObject({requestedIntent:"TURN_RIGHT",provider:"jev"});
 expect(calls.question!.startsWith(MISSION_QUESTION)).toBe(true);expect(MISSION_QUESTION).toMatch(/heightAbove/);
});
test("decide: with Jev down, the learned model decides; with nothing learned there is no decision at all, and Jev is left alone for a while",async()=>{
 const x=new XGBoostBestPracticeClient(),calls={n:0},c=new Copilot({xgboost:()=>x,transport:jev(Object.assign(new Error("Connection error."),{name:"APIConnectionError"}),calls)});
 try{
  c.setKey("k");
  await expect(c.decide(0n,obs)).rejects.toThrow(/Jev could not be reached \(Connection error\.\) and nothing has been learned yet/);expect(calls.n).toBe(1);
  await expect(c.decide(60n,obs)).rejects.toThrow(/nothing has been learned yet/);expect(calls.n).toBe(1); // backing off: Jev not asked
  c.learnFrom(book());await settle(c);
  const d=await c.decide(120n,obs);expect(calls.n).toBe(1);
  expect(d.advice).toMatchObject({intent:"TURN_RIGHT",source:"BEST_PRACTICE",provider:"xgboost:bp-1"});expect(d.advice.reason).toMatch(/Jev could not be reached/);
  await c.decide(ERROR_BACKOFF_TICKS,obs);expect(calls.n).toBe(2); // asked again after the back-off
 }finally{c.dispose()}
},60_000);
test("intents the autopilot relies on: SLOW on the ground idles to a stop, and turns are re-decided sooner",()=>{
 expect([decisionTicks("TURN_LEFT"),decisionTicks("TURN_RIGHT"),decisionTicks("REROUTE")]).toEqual([TURN_DECIDE_TICKS,TURN_DECIDE_TICKS,TURN_DECIDE_TICKS]);
 for(const i of ["HOLD","CLIMB","DESCEND","SLOW","ABORT"] as const)expect(decisionTicks(i)).toBe(DECIDE_EVERY_TICKS);
 const c=new IntentController(),ground={...obs,altitude:0,speed:30,grounded:true};
 expect(c.controls("SLOW",ground).throttle).toBe(0);expect(c.controls("SLOW",{...ground,grounded:false}).throttle).toBeGreaterThan(0);
 // Rolling on SLOW, the aircraft stops (the destination counts as reached only below 8 m/s).
 // Rolling on the runway at 30 m/s: on SLOW the aircraft stays down and stops (the destination counts as reached below 8 m/s).
 const sim=new DeterministicSimulation(),s=new PerfectSensorSuite(),k=new IntentController(),w0=sim.reset(defaultScenario(1n));
 let w:WorldSnapshot={...w0,aircraft:{...w0.aircraft,position:{...w0.aircraft.position,y:0},velocity:{x:0,y:0,z:30},grounded:true}};sim.restore(w);
 for(let i=0;i<120*60;i++)w=sim.step(k.controls("SLOW",s.observe(w)));
 expect(w.aircraft.crashed).toBe(false);expect(w.aircraft.position.y).toBeLessThan(.5);expect(Math.hypot(w.aircraft.velocity.x,w.aircraft.velocity.z)).toBeLessThan(8);
});
test("the flight plan in the observation: towards the plan, and relative to its height; down the runway past the threshold",async()=>{
 const catalog=catalogIndex(),g=new GeoWorld({airports:catalog,airport:"VOMM",runway:"07",destination:"VOAR",terrain:demSource(inland)});
 try{
  await g.prepare();const rw=g.destinationRunway!,sim=new DeterministicSimulation();sim.setGround(g.ground,g.landable);
  const at=(p:{lat:number;lon:number},altMsl:number,headingDeg:number):WorldSnapshot=>{const w=sim.reset(defaultScenario(1n)),v=g.frame.fromGeo({...p,altMsl});
   return {...w,aircraft:{...w.aircraft,position:v,heading:(headingDeg-g.frame.headingDeg)*Math.PI/180}}};
  // Parked at VOMM: ~50 km to go, far below the plan (which climbs to cruise), the plan's direction off to the west.
  const start=g.routeObjective(sim.reset(defaultScenario(1n)))!;
  expect(start.distance).toBeGreaterThan(45_000);expect(start.heightAbove).toBeLessThan(-1000);expect(Math.abs(start.bearing)).toBeGreaterThan(1.5);
  // 6 km out on the extended centreline, on the 3° path, flying the runway heading: straight ahead, on the plan.
  const e=rw.anchor.altMsl,six=destinationPoint(rw.anchor,rw.headingDegT+180,6000);
  const onPath=g.routeObjective(at(six,e+6000*Math.tan(3*Math.PI/180),rw.headingDegT))!;
  expect(onPath.distance).toBeCloseTo(6000,-2);expect(Math.abs(onPath.bearing)).toBeLessThan(.01);expect(Math.abs(onPath.heightAbove)).toBeLessThan(3);
  // 100 m right of the centreline there: the direction leads back onto it (left) within the 1.5 km lead.
  const right=g.routeObjective(at(destinationPoint(six,rw.headingDegT+90,100),e+314,rw.headingDegT))!;
  expect(right.bearing).toBeLessThan(-.05);expect(right.bearing).toBeGreaterThan(-.1);
  // Past the threshold the plan runs on down the runway, at the runway's height.
  const past=g.routeObjective(at(destinationPoint(rw.anchor,rw.headingDegT,500),e+10,rw.headingDegT))!;
  expect(Math.abs(past.bearing)).toBeLessThan(.01);expect(past.heightAbove).toBeCloseTo(10,0);
 }finally{g.dispose()}
});
