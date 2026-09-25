import type {RuntimeEvent} from "@flight/protocol";
export class TelemetryBuffer{
 #events:RuntimeEvent[]=[];
 constructor(readonly capacity=5000){if(capacity<1)throw new Error("capacity must be positive")}
 push(e:RuntimeEvent){this.#events.push(e);if(this.#events.length>this.capacity)this.#events.splice(0,this.#events.length-this.capacity)}
 snapshot(){return [...this.#events]}
 clear(){this.#events.length=0}
 toJsonl(){return this.#events.map(e=>JSON.stringify(e,(_,v)=>typeof v==="bigint"?`${v}n`:v)).join("\n")}
 get size(){return this.#events.length}
}
