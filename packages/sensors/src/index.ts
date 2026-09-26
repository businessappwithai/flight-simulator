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
  return {tick:w.tick,speed,altitude:a.position.y,heading:a.heading,objectivePhase:w.objective.phase,nearestObstacle,attitude:{pitch:a.pitch,roll:a.roll,verticalSpeed:a.velocity.y},objective};
 }
}
