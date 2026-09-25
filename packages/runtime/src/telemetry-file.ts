import type {RuntimeEvent} from "./telemetry.ts";
export function encodeTelemetry(e:RuntimeEvent):string{return JSON.stringify(e,(_,v)=>typeof v==="bigint"?`${v}n`:v)}
export function decodeTelemetry(line:string):RuntimeEvent{return JSON.parse(line,(_,v)=>typeof v==="string"&&/^\d+n$/.test(v)?BigInt(v.slice(0,-1)):v) as RuntimeEvent}
export async function readTelemetry(path:string):Promise<readonly RuntimeEvent[]>{
 const text=await Bun.file(path).text();return text.split(/\r?\n/).filter(Boolean).map(decodeTelemetry);
}
