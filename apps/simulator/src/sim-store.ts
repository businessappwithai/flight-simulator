import type {SimEvent,CopilotAdvice,CopilotStatus,FeaturePatch,FlightTrace,GeoCatalogAirport,GeoStatus,LearningBook,LearningInsight,PilotIntent,SimPilot,TerrainPatch,WorldSnapshot} from "@flight/protocol";
import {SimulationWorkerClient,type WorldEvent} from "./worker-client.ts";
import {RUNTIME_CHANNEL,type RuntimeEvent} from "@flight/protocol";
/**
 * Single source of truth for the presentation layer. Holds only protocol snapshots received from the
 * simulation worker; 3D components read `latest` every frame, the React HUD subscribes to a throttled view.
 */
export type ScenarioKind="default"|"seeded";
// 16× and 32× make cross-country flights (tens of minutes of real time) practical to watch.
export const RATES=[.5,1,2,4,8,16,32] as const;
export interface LearningSummary{flights:number;landings:number;crashes:number;experiences:number;manualFlights:number;autopilotFlights:number}
export interface HudState{world?:WorldSnapshot;pilot:SimPilot;intent:PilotIntent;autopilotMode:string;scenarioId:string;paused:boolean;rate:number;fps:number;simRate:number;checksum?:string;banner?:{title:string;detail?:string;sticky:boolean};error?:string;version:number;
 /** False while the aircraft waits on the runway: the simulation clock does not run until the pilot starts. */
 started:boolean;jevKeyHint?:string;learning:LearningSummary;insight?:LearningInsight;
 /** Recent flights kept as Control Room telemetry, newest last. */
 traces:{flights:number;manual:number;autopilot:number};
 /** Jev copilot: its latest recommendation and the Jev / XGBoost status (only while a key is saved). */
 copilot?:CopilotAdvice;copilotStatus?:CopilotStatus;
 /** Real-world anchoring: the airport/runway the flight starts from (none = procedural airfield) and where it is. */
 geo?:GeoStatus;airport?:string;runway?:string;catalog:readonly GeoCatalogAirport[];
 /** Cross-country destination (the flight plan leads there), and the latest airport search. */
 destination?:string;destinationRunway?:string;catalogTotal:number;search:{query:string;airports:readonly GeoCatalogAirport[]};
 /** Offline route pack progress (PACK_ROUTE). */
 routePack?:RoutePack;
 /** Data-source overrides from the URL (dropped again when the worker rejects them). */
 terrainUrl?:string;featuresUrl?:string;
 /** Masked Google 3D Tiles key when one is saved. */
 tiles3dKeyHint?:string}
export type RoutePack=Omit<Extract<SimEvent,{type:"ROUTE_PACK"}>,"type">;
/** Terrain mesh changes for the 3D view; `clear` drops everything first (the world was re-anchored). */
export interface TerrainDiff{add:readonly TerrainPatch[];remove:readonly string[];clear:boolean}
/** Building / airport-surface mesh changes for the 3D view. */
export interface FeatureDiff{add:readonly FeaturePatch[];remove:readonly string[];clear:boolean}
/**
 * Browser persistence. Every access is guarded: storage can be disabled (private mode, blocked site data) or
 * full, and the simulator must keep flying either way.
 */
