import type { Observation, WorldSnapshot } from "@flight/protocol";
const wrap=(a:number)=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a};
export class PerfectSensorSuite {
 observe(w:WorldSnapshot):Observation{
  const a=w.aircraft, obstacle=w.entities.find(e=>e.kind==="OBSTACLE");
  const speed=Math.hypot(a.velocity.x,a.velocity.y,a.velocity.z);
  let nearestObstacle:Observation["nearestObstacle"];
  if(obstacle){
   const dx=obstacle.position.x-a.position.x,dz=obstacle.position.z-a.position.z;
   nearestObstacle={distance:Math.hypot(dx,obstacle.position.y-a.position.y,dz),bearing:wrap(Math.atan2(dx,dz)-a.heading)};
  }
  const target=w.entities.find(e=>e.kind===(w.objective.phase==="OUTBOUND"?"CHECKPOINT":"RUNWAY"));
  const objective=target?{distance:Math.hypot(target.position.x-a.position.x,target.position.z-a.position.z),bearing:wrap(Math.atan2(target.position.x-a.position.x,target.position.z-a.position.z)-a.heading),heightAbove:a.position.y-target.position.y}:undefined;
  return {tick:w.tick,speed,altitude:a.position.y,heading:a.heading,objectivePhase:w.objective.phase,nearestObstacle,grounded:a.grounded,attitude:{pitch:a.pitch,roll:a.roll,verticalSpeed:a.velocity.y},objective};
 }
}
/**
 * The home circuit as a flight plan, for pilots that decide from the observation (Jev and learning) once the gate is
 * passed (RETURN): out to a fix 2 km beyond runway 18's threshold at the gate's height, then back along the centreline
 * (flying towards −z) on a 3° path that meets the ground 15 m short of the runway point (landing counts within 30 m). Same meaning as a cross-country plan: `distance` to the
 * threshold, `bearing` towards the plan (the fix, else the centreline 400 m ahead) relative to the heading,
 * `heightAbove` the planned height. Undefined outside RETURN. Describes the plan; chooses no manoeuvre.
 */
export const CIRCUIT={fixM:2000,leadM:400,glideSlopeDeg:3,aimM:15} as const;
export function circuitObjective(w:WorldSnapshot):Observation["objective"]{
 if(w.objective.phase!=="RETURN")return undefined;
 const a=w.aircraft,p=a.position,rw=w.entities.find(e=>e.kind==="RUNWAY")?.position,gate=w.entities.find(e=>e.kind==="CHECKPOINT")?.position;
 if(!rw)return undefined;
 const height=gate?.y??80,along=p.z-rw.z,inbound=Math.cos(a.heading)<0;
 const aim=!inbound&&along<CIRCUIT.fixM?{x:rw.x,z:rw.z+CIRCUIT.fixM}:{x:rw.x,z:p.z-CIRCUIT.leadM};
 const planned=inbound?Math.min(height,Math.max(0,along-CIRCUIT.aimM)*Math.tan(CIRCUIT.glideSlopeDeg*Math.PI/180)):height;
 return {distance:Math.hypot(rw.x-p.x,rw.z-p.z),bearing:wrap(Math.atan2(aim.x-p.x,aim.z-p.z)-a.heading),heightAbove:p.y-planned};
}
