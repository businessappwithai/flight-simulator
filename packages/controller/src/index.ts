import type { AircraftControls, Observation, PilotIntent } from "@flight/protocol";
const clamp=(x:number,a=-1,b=1)=>Math.max(a,Math.min(b,x));
export class IntentController {
 controls(intent:PilotIntent,o:Observation):AircraftControls{
  const base={aileron:0,elevator:0,rudder:0,throttle:.72};
  if(intent==="TURN_LEFT")return {...base,aileron:-.55,rudder:-.08};
  if(intent==="TURN_RIGHT")return {...base,aileron:.55,rudder:.08};
  if(intent==="CLIMB")return {...base,elevator:.5,throttle:.82};
  if(intent==="DESCEND")return {...base,elevator:-.35};
  if(intent==="SLOW")return {...base,throttle:.35};
  if(intent==="ABORT")return {...base,elevator:.25,throttle:.65};
  return {...base,elevator:clamp((70-o.altitude)*.015)};
 }
}
