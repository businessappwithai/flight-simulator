import type { Observation } from "@flight/protocol";
export function situationFingerprint(o:Observation):string{
 const alt=o.altitude<20?"ALT_VLOW":o.altitude<80?"ALT_LOW":o.altitude<200?"ALT_MED":"ALT_HIGH";
 const spd=o.speed<12?"SPD_LOW":o.speed<35?"SPD_NORMAL":o.speed<65?"SPD_HIGH":"SPD_VHIGH";
 const d=o.nearestObstacle?.distance;
 const threat=d===undefined?"THREAT_NONE":d<35?"THREAT_IMMEDIATE":d<100?"THREAT_NEAR":d<250?"THREAT_MED":"THREAT_FAR";
 const b=o.nearestObstacle?.bearing;
 const side=b===undefined?"SIDE_NONE":b<-.2?"SIDE_LEFT":b>.2?"SIDE_RIGHT":"SIDE_FRONT";
 return [alt,spd,threat,side,`OBJ_${o.objectivePhase}`].join("+");
}
