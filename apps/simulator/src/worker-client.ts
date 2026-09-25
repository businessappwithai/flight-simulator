import type {SimCommand,SimEvent,WorldSnapshot,PilotIntent} from "@flight/protocol";
export class SimulationWorkerClient{
 readonly worker:Worker;world?:WorldSnapshot;checksum?:string;
 #listeners=new Set<(e:SimEvent)=>void>();
 constructor(url=new URL("./sim.worker.ts",import.meta.url)){this.worker=new Worker(url,{type:"module"});this.worker.onmessage=(m:MessageEvent<SimEvent>)=>{if(m.data.type==="WORLD")this.world=m.data.world;if(m.data.type==="CHECKSUM")this.checksum=m.data.checksum;for(const l of this.#listeners)l(m.data)}}
 send(c:SimCommand){this.worker.postMessage(c)}
 onEvent(l:(e:SimEvent)=>void){this.#listeners.add(l);return()=>this.#listeners.delete(l)}
 reset(seed:bigint){this.send({type:"RESET",seed:String(seed)})}
 intent(intent:PilotIntent){this.send({type:"SET_INTENT",intent})}
 step(ticks=2){this.send({type:"STEP",ticks})}
}
