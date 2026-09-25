export interface RunIdentityInput{pilotId:string;scenarioId:string;seed:string;configHash:string}
export async function runId(x:RunIdentityInput):Promise<string>{
 const s=[x.pilotId,x.scenarioId,x.seed,x.configHash].join("\0");
 const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
 return [...new Uint8Array(d)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
