import {expect,test} from "bun:test";
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
import {IntentController,autopilotControls,HOLD_FLOOR_M} from "@flight/controller";
import {PerfectSensorSuite} from "@flight/sensors";
import type {PilotIntent} from "@flight/protocol";
// Fly the autopilot to cruise, then hand over to a scripted manual sequence.
function flight(script:[PilotIntent,number][]){
 const sim=new DeterministicSimulation(),c=new IntentController(),s=new PerfectSensorSuite();let w=sim.reset(defaultScenario(1n));
 for(let i=0;i<120*8;i++)w=sim.step(autopilotControls(w));
 const log:{intent:PilotIntent;y:number;roll:number;vy:number;heading:number;crashed:boolean}[]=[];
 for(const [intent,seconds] of script)for(let i=0;i<seconds*120;i++){w=sim.step(c.controls(intent,s.observe(w)));log.push({intent,y:w.aircraft.position.y,roll:w.aircraft.roll,vy:w.aircraft.velocity.y,heading:w.aircraft.heading,crashed:w.aircraft.crashed})}
 return log;
}
test("releasing a turn rolls the wings level and stops the turn",()=>{
 const l=flight([["TURN_LEFT",4],["HOLD",6]]),end=l.at(-1)!,before=l[l.length-121]!;
 expect(Math.abs(end.roll)).toBeLessThan(.03);expect(Math.abs(end.heading-before.heading)).toBeLessThan(.02);expect(end.crashed).toBe(false);
});
test("HOLD keeps the height it started at instead of diving to a fixed altitude",()=>{
 const l=flight([["CLIMB",12],["HOLD",15]]),start=l.find(x=>x.intent==="HOLD")!,hold=l.filter(x=>x.intent==="HOLD");
 expect(start.y).toBeGreaterThan(120);expect(Math.abs(hold.at(-1)!.y-start.y)).toBeLessThan(6);expect(Math.min(...hold.map(x=>x.vy))).toBeGreaterThan(-6);
});
test("turns hold height; CLIMB/DESCEND fly a bounded vertical speed",()=>{
 const l=flight([["TURN_RIGHT",6],["CLIMB",5],["DESCEND",5]]),t=l.filter(x=>x.intent==="TURN_RIGHT");
 expect(Math.abs(t.at(-1)!.y-t[0]!.y)).toBeLessThan(8);expect(t.at(-1)!.heading).toBeGreaterThan(t[0]!.heading+.5);
 expect(Math.max(...l.filter(x=>x.intent==="CLIMB").map(x=>x.vy))).toBeLessThan(9);expect(Math.min(...l.filter(x=>x.intent==="DESCEND").map(x=>x.vy))).toBeGreaterThan(-7);
});
test("any manual sequence of intents stays airborne (no spiral dive after release)",()=>{
 const intents:PilotIntent[]=["CLIMB","TURN_LEFT","HOLD","TURN_RIGHT","SLOW","DESCEND","HOLD","TURN_LEFT","DESCEND","HOLD"];
 const l=flight(intents.map(i=>[i,4] as [PilotIntent,number]));expect(l.some(x=>x.crashed)).toBe(false);expect(Math.min(...l.map(x=>x.y))).toBeGreaterThan(HOLD_FLOOR_M-10);
});
