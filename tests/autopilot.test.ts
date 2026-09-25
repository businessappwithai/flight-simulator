import {expect,test} from "bun:test";
import {DeterministicSimulation,defaultScenario,scenarioForSeed} from "@flight/simulation";
import {autopilotControls,autopilotTarget} from "@flight/controller";
function fly(seed:bigint,scenario=scenarioForSeed(seed)){const sim=new DeterministicSimulation();let w=sim.reset(scenario);const modes=new Set<string>();let maxSink=0;
 for(let i=0;i<120*180;i++){w=sim.step(autopilotControls(w));modes.add(autopilotTarget(w).mode);if(w.objective.phase!=="OUTBOUND"&&w.aircraft.position.y<3)maxSink=Math.max(maxSink,-w.aircraft.velocity.y);if(w.objective.phase==="COMPLETE"||w.objective.phase==="FAILED")break}
 return {phase:w.objective.phase,modes,maxSink,touchdown:w.aircraft.position};}
test("seeded scenarios are deterministic and actually vary",()=>{expect(scenarioForSeed(7n)).toEqual(scenarioForSeed(7n));const cps=new Set(Array.from({length:20},(_,i)=>JSON.stringify(scenarioForSeed(BigInt(i+1)).checkpoint)));expect(cps.size).toBe(20)});
test("defaultScenario geometry is unchanged (golden checksums rely on it)",()=>expect(defaultScenario(9n).checkpoint).toEqual({x:0,y:80,z:600}));
test("autopilot flies the full mission on the default scenario",()=>{const r=fly(1n,defaultScenario(1n));expect(r.phase).toBe("COMPLETE");for(const m of ["TAKEOFF","OUTBOUND","FINAL","FLARE"])expect(r.modes.has(m as any)).toBe(true);expect(r.maxSink).toBeLessThan(4);expect(Math.hypot(r.touchdown.x,r.touchdown.z)).toBeLessThan(30)});
test("autopilot completes 40 seeded scenarios without a crash",()=>{const bad:string[]=[];for(let s=1n;s<=40n;s++){const r=fly(s);if(r.phase!=="COMPLETE")bad.push(`${s}:${r.phase}`)}expect(bad).toEqual([])},60_000);
test("autopilot avoids the obstacle on a scenario where the straight climb collides (seed 33)",()=>expect(fly(33n).phase).toBe("COMPLETE"));
