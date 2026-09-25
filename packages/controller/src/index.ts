import type { AircraftControls, Observation, PilotIntent } from "@flight/protocol";
const clamp=(x:number,a=-1,b=1)=>Math.max(a,Math.min(b,x));
/**
 * Deterministic intent → control-surface mapping (the AI and the pilot never touch surfaces directly).
 *
 * With attitude in the observation the intents are stabilised, like a fly-by-wire light aircraft:
 * turns fly a fixed bank and hold height, releasing a turn rolls the wings level, HOLD keeps the height the
 * aircraft had when HOLD began (never below HOLD_FLOOR_M), CLIMB/DESCEND fly a target vertical speed.
 * Without attitude (older producers) it falls back to the original open-loop mapping.
 */
export const HOLD_FLOOR_M=30;
const TURN_BANK=.5,CLIMB_VS=6,DESCEND_VS=-4,ABORT_VS=8,MAX_PITCH=.35;
export class IntentController {
 #last?:PilotIntent;#holdAltitude=70;
 controls(intent:PilotIntent,o:Observation):AircraftControls{
  if(!o.attitude)return legacy(intent,o);
  // Height to keep for level intents: captured when entering a level intent from a non-level one.
  const level=intent==="HOLD"||intent==="TURN_LEFT"||intent==="TURN_RIGHT"||intent==="SLOW"||intent==="REROUTE";
  const wasLevel=this.#last==="HOLD"||this.#last==="TURN_LEFT"||this.#last==="TURN_RIGHT"||this.#last==="SLOW"||this.#last==="REROUTE";
  if(level&&(!wasLevel||this.#last===undefined))this.#holdAltitude=Math.max(HOLD_FLOOR_M,o.altitude);
  this.#last=intent;
  const {pitch,roll}=o.attitude;
  const bank=intent==="TURN_LEFT"?-TURN_BANK:intent==="TURN_RIGHT"||intent==="REROUTE"?TURN_BANK:0;
  const aileron=clamp(3*(bank-roll));
  const vs=intent==="CLIMB"?CLIMB_VS:intent==="DESCEND"?DESCEND_VS:intent==="ABORT"?ABORT_VS:clamp(.35*(this.#holdAltitude-o.altitude),-4,4);
  const pitchTarget=clamp(Math.asin(clamp(vs/Math.max(o.speed,12),-.9,.9)),-MAX_PITCH,MAX_PITCH);
  const elevator=o.speed<12&&o.altitude<3?0:clamp(4*(pitchTarget-pitch));
  const throttle=intent==="CLIMB"?.82:intent==="SLOW"?.35:intent==="ABORT"?.9:.72;
  return {aileron,elevator,rudder:aileron*.15,throttle};
 }
}
function legacy(intent:PilotIntent,o:Observation):AircraftControls{
 const base={aileron:0,elevator:0,rudder:0,throttle:.72};
 if(intent==="TURN_LEFT")return {...base,aileron:-.55,rudder:-.08};
 if(intent==="TURN_RIGHT")return {...base,aileron:.55,rudder:.08};
 if(intent==="CLIMB")return {...base,elevator:.5,throttle:.82};
 if(intent==="DESCEND")return {...base,elevator:-.35};
 if(intent==="SLOW")return {...base,throttle:.35};
 if(intent==="ABORT")return {...base,elevator:.25,throttle:.65};
 return {...base,elevator:clamp((70-o.altitude)*.015)};
}

export { autopilotControls, autopilotTarget, DEFAULT_AUTOPILOT } from "./autopilot.ts";
export type { AutopilotTarget, AutopilotTuning } from "./autopilot.ts";
