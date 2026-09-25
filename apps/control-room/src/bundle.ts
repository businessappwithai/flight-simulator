import type {DecisionTrace} from "@flight/protocol";
import type {BenchmarkRow} from "./benchmark.ts";
export interface InspectorBundle{version:1;episodeId:string;decisions:readonly DecisionTrace[];benchmarks:readonly BenchmarkRow[];telemetry:readonly unknown[]}
export function encodeInspectorBundle(x:InspectorBundle){return JSON.stringify(x,(_,v)=>typeof v==="bigint"?`${v}n`:v)}
export function decodeInspectorBundle(s:string):InspectorBundle{return JSON.parse(s,(_,v)=>typeof v==="string"&&/^\d+n$/.test(v)?BigInt(v.slice(0,-1)):v) as InspectorBundle}
