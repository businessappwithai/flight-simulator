import type { AircraftControls, WorldSnapshot } from "@flight/protocol";
/**
 * Stateless reference autopilot for the deterministic flight model: take off, fly to the checkpoint,
 * turn back, intercept the runway centreline, fly a stabilised glide path and touch down within the
 * runway completion radius. Also avoids the moving obstacle vertically. Pure function of the snapshot.
 */
export interface AutopilotTuning{cruiseSpeed:number;approachSpeed:number;glideSlopeDeg:number;touchdownOffset:number}
export const DEFAULT_AUTOPILOT:AutopilotTuning={cruiseSpeed:42,approachSpeed:26,glideSlopeDeg:4,touchdownOffset:6};
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const wrap=(a:number)=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a};
export interface AutopilotTarget{mode:"TAKEOFF"|"OUTBOUND"|"TURN_BACK"|"FINAL"|"FLARE"|"ROLLOUT";heading:number;altitude:number;speed:number;maxBank:number}
export function autopilotTarget(w:WorldSnapshot,t:AutopilotTuning=DEFAULT_AUTOPILOT):AutopilotTarget{
 const a=w.aircraft,p=a.position,speed=Math.hypot(a.velocity.x,a.velocity.y,a.velocity.z);
 const runway=w.entities.find(e=>e.kind==="RUNWAY")?.position??{x:0,y:0,z:0};
 const checkpoint=w.entities.find(e=>e.kind==="CHECKPOINT")?.position??{x:0,y:80,z:600};
 if(w.objective.phase!=="RETURN"){
  const dx=checkpoint.x-p.x,dz=checkpoint.z-p.z,bearing=Math.atan2(dx,dz);
  // Inside the turning circle and well off the nose, homing would orbit forever: extend straight, then turn back.
  const turnRadius=Math.max(speed,20)/(.75*.6) /* heading rate = 0.75·roll in the flight model */,extend=Math.hypot(dx,dz)<2.4*turnRadius&&Math.abs(wrap(bearing-a.heading))>1.1;
  return {mode:p.y<8&&speed<30?"TAKEOFF":"OUTBOUND",heading:extend?a.heading:bearing,altitude:checkpoint.y,speed:t.cruiseSpeed,maxBank:p.y<10?.05:.6};
 }
 // Runway is approached flying towards -z (heading π); touchdown aim point sits just past the threshold.
 const touchZ=runway.z+t.touchdownOffset,along=p.z-touchZ,cross=p.x-runway.x;
 const aligned=Math.abs(wrap(a.heading-Math.PI))<.45&&Math.abs(cross)<60&&along>-80;
 // Pattern: inbound with room → intercept the centreline via a carrot 250 m ahead; inbound too close → go around;
 // outbound → fly a parallel downwind leg until far enough out, then the carrot turns the aircraft back in.
 const inbound=Math.abs(wrap(a.heading-Math.PI))<Math.PI/2,side=cross>=0?1:-1;
 const aim=inbound?(along>=300||aligned?{x:runway.x,z:Math.max(touchZ-60,p.z-250)}:{x:runway.x+side*250,z:touchZ+1100})
  :(along<800?{x:runway.x+side*250,z:touchZ+1100}:{x:runway.x,z:p.z-250});
 const heading=aligned?Math.PI+clamp(cross*.012,-.3,.3):Math.atan2(aim.x-p.x,aim.z-p.z);
 const glide=Math.max(0,along)*Math.tan(t.glideSlopeDeg*Math.PI/180);
 if(!aligned)return {mode:"TURN_BACK",heading,altitude:Math.max(45,Math.min(checkpoint.y,glide)),speed:t.cruiseSpeed,maxBank:.6};
 if(p.y<1.5)return {mode:p.y<.3?"ROLLOUT":"FLARE",heading,altitude:0,speed:t.approachSpeed-4,maxBank:.05};
 return {mode:"FINAL",heading,altitude:glide,speed:along<500?t.approachSpeed:t.cruiseSpeed*.8,maxBank:p.y<15?.12:.35};
}
export function autopilotControls(w:WorldSnapshot,t:AutopilotTuning=DEFAULT_AUTOPILOT):AircraftControls{
 const a=w.aircraft,p=a.position,speed=Math.hypot(a.velocity.x,a.velocity.y,a.velocity.z),target=autopilotTarget(w,t);
 let altitude=target.altitude,heading=target.heading;
 // Obstacle avoidance on the predicted closest approach over the next 6 s: climb over it and steer away from it.
 const o=w.entities.find(e=>e.kind==="OBSTACLE");
 if(o&&target.mode!=="FLARE"&&target.mode!=="ROLLOUT"){
  const rx=o.position.x-p.x,ry=o.position.y-p.y,rz=o.position.z-p.z,vx=o.velocity.x-a.velocity.x,vy=o.velocity.y-a.velocity.y,vz=o.velocity.z-a.velocity.z;
  const tca=clamp(-(rx*vx+ry*vy+rz*vz)/Math.max(1e-6,vx*vx+vy*vy+vz*vz),0,6);
  const cx=rx+vx*tca,cz=rz+vz*tca,miss=Math.hypot(cx,ry+vy*tca,cz),guard=o.radius+35;
  if(miss<guard*1.6&&Math.hypot(rx,rz)<400){
   altitude=Math.max(altitude,o.position.y+o.radius+25);
   // cross product sign says which side the obstacle will pass; turn the other way, harder when closer.
   const side=Math.sign(Math.sin(a.heading)*cz-Math.cos(a.heading)*cx)||1;
   heading=a.heading+side*clamp(.9*(1-miss/(guard*1.6))+.2,0,.8);
  }
 }
 const rollTarget=clamp(1.3*wrap(heading-a.heading),-Math.max(target.maxBank,heading!==target.heading&&p.y>10?.6:0),Math.max(target.maxBank,heading!==target.heading&&p.y>10?.6:0));
 const aileron=clamp(3*(rollTarget-a.roll),-1,1);
 let vyTarget=clamp(.45*(altitude-p.y),-5,6);
 // On final add the glide path's own sink rate as feed-forward so the aircraft tracks it without a standing offset.
 if(target.mode==="FINAL"&&altitude===target.altitude)vyTarget=clamp(-Math.hypot(a.velocity.x,a.velocity.z)*Math.tan(t.glideSlopeDeg*Math.PI/180)+.45*(altitude-p.y),-4,3);
 if(target.mode==="FLARE")vyTarget=-1.2;
 const canPitchUp=speed>18||p.y>6;
 const pitchTarget=target.mode==="ROLLOUT"?0:clamp(Math.asin(clamp(vyTarget/Math.max(speed,1),-.4,.4)),canPitchUp?-.3:-.3,canPitchUp?.3:0);
 const elevator=clamp(4*(pitchTarget-a.pitch),-1,1);
 const throttle=target.mode==="ROLLOUT"?0:clamp(target.speed*.1/34+.08*(target.speed-speed)+(vyTarget>1?.1:0),0,1);
 return {aileron,elevator,rudder:aileron*.15,throttle};
}
