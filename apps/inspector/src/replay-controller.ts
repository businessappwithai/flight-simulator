import type {RuntimeEvent} from "@flight/runtime";
export type ReplayState="IDLE"|"PLAYING"|"PAUSED"|"DONE";
export class ReplayController{
 #events:RuntimeEvent[]=[];#i=0;#timer?:ReturnType<typeof setInterval>;state:ReplayState="IDLE";
 constructor(readonly emit:(e:RuntimeEvent)=>void,readonly onState:(s:ReplayState)=>void=()=>{}){}
 loadJsonl(s:string){this.stop();this.#events=s.split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x,(_,v)=>typeof v==="string"&&/^\d+n$/.test(v)?BigInt(v.slice(0,-1)):v));this.#i=0;this.state="PAUSED";this.onState(this.state)}
 play(intervalMs=100){if(this.state==="DONE")this.#i=0;this.pause();this.state="PLAYING";this.#timer=setInterval(()=>this.step(),intervalMs);this.onState(this.state)}
 pause(){if(this.#timer)clearInterval(this.#timer);this.#timer=undefined;if(this.state==="PLAYING"){this.state="PAUSED";this.onState(this.state)}}
 step(){if(this.#i>=this.#events.length){this.pause();this.state="DONE";this.onState(this.state);return false}this.emit(this.#events[this.#i++]!);return true}
 stop(){this.pause();this.#events=[];this.#i=0;this.state="IDLE"}
 get position(){return {index:this.#i,total:this.#events.length}}
}
