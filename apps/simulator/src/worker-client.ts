import type {PilotIntent,SimCommand,SimEvent,SimPilot} from "@flight/protocol";
export type WorldEvent=Extract<SimEvent,{type:"WORLD"}>;
/**
 * Paced client: at most one STEP is in flight, so a slow frame never queues a backlog of simulation work.
 * Errors and worker crashes are surfaced through onError instead of disappearing.
 */
export class SimulationWorkerClient{
 readonly worker:Worker;latest?:WorldEvent;checksum?:string;ready=false;
 #seq=0;#inFlight=false;#listeners=new Set<(e:SimEvent)=>void>();
 onError:(message:string)=>void=()=>{};
 // Served next to the page by serve.ts / build.ts (bundlers do not rewrite worker URLs reliably).
 constructor(url=new URL("./sim.worker.js",document.baseURI)){
  this.worker=new Worker(url,{type:"module"});
  this.worker.onmessage=(m:MessageEvent<SimEvent>)=>{const e=m.data;
   if(e.type==="READY")this.ready=true;
   if(e.type==="WORLD"){this.latest=e;if(e.seq===this.#seq)this.#inFlight=false}
   if(e.type==="CHECKSUM")this.checksum=e.checksum;
   if(e.type==="ERROR"){this.#inFlight=false;this.onError(e.message)}
   for(const l of this.#listeners)l(e)};
  this.worker.onerror=(e:ErrorEvent)=>{this.#inFlight=false;this.onError(`simulation worker crashed: ${e.message}`)};
 }
 send(c:SimCommand){this.worker.postMessage(c)}
 onEvent(l:(e:SimEvent)=>void){this.#listeners.add(l);return()=>this.#listeners.delete(l)}
 reset(seed:bigint,scenario:"default"|"seeded"="default"){this.#inFlight=false;this.send({type:"RESET",seed:String(seed),scenario})}
 intent(intent:PilotIntent){this.send({type:"SET_INTENT",intent})}
 pilot(pilot:SimPilot){this.send({type:"SET_PILOT",pilot})}
 pause(paused:boolean){this.send({type:paused?"PAUSE":"RESUME"})}
 /** Requests `ticks` more simulation ticks; returns false while the previous request is still running. */
 step(ticks:number):boolean{if(this.#inFlight)return false;this.#inFlight=true;this.send({type:"STEP",ticks,seq:++this.#seq});return true}
 dispose(){this.worker.terminate();this.#listeners.clear()}
}
