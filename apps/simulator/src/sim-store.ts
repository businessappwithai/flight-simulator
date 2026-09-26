import type {LearningBook,LearningInsight,PilotIntent,SimPilot,WorldSnapshot} from "@flight/protocol";
import {SimulationWorkerClient,type WorldEvent} from "./worker-client.ts";
/**
 * Single source of truth for the presentation layer. Holds only protocol snapshots received from the
 * simulation worker; 3D components read `latest` every frame, the React HUD subscribes to a throttled view.
 */
export type ScenarioKind="default"|"seeded";
export const RATES=[.5,1,2,4,8] as const;
export interface LearningSummary{flights:number;landings:number;crashes:number;experiences:number}
export interface HudState{world?:WorldSnapshot;pilot:SimPilot;intent:PilotIntent;autopilotMode:string;scenarioId:string;paused:boolean;rate:number;fps:number;simRate:number;checksum?:string;banner?:{title:string;detail?:string;sticky:boolean};error?:string;version:number;
 /** False while the aircraft waits on the runway: the simulation clock does not run until the pilot starts. */
 started:boolean;jevKeyHint?:string;learning:LearningSummary;insight?:LearningInsight}
/**
 * Browser persistence. Every access is guarded: storage can be disabled (private mode, blocked site data) or
 * full, and the simulator must keep flying either way.
 */
