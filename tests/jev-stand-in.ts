// Test tooling: the stand-in Jev (tests/fixtures/jev-stand-in.mjs) and a headless copy of the worker's decision loop.
// The stand-in is a test double, not the simulator's autopilot: the simulator flies whatever Jev and learning decide.
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
import {IntentController} from "@flight/controller";
import {PerfectSensorSuite,circuitObjective} from "@flight/sensors";
import type {AirportIndex} from "@flight/geospatial";
import {decisionTicks} from "@flight/controller";
import {GeoWorld} from "@flight/geospatial";
import type {Observation,PilotIntent,WorldSnapshot} from "@flight/protocol";
import {demSource,inland} from "./geo-route.helpers.ts";

import {standInPolicy} from "./fixtures/jev-stand-in.mjs";
export {standInPolicy,serveStandInJev,type StandInJev} from "./fixtures/jev-stand-in.mjs";
/**
 * The worker's autopilot step without the worker: the observation (with the flight plan when `g` has a route), a
 * decision every `decisionTicks(intent)`, and the intent controller's controls for it. Stateful: one per flight.
 */
export function decisionPilot(g:GeoWorld|undefined,decide:(o:Observation)=>PilotIntent=standInPolicy){
 const controller=new IntentController(),sensors=new PerfectSensorSuite();let intent:PilotIntent="HOLD",decideAt=0n;
 const observe=(w:WorldSnapshot):Observation=>{const x=sensors.observe(w),plan=g?.routeObjective(w)??circuitObjective(w);return plan?{...x,objective:plan,objectivePhase:x.objectivePhase==="COMPLETE"||x.objectivePhase==="FAILED"?x.objectivePhase:"RETURN"}:x};
 const pilot=(w:WorldSnapshot)=>{const o=observe(w);if(w.tick>=decideAt){intent=decide(o);decideAt=w.tick+decisionTicks(intent);pilot.decided(w,o,intent)}return controller.controls(intent,o)};
 pilot.decided=(_w:WorldSnapshot,_o:Observation,_i:PilotIntent)=>{};
 return pilot;
}
/**
 * The worker's loop without the worker: hold for terrain, decide every `decisionTicks(intent)`, fly the decided intent with the
 * intent controller, re-anchor, complete on arrival. `decide` is synchronous here (the worker holds its clock instead).
 */
export async function flyDecisions(o:{airports:AirportIndex;from:string;runway?:string;to:string;toRunway?:string;dem?:(lat:number,lon:number)=>number;delayMs?:()=>number;decide?:(o:Observation)=>PilotIntent;maxTicks?:number;log?:(w:WorldSnapshot,o:Observation,i:PilotIntent,g:GeoWorld)=>void}){
 const g=new GeoWorld({airports:o.airports,airport:o.from,runway:o.runway,destination:o.to,destinationRunway:o.toRunway,terrain:demSource(o.dem??inland,o.delayMs)});
 await g.prepare();
 const sim=new DeterministicSimulation(),pilot=decisionPilot(g,o.decide);sim.setGround(g.ground,g.landable);
 const intents:{tick:bigint;intent:PilotIntent}[]=[];pilot.decided=(w,ob,i)=>{intents.push({tick:w.tick,intent:i});o.log?.(w,ob,i,g)};
 let w=sim.reset(defaultScenario(1n)),holds=0,rebases=0;
 try{
  for(let t=0;t<(o.maxTicks??1_500_000);t++){
   const wait=g.ensureAround(w.aircraft.position.x,w.aircraft.position.z);if(wait){holds++;await wait;t--;continue}
   w=sim.step(pilot(w));
   const moved=g.maybeRebase(w);if(moved){sim.restore(moved);w=moved;rebases++}
   if(w.objective.phase!=="COMPLETE"&&g.arrived(w)){w={...w,objective:{phase:"COMPLETE",checkpointReached:true}};sim.restore(w)}
   if(w.objective.phase==="COMPLETE"||w.objective.phase==="FAILED")break;
  }
  return {w,g,intents,holds,rebases,checksum:await sim.checksum(),status:g.status({position:w.aircraft.position,velocity:w.aircraft.velocity,heading:w.aircraft.heading},w)};
 }finally{g.dispose()}
}
