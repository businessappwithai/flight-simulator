export interface AblationConfig {
 temporalMemory:boolean;experience:boolean;worldModel:boolean;skills:boolean;
 provider:"jev"|"open-jev";
}
export function standardAblations(full:AblationConfig):readonly AblationConfig[]{
 return [
  full,
  {...full,temporalMemory:false},
  {...full,experience:false},
  {...full,worldModel:false},
  {...full,skills:false},
  {...full,provider:full.provider==="jev"?"open-jev":"jev"}
 ];
}
