import type { Observation, PilotIntent } from "@flight/protocol";
export interface SafetyDecision{requested:PilotIntent;executed:PilotIntent;overridden:boolean;reason?:string}
export class SafetySupervisor {
 evaluate(requested:PilotIntent,o:Observation):SafetyDecision{
  if(o.altitude<15&&requested==="DESCEND")return {requested,executed:"CLIMB",overridden:true,reason:"TERRAIN_CLEARANCE"};
  if((o.nearestObstacle?.distance??Infinity)<25&&requested==="HOLD")return {requested,executed:"CLIMB",overridden:true,reason:"COLLISION_RECOVERY"};
  return {requested,executed:requested,overridden:false};
 }
}
