import {REVEAL,revealState,type RevealState} from "@flight/protocol";
/*
 * The clock of the build-and-reveal sequence. Everything that animates (fronts in the terrain shader, trees and
 * buildings growing, water rising, the camera, the editor UI, the sound) reads `time()` / `state()` from here, so
 * one number drives the picture and the sound alike. QA can `seek(t)` to hold any frame.
 */
export class RevealDirector{
 #start=0;#held:number|undefined;#playing=false;#listeners=new Set<(playing:boolean)=>void>();
 get playing(){return this.#playing}
 /** Seconds into the sequence (Infinity when it is not playing: everything built). */
 time(){if(!this.#playing)return Infinity;const t=this.#held??(performance.now()-this.#start)/1000;if(t>=REVEAL.duration+.6&&this.#held===undefined){this.stop();return Infinity}return t}
 state():RevealState{return revealState(this.time())}
 start(){this.#held=undefined;this.#start=performance.now();this.#set(true)}
 /** Holds the sequence at time t (seconds); null resumes playing from there. */
 seek(t:number|null){if(t===null){if(this.#held!==undefined){this.#start=performance.now()-this.#held*1000;this.#held=undefined}return}this.#held=Math.max(0,Math.min(REVEAL.duration,t));this.#set(true)}
 stop(){this.#held=undefined;this.#set(false)}
 onChange(l:(playing:boolean)=>void){this.#listeners.add(l);return()=>{this.#listeners.delete(l)}}
 #set(p:boolean){if(p===this.#playing)return;this.#playing=p;for(const l of this.#listeners)l(p)}
}