export const JEV_KEY_STORAGE="flightWorld.jevKey",LEARNING_STORAGE="flightWorld.learning.v1";
const storage={
 get(k:string){try{return localStorage.getItem(k)??undefined}catch{return undefined}},
 set(k:string,v:string){try{localStorage.setItem(k,v);return true}catch{return false}},
 remove(k:string){try{localStorage.removeItem(k)}catch{/* nothing stored to remove */}}
};
/** Returns an error message for an unusable key, or undefined when the key can be saved. */
export function jevKeyProblem(key:string):string|undefined{
 if(!key)return "Enter a Jev key.";
 if(/\s/.test(key))return "The key cannot contain spaces.";
 if(key.length<8)return "That key is too short (at least 8 characters).";
 if(key.length>512)return "That key is too long.";
 return undefined;
}
export interface StoreOptions{seed:bigint;scenario:ScenarioKind;pilot:SimPilot;rate:number;workerUrl?:URL}
export class SimStore{
 readonly client:SimulationWorkerClient;
 latest?:WorldEvent;prevHeading?:number;turnDt=0;
 seed:bigint;scenario:ScenarioKind;pilot:SimPilot;rate:number;paused=false;intent:PilotIntent="HOLD";started=false;jevKey?:string;
 learning:LearningSummary={flights:0,landings:0,crashes:0,experiences:0};
 fps=0;simRate=0;#tickDebt=0;#steppedTicks=0;#rateClock=performance.now();#frames=0;
 #listeners=new Set<()=>void>();#hud:HudState;#dirty=true;#lastNotify=0;#lastPhase="";#bannerTimer?:ReturnType<typeof setTimeout>;#errorTimer?:ReturnType<typeof setTimeout>;
 #banner?:HudState["banner"];#error?:string;#resetListeners=new Set<()=>void>();
 constructor(o:StoreOptions){
  this.jevKey=storage.get(JEV_KEY_STORAGE)||undefined;
  // The autopilot needs a Jev key; without one the flight starts under manual control.
  this.seed=o.seed;this.scenario=o.scenario;this.pilot=this.jevKey?o.pilot:"MANUAL";this.rate=o.rate;
  this.client=new SimulationWorkerClient(o.workerUrl);
  this.client.onError=m=>this.showError(`Simulation: ${m}`);
  this.client.onEvent(e=>{
   if(e.type==="LEARNING"){this.#learned(e.book,e.reason);return}
   if(e.type!=="WORLD")return;const prev=this.latest?.world;
   this.turnDt=prev?Number(e.world.tick-prev.tick)/120:0;this.prevHeading=prev?.aircraft.heading;this.latest=e;this.#phase(e.world);this.#dirty=true});
  this.#loadLearning();this.client.send({type:"SET_LEARNING",enabled:!!this.jevKey});
  this.#hud=this.#snapshot();this.restart();
 }
 // ---- React subscription (useSyncExternalStore); notifications are throttled to ~10 Hz.
 subscribe=(l:()=>void)=>{this.#listeners.add(l);return()=>{this.#listeners.delete(l)}};
 getSnapshot=()=>this.#hud;
 #notify(force=false){const now=performance.now();if(!force&&(!this.#dirty||now-this.#lastNotify<100))return;this.#lastNotify=now;this.#dirty=false;this.#hud=this.#snapshot();for(const l of this.#listeners)l()}
 #snapshot():HudState{const l=this.latest;return {world:l?.world,pilot:this.pilot,intent:this.intent,autopilotMode:l?.autopilotMode??"",scenarioId:l?.scenarioId??"—",paused:this.paused,rate:this.rate,fps:this.fps,simRate:this.simRate,checksum:this.client.checksum,banner:this.#banner,error:this.#error,version:(this.#hud?.version??0)+1,
  started:this.started,jevKeyHint:this.jevKey?`••••${this.jevKey.slice(-4)}`:undefined,learning:this.learning,insight:this.jevKey?l?.insight:undefined}}
 onReset(l:()=>void){this.#resetListeners.add(l);return()=>{this.#resetListeners.delete(l)}}
 // ---- Called once per rendered frame by the R3F SimulationDriver.
 frame(rawDelta:number,hidden:boolean){
  if(this.started&&!this.paused&&!hidden){this.#tickDebt+=Math.min(.25,rawDelta)*120*this.rate;const whole=Math.min(240,Math.floor(this.#tickDebt));if(whole>0&&this.client.step(whole)){this.#tickDebt-=whole;this.#steppedTicks+=whole}if(this.#tickDebt>480)this.#tickDebt=480}
  this.#frames++;const now=performance.now();if(now-this.#rateClock>=1000){const s=(now-this.#rateClock)/1000;this.fps=Math.round(this.#frames/s);this.simRate=this.#steppedTicks/120/s;this.#frames=0;this.#steppedTicks=0;this.#rateClock=now;this.#dirty=true}
  this.#notify();
 }
 // ---- Commands
 restart(newScenario=false){
  if(newScenario){this.scenario="seeded";this.seed+=1n}
  // Every flight begins parked on the runway; the clock runs once the pilot starts.
  this.latest=undefined;this.prevHeading=undefined;this.#lastPhase="";this.#banner=undefined;this.started=false;this.#tickDebt=0;
  this.client.reset(this.seed,this.scenario);this.client.pilot(this.pilot);this.client.intent("HOLD");this.intent="HOLD";if(this.paused)this.client.pause(true);
  for(const l of this.#resetListeners)l();this.#notify(true);
 }
 setPilot(p:SimPilot,announce=false){
  if(p==="AUTOPILOT"&&!this.jevKey){this.toast("Add a Jev key to use the autopilot",2600);return}
  if(p==="AUTOPILOT")this.start();
  this.pilot=p;this.client.pilot(p);if(p==="AUTOPILOT")this.setIntent("HOLD");if(announce)this.toast(p==="AUTOPILOT"?"Autopilot engaged":"Autopilot disconnected — manual control");this.#notify(true)}
 setIntent(i:PilotIntent){if(i!=="HOLD")this.start();if(i===this.intent)return;this.intent=i;this.client.intent(i);this.#notify(true)}
 /** A manual flight input disengages the autopilot, as in a real aircraft. */
 manual(i:PilotIntent){if(this.pilot==="AUTOPILOT")this.setPilot("MANUAL",true);this.setIntent(i)}
 /** Releases the brakes: the simulation starts from the runway. Any flight input or engaging the autopilot also starts it. */
 start(){if(this.started)return;this.started=true;this.#notify(true)}
 // ---- Jev key (kept only in this browser) and learning
 saveJevKey(raw:string):string|undefined{
  const key=raw.trim(),problem=jevKeyProblem(key);if(problem)return problem;
  if(!storage.set(JEV_KEY_STORAGE,key))return "This browser blocked saving the key (storage is disabled or full).";
  this.jevKey=key;this.client.send({type:"SET_LEARNING",enabled:true});this.toast("Jev key saved — autopilot and learning are on",2600);this.#notify(true);return undefined;
 }
 removeJevKey(){
  storage.remove(JEV_KEY_STORAGE);this.jevKey=undefined;this.client.send({type:"SET_LEARNING",enabled:false});
  if(this.pilot==="AUTOPILOT"){this.pilot="MANUAL";this.client.pilot("MANUAL");this.setIntent("HOLD")}
  this.toast("Jev key removed — manual control only",2600);this.#notify(true);
 }
 /** Forgets everything learned and puts the aircraft back on the runway. */
 clearLearning(){storage.remove(LEARNING_STORAGE);this.client.send({type:"CLEAR_LEARNING"});this.restart();this.toast("Learning cleared — back on the runway",2600)}
 #loadLearning(){
  const raw=storage.get(LEARNING_STORAGE);if(!raw)return;
  let book:unknown;try{book=JSON.parse(raw)}catch{storage.remove(LEARNING_STORAGE);this.toast("Saved learning was unreadable and has been reset",4000);return}
  this.client.send({type:"LOAD_LEARNING",book});
 }
 #learned(book:LearningBook,reason:"LOADED"|"RECORDED"|"CLEARED"|"REJECTED"){
  this.learning={flights:book.flights,landings:book.landings,crashes:book.crashes,experiences:Object.keys(book.entries).length};
  if(reason==="REJECTED"){storage.remove(LEARNING_STORAGE);this.toast("Saved learning was unreadable and has been reset",4000)}
  if(reason==="RECORDED"&&!storage.set(LEARNING_STORAGE,JSON.stringify(book)))this.showError("Could not save learning: browser storage is disabled or full.");
  this.#notify(true);
 }
 togglePause(){this.paused=!this.paused;this.client.pause(this.paused);this.#notify(true)}
 changeRate(dir:1|-1){const i=RATES.indexOf(this.rate as typeof RATES[number]);this.rate=RATES[Math.max(0,Math.min(RATES.length-1,(i<0?1:i)+dir))]!;this.#notify(true)}
 toast(title:string,ms=1800){this.#setBanner({title,sticky:false},ms)}
 showError(message:string,sticky=false){this.#error=message;console.error(message);clearTimeout(this.#errorTimer);if(!sticky)this.#errorTimer=setTimeout(()=>{this.#error=undefined;this.#notify(true)},7000);this.#notify(true)}
 #setBanner(b:HudState["banner"],ms?:number){this.#banner=b;clearTimeout(this.#bannerTimer);if(ms)this.#bannerTimer=setTimeout(()=>{this.#banner=undefined;this.#notify(true)},ms);this.#notify(true)}
 #phase(w:WorldSnapshot){const p=w.objective.phase;if(p===this.#lastPhase)return;const first=this.#lastPhase==="";this.#lastPhase=p;if(first&&p==="OUTBOUND")return;
  const secs=(Number(w.tick)/120).toFixed(1);
  if(p==="RETURN")this.#setBanner({title:"Gate passed",detail:"Return and land on runway 18",sticky:false},3500);
  else if(p==="COMPLETE")this.#setBanner({title:"Landed — mission complete",detail:`${secs} s · R restart · N new scenario`,sticky:true});
  else if(p==="FAILED"){const o=w.entities.find(e=>e.kind==="OBSTACLE"),a=w.aircraft.position,hit=o&&Math.hypot(a.x-o.position.x,a.y-o.position.y,a.z-o.position.z)<=o.radius+4;
   this.#setBanner({title:hit?"Collision with the balloon":"Crashed on landing or impact",detail:`${secs} s · R restart · N new scenario`,sticky:true})}}
 dispose(){this.client.dispose();clearTimeout(this.#bannerTimer);clearTimeout(this.#errorTimer);this.#listeners.clear()}
}
export type {WorldEvent};
