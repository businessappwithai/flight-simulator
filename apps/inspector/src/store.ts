import type {DecisionTrace} from "@flight/cognition";
import type {BenchmarkRow} from "./benchmark.ts";
export interface InspectorState{tick:string;decision?:DecisionTrace;benchmarks:readonly BenchmarkRow[];violations:readonly string[]}
export class InspectorStore{
 #state:InspectorState={tick:"0",benchmarks:[],violations:[]};#listeners=new Set<(s:InspectorState)=>void>();
 get state(){return this.#state}
 update(p:Partial<InspectorState>){this.#state={...this.#state,...p};for(const l of this.#listeners)l(this.#state)}
 subscribe(l:(s:InspectorState)=>void){this.#listeners.add(l);l(this.#state);return()=>this.#listeners.delete(l)}
}
