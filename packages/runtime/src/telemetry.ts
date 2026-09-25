import type { RuntimeEvent, WorldSnapshot } from "@flight/protocol";
export type { RuntimeEvent };
export type RuntimeListener=(event:RuntimeEvent)=>void;
export class RuntimeEventBus{
 #listeners=new Set<RuntimeListener>();
 subscribe(l:RuntimeListener){this.#listeners.add(l);return()=>this.#listeners.delete(l)}
 publish(e:RuntimeEvent){for(const l of this.#listeners)l(e)}
}
export interface PendingOutcome{decisionId:string;before:WorldSnapshot;startTick:bigint;}
