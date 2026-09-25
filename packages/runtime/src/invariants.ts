import type {WorldSnapshot} from "@flight/protocol";
export interface InvariantViolation{code:string;tick:string;detail:string}
export function checkWorldInvariants(w:WorldSnapshot):readonly InvariantViolation[]{
 const out:InvariantViolation[]=[],tick=String(w.tick),a=w.aircraft;
 const finite=(n:number)=>Number.isFinite(n);
 if(![a.position.x,a.position.y,a.position.z,a.velocity.x,a.velocity.y,a.velocity.z].every(finite))out.push({code:"NON_FINITE_AIRCRAFT",tick,detail:"aircraft position/velocity contains non-finite value"});
 if(a.position.y < -1)out.push({code:"BELOW_WORLD",tick,detail:`altitude=${a.position.y}`});
 for(const e of w.entities)if(![e.position.x,e.position.y,e.position.z,e.radius].every(finite))out.push({code:"NON_FINITE_ENTITY",tick,detail:e.id});
 return out;
}