export const JEV_KEY_STORAGE="flightWorld.jevKey",TILES3D_KEY_STORAGE="flightWorld.tiles3dKey",LEARNING_STORAGE="flightWorld.learning.v2",TRACES_STORAGE="flightWorld.traces.v1",MAX_STORED_TRACES=20;
// The v1 book (never released) used autopilot modes instead of intents, so it cannot join v2 learning.
const RETIRED_STORAGE=["flightWorld.learning.v1"];
/** Telemetry JSON as the Control Room reads it: bigint ticks as "123n". */
const encode=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==="bigint"?`${x}n`:x);
const decode=(s:string)=>JSON.parse(s,(_,x)=>typeof x==="string"&&/^\d+n$/.test(x)?BigInt(x.slice(0,-1)):x);
const storage={
 get(k:string){try{return localStorage.getItem(k)??undefined}catch{return undefined}},
 set(k:string,v:string){try{localStorage.setItem(k,v);return true}catch{return false}},
 remove(k:string){try{localStorage.removeItem(k)}catch{/* nothing stored to remove */}}
};
/** Google Maps Platform API keys are URL-safe tokens (typically 39 characters, "AIza…"). */
export function tiles3dKeyProblem(key:string):string|undefined{
 if(!key)return "Enter a Google Maps API key.";
 if(!/^[\w-]{20,100}$/.test(key))return "That does not look like a Google Maps API key.";
 return undefined;
}
/** Returns an error message for an unusable key, or undefined when the key can be saved. */
/**
 * A self-hosted Jev (TypeSafe API) for the autopilot: `&jevUrl=`. Only on this machine (localhost) or this site's own
 * origin, so a link can never send the Jev key saved in this browser to someone else's server.
 */
export function jevUrlOption(raw:string|null,origin=globalThis.location?.origin):string|undefined{
 if(!raw)return undefined;let u:URL;try{u=new URL(raw)}catch{return undefined}
 const local=u.protocol==="http:"||u.protocol==="https:"?["localhost","127.0.0.1","[::1]"].includes(u.hostname):false;
 return local||(origin!==undefined&&u.origin===origin)?u.href.replace(/\/$/,""):undefined;
}
export function jevKeyProblem(key:string):string|undefined{
 if(!key)return "Enter a Jev key.";
 if(/\s/.test(key))return "The key cannot contain spaces.";
 if(key.length<8)return "That key is too short (at least 8 characters).";
 if(key.length>512)return "That key is too long.";
 return undefined;
}
export interface StoreOptions{seed:bigint;scenario:ScenarioKind;pilot:SimPilot;rate:number;workerUrl?:URL;airport?:string;runway?:string;terrainUrl?:string;destination?:string;destinationRunway?:string;
 /** A Google Maps API key passed in a link: saved like one entered in the panel. */
 tiles3dKey?:string;
 /** Buildings/airport surfaces source (vector tiles); "off" disables them; unset uses the worker's default. */
 featuresUrl?:string;
 /** A self-hosted Jev endpoint (already checked by the page: localhost or this site). */
 jevUrl?:string}
