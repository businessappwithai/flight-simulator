import type {PilotIntent,SimPilot,WorldSnapshot} from "@flight/protocol";
import {SimulationWorkerClient,type WorldEvent} from "./worker-client.ts";
/**
 * Single source of truth for the presentation layer. Holds only protocol snapshots received from the
 * simulation worker; 3D components read `latest` every frame, the React HUD subscribes to a throttled view.
 */
export type ScenarioKind="default"|"seeded";
export const RATES=[.5,1,2,4,8] as const;
export interface HudState{world?:WorldSnapshot;pilot:SimPilot;intent:PilotIntent;autopilotMode:string;scenarioId:string;paused:boolean;rate:number;fps:number;simRate:number;checksum?:string;banner?:{title:string;detail?:string;sticky:boolean};error?:string;version:number}
export interface StoreOptions{seed:bigint;scenario:ScenarioKind;pilot:SimPilot;rate:number;workerUrl?:URL}
export class SimStore{
 readonly client:SimulationWorkerClient;
 latest?:WorldEvent;prevHeading?:number;turnDt=0;
 seed:bigint;scenario:ScenarioKind;pilot:SimPilot;rate:number;paused=false;intent:PilotIntent="HOLD";
 fps=0;simRate=0;#tickDebt=0;#steppedTicks=0;#rateClock=performance.now();#frames=0;
 #listeners=new Set<()=>void>();#hud:HudState;#dirty=true;#lastNotify=0;#lastPhase="";#bannerTimer?:ReturnType<typeof setTimeout>;#errorTimer?:ReturnType<typeof setTimeout>;
 #banner?:HudState["banner"];#error?:string;#resetListeners=new Set<()=>void>();
 constructor(o:StoreOptions){
  this.seed=o.seed;this.scenario=o.scenario;this.pilot=o.pilot;this.rate=o.rate;
  this.client=new SimulationWorkerClient(o.workerUrl);
  this.client.onError=m=>this.showError(`Simulation: ${m}`);
  this.client.onEvent(e=>{if(e.type!=="WORLD")return;const prev=this.latest?.world;
   this.turnDt=prev?Number(e.world.tick-prev.tick)/120:0;this.prevHeading=prev?.aircraft.heading;this.latest=e;this.#phase(e.world);this.#dirty=true});
  this.#hud=this.#snapshot();this.restart();
 }
 // ---- React subscription (useSyncExternalStore); notifications are throttled to ~10 Hz.
 subscribe=(l:()=>void)=>{this.#listeners.add(l);return()=>{this.#listeners.delete(l)}};
 getSnapshot=()=>this.#hud;
 #notify(force=false){const now=performance.now();if(!force&&(!this.#dirty||now-this.#lastNotify<100))return;this.#lastNotify=now;this.#dirty=false;this.#hud=this.#snapshot();for(const l of this.#listeners)l()}
 #snapshot():HudState{const l=this.latest;return {world:l?.world,pilot:this.pilot,intent:this.intent,autopilotMode:l?.autopilotMode??"",scenarioId:l?.scenarioId??"—",paused:this.paused,rate:this.rate,fps:this.fps,simRate:this.simRate,checksum:this.client.checksum,banner:this.#banner,error:this.#error,version:(this.#hud?.version??0)+1}}
 onReset(l:()=>void){this.#resetListeners.add(l);return()=>{this.#resetListeners.delete(l)}}
 // ---- Called once per rendered frame by the R3F SimulationDriver.
 frame(rawDelta:number,hidden:boolean){
  if(!this.paused&&!hidden){this.#tickDebt+=Math.min(.25,rawDelta)*120*this.rate;const whole=Math.min(240,Math.floor(this.#tickDebt));if(whole>0&&this.client.step(whole)){this.#tickDebt-=whole;this.#steppedTicks+=whole}if(this.#tickDebt>480)this.#tickDebt=480}
  this.#frames++;const now=performance.now();if(now-this.#rateClock>=1000){const s=(now-this.#rateClock)/1000;this.fps=Math.round(this.#frames/s);this.simRate=this.#steppedTicks/120/s;this.#frames=0;this.#steppedTicks=0;this.#rateClock=now;this.#dirty=true}
  this.#notify();
 }
 // ---- Commands
 restart(newScenario=false){
  if(newScenario){this.scenario="seeded";this.seed+=1n}
  this.latest=undefined;this.prevHeading=undefined;this.#lastPhase="";this.#banner=undefined;
  this.client.reset(this.seed,this.scenario);this.client.pilot(this.pilot);this.client.intent("HOLD");this.intent="HOLD";if(this.paused)this.client.pause(true);
  for(const l of this.#resetListeners)l();this.#notify(true);
 }
 setPilot(p:SimPilot,announce=false){this.pilot=p;this.client.pilot(p);if(p==="AUTOPILOT")this.setIntent("HOLD");if(announce)this.toast(p==="AUTOPILOT"?"Autopilot engaged":"Autopilot disconnected — manual control");this.#notify(true)}
 setIntent(i:PilotIntent){if(i===this.intent)return;this.intent=i;this.client.intent(i);this.#notify(true)}
 /** A manual flight input disengages the autopilot, as in a real aircraft. */
 manual(i:PilotIntent){if(this.pilot==="AUTOPILOT")this.setPilot("MANUAL",true);this.setIntent(i)}
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