export class SimStore{
 readonly client:SimulationWorkerClient;
 latest?:WorldEvent;prevHeading?:number;turnDt=0;
 /** Google Maps API key for Photorealistic 3D Tiles (kept only in this browser). */
 tiles3dKey?:string;
 seed:bigint;scenario:ScenarioKind;pilot:SimPilot;rate:number;paused=false;intent:PilotIntent="HOLD";started=false;jevKey?:string;readonly jevUrl?:string;
 learning:LearningSummary={flights:0,landings:0,crashes:0,experiences:0,manualFlights:0,autopilotFlights:0};
 traces:FlightTrace[]=[];
 airport?:string;runway?:string;terrainUrl?:string;catalog:readonly GeoCatalogAirport[]=[];catalogTotal=0;
 destination?:string;destinationRunway?:string;search:HudState["search"]={query:"",airports:[]};routePack?:RoutePack;
 /** Frame epoch of the last WORLD: it changes when the worker re-anchors the local frame on a long flight. */
 #frameEpoch=0;#rebaseListeners=new Set<()=>void>();
 /** Terrain meshes currently shown, by tile key (the 3D view mirrors this through onTerrain). */
 readonly terrain=new Map<string,TerrainPatch>();#terrainEpoch=0;#terrainListeners=new Set<(d:TerrainDiff)=>void>();
 featuresUrl?:string;
 /** Building and airport-surface meshes currently shown, by key (mirrored by the 3D view through onFeatures). */
 readonly features=new Map<string,FeaturePatch>();#featureEpoch=0;#featureListeners=new Set<(d:FeatureDiff)=>void>();
 /** The real runway the aircraft last came to rest on (announced once per touchdown). */
 #landedOn?:string;
 fps=0;simRate=0;#tickDebt=0;#steppedTicks=0;#rateClock=performance.now();#frames=0;
 #listeners=new Set<()=>void>();#hud:HudState;#dirty=true;#lastNotify=0;#lastPhase="";#bannerTimer?:ReturnType<typeof setTimeout>;#errorTimer?:ReturnType<typeof setTimeout>;
 #banner?:HudState["banner"];#error?:string;#resetListeners=new Set<()=>void>();
 constructor(o:StoreOptions){
  this.jevKey=storage.get(JEV_KEY_STORAGE)||undefined;
  if(o.tiles3dKey&&!tiles3dKeyProblem(o.tiles3dKey))storage.set(TILES3D_KEY_STORAGE,o.tiles3dKey);
  this.tiles3dKey=storage.get(TILES3D_KEY_STORAGE)||o.tiles3dKey||undefined;
  // The autopilot needs a Jev key; without one the flight starts under manual control.
  this.jevUrl=o.jevUrl;this.seed=o.seed;this.scenario=o.scenario;this.pilot=this.jevKey?o.pilot:"MANUAL";this.rate=o.rate;this.airport=o.airport;this.runway=o.runway;this.terrainUrl=o.terrainUrl;this.featuresUrl=o.featuresUrl;
  this.destination=o.airport?o.destination:undefined;this.destinationRunway=this.destination?o.destinationRunway:undefined;
  this.client=new SimulationWorkerClient(o.workerUrl);
  this.client.onError=(m,command)=>{this.showError(`Simulation: ${m}`);if(command==="SET_WORLD")this.#worldRejected(m)};
  this.client.onEvent(e=>{
   if(e.type==="LEARNING"){this.#learned(e.book,e.reason);return}
   // Jev did not answer and nothing has been learned yet: the worker handed the aircraft back, holding its height.
   if(e.type==="AUTOPILOT_OFF"){this.pilot="MANUAL";this.intent="HOLD";this.toast(e.reason,6000);this.#notify(true);return}
   if(e.type==="TRACE"){this.#traced(e.trace);return}
   if(e.type==="GEO_CATALOG"){this.catalog=e.airports;this.catalogTotal=e.total??e.airports.length;this.#notify(true);return}
   if(e.type==="WORLD_STREAM"){this.#relay({type:"WORLD_STREAM",tick:e.tick,stream:e.stream});return}
   if(e.type==="ROUTE_PACK"){const {type:_,...p}=e;this.routePack=p;this.#notify(true);return}
   if(e.type==="AIRPORTS_FOUND"){for(const a of e.airports)this.#seen.set(a.ident,a);if(e.query===this.search.query){this.search={query:e.query,airports:e.airports};this.#notify(true)}return}
   if(e.type==="TERRAIN"){this.#terrainDiff(e.epoch,e.add,e.remove,!!e.clear);return}
   if(e.type==="FEATURES"){this.#featureDiff(e.epoch,e.add,e.remove,!!e.clear);return}
   if(e.type!=="WORLD")return;const prev=this.latest?.world;
   this.turnDt=prev?Number(e.world.tick-prev.tick)/120:0;this.prevHeading=prev?.aircraft.heading;this.latest=e;this.#rebased(e);this.#phase(e);this.#landing(e);this.#dirty=true});
  this.client.send({type:"SET_LEARNING",enabled:!!this.jevKey});this.client.send({type:"SET_JEV",apiKey:this.jevKey??null,...(this.jevUrl?{baseUrl:this.jevUrl}:{})});
  if(this.airport)this.#sendWorld();
  this.#hud=this.#snapshot();this.restart();
  // After the first restart, which clears banners: a warning about unreadable saved learning must stay visible.
  this.#loadLearning();this.#loadTraces();
 }
 // ---- React subscription (useSyncExternalStore); notifications are throttled to ~10 Hz.
 subscribe=(l:()=>void)=>{this.#listeners.add(l);return()=>{this.#listeners.delete(l)}};
 getSnapshot=()=>this.#hud;
 #notify(force=false){const now=performance.now();if(!force&&(!this.#dirty||now-this.#lastNotify<100))return;this.#lastNotify=now;this.#dirty=false;this.#hud=this.#snapshot();for(const l of this.#listeners)l()}
 #snapshot():HudState{const l=this.latest;return {world:l?.world,pilot:this.pilot,intent:this.intent,autopilotMode:l?.autopilotMode??"",scenarioId:l?.scenarioId??"—",paused:this.paused,rate:this.rate,fps:this.fps,simRate:this.simRate,checksum:this.client.checksum,banner:this.#banner,error:this.#error,version:(this.#hud?.version??0)+1,
  started:this.started,jevKeyHint:this.jevKey?`••••${this.jevKey.slice(-4)}`:undefined,learning:this.learning,insight:this.jevKey?l?.insight:undefined,
  copilot:this.jevKey?l?.copilot:undefined,copilotStatus:this.jevKey?l?.copilotStatus:undefined,
  traces:{flights:this.traces.length,manual:this.traces.filter(t=>t.pilots.includes("MANUAL")).length,autopilot:this.traces.filter(t=>t.pilots.includes("AUTOPILOT")).length},
  geo:l?.geo,airport:this.airport,runway:this.runway,catalog:this.catalog,destination:this.destination,destinationRunway:this.destinationRunway,catalogTotal:this.catalogTotal,search:this.search,routePack:this.routePack,terrainUrl:this.terrainUrl,featuresUrl:this.featuresUrl,tiles3dKeyHint:this.tiles3dKey?`••••${this.tiles3dKey.slice(-4)}`:undefined}}
 // ---- Real-world terrain (worker → 3D view)
 onTerrain(l:(d:TerrainDiff)=>void){this.#terrainListeners.add(l);return()=>{this.#terrainListeners.delete(l)}}
 #terrainDiff(epoch:number,add:readonly TerrainPatch[],remove:readonly string[],clear:boolean){
  if(clear)this.#terrainEpoch=epoch;else if(epoch!==this.#terrainEpoch)return; // a patch from before the last re-anchoring
  if(clear)this.terrain.clear();for(const k of remove)this.terrain.delete(k);for(const p of add)this.terrain.set(p.key,p);
  for(const l of this.#terrainListeners)l({add,remove,clear});
 }
 onFeatures(l:(d:FeatureDiff)=>void){this.#featureListeners.add(l);return()=>{this.#featureListeners.delete(l)}}
 #featureDiff(epoch:number,add:readonly FeaturePatch[],remove:readonly string[],clear:boolean){
  if(clear)this.#featureEpoch=epoch;else if(epoch!==this.#featureEpoch)return;
  if(clear)this.features.clear();for(const k of remove)this.features.delete(k);for(const p of add)this.features.set(p.key,p);
  for(const l of this.#featureListeners)l({add,remove,clear});
 }
 #sendWorld(){this.client.send({type:"SET_WORLD",airport:this.airport??null,...(this.runway?{runway:this.runway}:{}),...(this.terrainUrl?{terrainUrl:this.terrainUrl}:{}),
  ...(this.featuresUrl?{featuresUrl:this.featuresUrl==="off"?null:this.featuresUrl}:{}),
  ...(this.airport&&this.destination?{destination:this.destination,...(this.destinationRunway?{destinationRunway:this.destinationRunway}:{})}:{})})}
 /** Fly from a real airport and runway (or back to the procedural airfield with null); the aircraft returns to the runway. */
 setWorld(airport:string|null,runway?:string){this.airport=airport??undefined;this.runway=airport?runway:undefined;
  if(!airport||airport===this.destination){this.destination=undefined;this.destinationRunway=undefined}this.#sendWorld();this.restart()}
 /** Fly to another airport (null: no destination, the local mission). The flight restarts on the departure runway. */
 setDestination(ident:string|null,runway?:string){if(!this.airport)return;this.routePack=undefined;this.destination=ident??undefined;this.destinationRunway=ident?runway:undefined;this.#sendWorld();this.restart()}
 /** Fetches every tile the planned route needs and keeps it in the browser for offline flying. */
 packRoute(){this.routePack={state:"RUNNING",done:0,total:0,failed:0,cached:null};this.client.send({type:"PACK_ROUTE"});this.#notify(true)}
 clearTileCache(){this.client.send({type:"CLEAR_TILE_CACHE"})}
 /** Searches the worker's airport catalogue (ICAO, IATA, name or city); results arrive in `search`. */
 /** Airports seen in the short list or in search results (for runway lists and names of searched airports). */
 airportInfo(ident?:string){return ident?this.catalog.find(a=>a.ident===ident)??this.#seen.get(ident):undefined}
 #seen=new Map<string,GeoCatalogAirport>();
 findAirports(query:string){const q=query.slice(0,64);this.search={query:q,airports:q.trim()?this.search.airports:[]};if(q.trim())this.client.send({type:"FIND_AIRPORTS",query:q,limit:12});this.#notify(true)}
 /** The worker refused SET_WORLD (unknown airport, runway or destination): show what it is actually flying. */
 #worldRejected(message:string){
  const next=recoverWorld({airport:this.airport,runway:this.runway,destination:this.destination,destinationRunway:this.destinationRunway,terrainUrl:this.terrainUrl,featuresUrl:this.featuresUrl},message);
  if(next){Object.assign(this,next);this.#sendWorld();this.restart();return}
  // The departure itself is unusable: show what the worker is actually flying (the procedural airfield on first load).
  const g=this.latest?.geo;this.airport=g?.airport;this.runway=g?.runway;this.destination=g?.route?.destination;this.destinationRunway=g?.route?.runway;this.#notify(true)}
 /** Called when the worker re-anchored the local frame: trails and maps drawn in the old frame must start over. */
 /** Live telemetry for Control Room tabs of this site (BroadcastChannel; absent where unsupported). */
 #channel=typeof BroadcastChannel==="function"?new BroadcastChannel(RUNTIME_CHANNEL):undefined;
 #relay(event:RuntimeEvent){try{this.#channel?.postMessage({type:"FLIGHT_RUNTIME_EVENT",event})}catch{/* a closed channel only loses live telemetry */}}
 onRebase(l:()=>void){this.#rebaseListeners.add(l);return()=>{this.#rebaseListeners.delete(l)}}
 #rebased(e:WorldEvent){const epoch=e.geo?.frameEpoch??0;if(epoch===this.#frameEpoch)return;this.#frameEpoch=epoch;for(const l of this.#rebaseListeners)l()}
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
 // ---- Google Photorealistic 3D Tiles key (kept only in this browser)
 saveTiles3dKey(raw:string):string|undefined{const key=raw.trim(),problem=tiles3dKeyProblem(key);if(problem)return problem;
  if(!storage.set(TILES3D_KEY_STORAGE,key))return "This browser blocked saving the key (storage is disabled or full).";this.tiles3dKey=key;this.toast("3D Tiles key saved — shown over real airports",2600);this.#notify(true);return undefined}
 removeTiles3dKey(){storage.remove(TILES3D_KEY_STORAGE);this.tiles3dKey=undefined;this.toast("3D Tiles key removed",2000);this.#notify(true)}
 // ---- Jev key (kept only in this browser) and learning
 saveJevKey(raw:string):string|undefined{
  const key=raw.trim(),problem=jevKeyProblem(key);if(problem)return problem;
  if(!storage.set(JEV_KEY_STORAGE,key))return "This browser blocked saving the key (storage is disabled or full).";
  this.jevKey=key;this.client.send({type:"SET_LEARNING",enabled:true});this.client.send({type:"SET_JEV",apiKey:key,...(this.jevUrl?{baseUrl:this.jevUrl}:{})});this.toast("Jev key saved — autopilot and learning are on",2600);this.#notify(true);return undefined;
 }
 removeJevKey(){
  storage.remove(JEV_KEY_STORAGE);this.jevKey=undefined;this.client.send({type:"SET_LEARNING",enabled:false});this.client.send({type:"SET_JEV",apiKey:null});
  if(this.pilot==="AUTOPILOT"){this.pilot="MANUAL";this.client.pilot("MANUAL");this.setIntent("HOLD")}
  this.toast("Jev key removed — manual control only",2600);this.#notify(true);
 }
 /** Forgets everything learned and puts the aircraft back on the runway. */
 clearLearning(){storage.remove(LEARNING_STORAGE);storage.remove(TRACES_STORAGE);this.traces=[];this.client.send({type:"CLEAR_LEARNING"});this.restart();this.toast("Learning and traces cleared — back on the runway",2600)}
 /** Recent flights as one JSONL file the Control Room can replay (`bun run control-room` → load JSONL). */
 tracesJsonl(){return this.traces.flatMap(t=>t.events.map(encode)).join("\n")+(this.traces.length?"\n":"")}
 downloadTraces(){
  if(!this.traces.length)return;
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([this.tracesJsonl()],{type:"application/x-ndjson"}));
  a.download=`flight-traces-${new Date().toISOString().slice(0,19).replaceAll(":","")}.jsonl`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 }
 #loadTraces(){
  const raw=storage.get(TRACES_STORAGE);if(!raw)return;
  try{const t=decode(raw);if(!Array.isArray(t)||!t.every(x=>x&&typeof x.id==="string"&&Array.isArray(x.pilots)&&Array.isArray(x.events)))throw new Error("bad traces");this.traces=t.slice(-MAX_STORED_TRACES)}
  catch{storage.remove(TRACES_STORAGE);this.traces=[]}
 }
 #traced(trace:FlightTrace){
  this.traces=[...this.traces,trace].slice(-MAX_STORED_TRACES);
  // Oldest flights make room when storage is full; the in-memory list stays complete for this session.
  let kept=this.traces;while(kept.length&&!storage.set(TRACES_STORAGE,encode(kept)))kept=kept.slice(1);
  if(!kept.length)this.showError("Could not save flight traces: browser storage is disabled or full.");
  this.#notify(true);
 }
 #loadLearning(){
  for(const k of RETIRED_STORAGE)storage.remove(k);
  const raw=storage.get(LEARNING_STORAGE);if(!raw)return;
  let book:unknown;try{book=JSON.parse(raw)}catch{storage.remove(LEARNING_STORAGE);this.toast("Saved learning was unreadable and has been reset",4000);return}
  this.client.send({type:"LOAD_LEARNING",book});
 }
 #learned(book:LearningBook,reason:"LOADED"|"RECORDED"|"CLEARED"|"REJECTED"){
  this.learning={flights:book.flights,landings:book.landings,crashes:book.crashes,experiences:Object.keys(book.entries).length,manualFlights:book.manual.flights,autopilotFlights:book.autopilot.flights};
  if(reason==="REJECTED"){storage.remove(LEARNING_STORAGE);this.toast("Saved learning was unreadable and has been reset",4000)}
  if(reason==="RECORDED"&&!storage.set(LEARNING_STORAGE,JSON.stringify(book)))this.showError("Could not save learning: browser storage is disabled or full.");
  this.#notify(true);
 }
 togglePause(){this.paused=!this.paused;this.client.pause(this.paused);this.#notify(true)}
 changeRate(dir:1|-1){const i=RATES.indexOf(this.rate as typeof RATES[number]);this.rate=RATES[Math.max(0,Math.min(RATES.length-1,(i<0?1:i)+dir))]!;this.#notify(true)}
 toast(title:string,ms=1800){this.#setBanner({title,sticky:false},ms)}
 showError(message:string,sticky=false){this.#error=message;console.error(message);clearTimeout(this.#errorTimer);if(!sticky)this.#errorTimer=setTimeout(()=>{this.#error=undefined;this.#notify(true)},7000);this.#notify(true)}
 #setBanner(b:HudState["banner"],ms?:number){this.#banner=b;clearTimeout(this.#bannerTimer);if(ms)this.#bannerTimer=setTimeout(()=>{this.#banner=undefined;this.#notify(true)},ms);this.#notify(true)}
 /** Touchdown on a real runway away from the home airfield: a landing, announced once (full stop not required). */
 #landing(e:WorldEvent){
  const a=e.world.aircraft,on=e.geo?.runwayBelow&&a.grounded&&!a.crashed?e.geo.runwayBelow:undefined;
  // At the destination the arrival banner (see #phase) says it all.
  const atDestination=!!e.geo?.route&&(e.world.objective.phase==="COMPLETE"||on?.startsWith(`${e.geo.route.destination} `)||e.geo.route.distanceM<4000);
  if(on&&on!==this.#landedOn&&!atDestination)this.#setBanner({title:`Landed on runway ${on}`,detail:"Real runway · throttle up to take off again",sticky:false},4500);
  this.#landedOn=on;
 }
 #phase(e:WorldEvent){const w=e.world,geo=e.geo,p=w.objective.phase;if(p===this.#lastPhase)return;const first=this.#lastPhase==="";this.#lastPhase=p;if(first&&p==="OUTBOUND")return;
  const secs=(Number(w.tick)/120).toFixed(1),mins=Number(w.tick)/120/60;
  if(p==="COMPLETE"&&geo?.arrived){this.#setBanner({title:`Arrived at ${geo.arrived}${geo.runwayBelow?` · runway ${geo.runwayBelow.replace(/^\S+ /,"")}`:""}`,detail:`${geo.route?.name??""} · ${mins>=1?`${Math.floor(mins)} min ${Math.round((mins%1)*60)} s`:`${secs} s`} · R fly it again`,sticky:true});return}
  if(p==="RETURN")this.#setBanner({title:"Gate passed",detail:"Return and land on runway 18",sticky:false},3500);
  else if(p==="COMPLETE")this.#setBanner({title:"Landed — mission complete",detail:`${secs} s · R restart · N new scenario`,sticky:true});
  else if(p==="FAILED"){const o=w.entities.find(e=>e.kind==="OBSTACLE"),a=w.aircraft.position,hit=o&&Math.hypot(a.x-o.position.x,a.y-o.position.y,a.z-o.position.z)<=o.radius+4;
   this.#setBanner({title:hit?"Collision with the balloon":crashCause(w,geo),detail:`${secs} s · R restart · N new scenario`,sticky:true})}}
 dispose(){this.#channel?.close();this.client.dispose();clearTimeout(this.#bannerTimer);clearTimeout(this.#errorTimer);this.#listeners.clear()}
}
export interface WorldRequest{airport?:string;runway?:string;destination?:string;destinationRunway?:string;terrainUrl?:string;featuresUrl?:string}
/**
 * The worker refused SET_WORLD with `message`: the same request without the part it objected to (an unknown runway,
 * destination or destination runway, a bad terrain or features URL), or null when the departure airport itself is
 * unknown and nothing sensible is left to retry.
 */
export function recoverWorld(r:WorldRequest,message:string):WorldRequest|null{
 const drop=(...k:(keyof WorldRequest)[])=>{const n={...r};for(const x of k)n[x]=undefined;return n};
 if(!r.airport||/^unknown airport/.test(message))return null;
 if(r.destination&&(/^unknown destination|^destination is the departure/.test(message)||message.startsWith(`${r.destination} has no open runway`)))return drop("destination","destinationRunway");
 if(r.destination&&r.destinationRunway&&message.startsWith(`${r.destination} `))return drop("destinationRunway");
 if(r.runway&&message.startsWith(`${r.airport} `))return drop("runway");
 if(r.terrainUrl&&/terrain URL/.test(message))return drop("terrainUrl");
 if(r.featuresUrl&&/features URL/.test(message))return drop("featuresUrl");
 return null;
}
/** Why a flight ended: too hard or too banked a touchdown, or (in the real world) what the aircraft flew into. */
export function crashCause(w:WorldSnapshot,geo?:GeoStatus):string{
 const a=w.aircraft,hard=Math.abs(a.velocity.y)>8||Math.abs(a.roll)>.35;
 if(geo?.surface==="BUILDING")return "Crashed into a building";
 if(geo?.surface==="TERRAIN")return "Flew into terrain";
 if(hard)return Math.abs(a.roll)>.35&&Math.abs(a.velocity.y)<=8?"Crashed: wing struck the ground (too much bank)":"Crashed: touchdown too hard";
 return "Crashed on landing or impact";
}
export type {WorldEvent};
