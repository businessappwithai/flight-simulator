import * as THREE from "three";
import type {PilotIntent,SimPilot,WorldSnapshot} from "@flight/protocol";
import {SimulationWorkerClient,type WorldEvent} from "./worker-client.ts";
import {buildScenery} from "./scenery.ts";
import {WorldView} from "./world-view.ts";
import {CameraRig,CAMERA_MODES,type CameraMode} from "./cameras.ts";
import {SixPack,MiniMap,flightData} from "./instruments.ts";
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const errorBox=$("error");let errorTimer:ReturnType<typeof setTimeout>|undefined;
function showError(message:string,sticky=false){errorBox.textContent=message;errorBox.classList.add("show");clearTimeout(errorTimer);if(!sticky)errorTimer=setTimeout(()=>errorBox.classList.remove("show"),7000);console.error(message)}
window.addEventListener("error",e=>showError(`Unexpected error: ${e.message}`));
window.addEventListener("unhandledrejection",e=>showError(`Unexpected error: ${e.reason?.message??e.reason}`));

// ---- URL options (also used by automated QA): ?seed=7&scenario=seeded&pilot=manual&camera=cockpit&rate=2&hud=0
const params=new URLSearchParams(location.search);
const parseSeed=(v:string|null)=>v&&/^\d{1,19}$/.test(v)?BigInt(v):1n;
let seed=parseSeed(params.get("seed")),scenarioKind:"default"|"seeded"=params.get("scenario")==="seeded"?"seeded":"default";
let pilot:SimPilot=params.get("pilot")?.toUpperCase()==="MANUAL"?"MANUAL":"AUTOPILOT";
const RATES=[.5,1,2,4,8];let rate=RATES.includes(Number(params.get("rate")))?Number(params.get("rate")):1;

// ---- Renderer
const canvas=$<HTMLCanvasElement>("view");let renderer:THREE.WebGLRenderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance"})}
catch(e){showError("WebGL is not available in this browser, so the 3D view cannot start. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.",true);throw e}
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
const quality=params.get("quality")==="low"?"low":"high";
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.62;renderer.shadowMap.enabled=quality==="high";if(quality==="low")renderer.setPixelRatio(1);renderer.shadowMap.type=THREE.PCFSoftShadowMap;
canvas.addEventListener("webglcontextlost",e=>{e.preventDefault();showError("The graphics context was lost (GPU reset). Reload the page to continue.",true)});
const scene=new THREE.Scene(),scenery=buildScenery(scene,renderer),view=new WorldView(scene),rig=new CameraRig(canvas);
const sixpack=new SixPack($<HTMLCanvasElement>("sixpack")),minimap=new MiniMap($<HTMLCanvasElement>("minimap"));
function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);rig.resize(w,h)}addEventListener("resize",resize);resize();
const requestedCam=(params.get("camera")??"").toUpperCase() as CameraMode;
rig.set(CAMERA_MODES.includes(requestedCam)?requestedCam:"CHASE",view.aircraft.group);
if(params.get("hud")==="0")for(const id of ["panel","map","readout"])$(id).classList.add("hidden");

// ---- Mission messages
const banner=$("banner");let bannerTimer:ReturnType<typeof setTimeout>|undefined;
function showBanner(html:string,ms?:number){banner.innerHTML=html;banner.classList.add("show");clearTimeout(bannerTimer);if(ms)bannerTimer=setTimeout(hideBanner,ms)}
function hideBanner(){banner.classList.remove("show")}
function toast(text:string){const t=document.createElement("small");t.textContent=text;showBanner("",1800);banner.replaceChildren(t)}
function onPhase(w:WorldSnapshot){const p=w.objective.phase;if(p===lastPhase)return;const first=lastPhase==="";lastPhase=p;if(first&&p==="OUTBOUND")return;
 const secs=(Number(w.tick)/120).toFixed(1);
 if(p==="RETURN")showBanner("Gate passed<small>Return and land on runway 18</small>",3500);
 else if(p==="COMPLETE")showBanner(`Landed — mission complete<small>${secs} s · R restart · N new scenario</small>`);
 else if(p==="FAILED"){const o=w.entities.find(e=>e.kind==="OBSTACLE"),a=w.aircraft.position,hit=o&&Math.hypot(a.x-o.position.x,a.y-o.position.y,a.z-o.position.z)<=o.radius+4;
  showBanner(`${hit?"Collision with the balloon":"Crashed on landing or impact"}<small>${secs} s · R restart · N new scenario</small>`)}}

// ---- Simulation worker
const sim=new SimulationWorkerClient();sim.onError=m=>showError(`Simulation: ${m}`);
let latest:WorldEvent|undefined,prevHeading:number|undefined,prevTick:bigint|undefined,lastPhase="",paused=false,tickDebt=0,stepTicks=0,stepClock=performance.now(),measuredRate=0;
function restart(newScenario=false){
 if(newScenario){scenarioKind="seeded";seed=seed+1n}
 view.resetTrail();minimap.reset();latest=undefined;lastPhase="";prevHeading=undefined;hideBanner();
 sim.reset(seed,scenarioKind);sim.pilot(pilot);sim.intent("HOLD");if(paused)sim.pause(true);
 const url=new URL(location.href);url.searchParams.set("seed",String(seed));url.searchParams.set("scenario",scenarioKind);history.replaceState(null,"",url);
}
sim.onEvent(e=>{if(e.type!=="WORLD")return;
 const dt=latest&&prevTick!==undefined?Number(e.world.tick-prevTick)/120:0;
 prevHeading=latest?.world.aircraft.heading;prevTick=e.world.tick;latest=e;
 (latest as any).turnDt=dt;onPhase(e.world);
});
restart();

// ---- Pilot input
function setPilot(p:SimPilot,announce=false){pilot=p;sim.pilot(p);$("pilotLabel").textContent=p;$("btnPilot").setAttribute("aria-pressed",String(p==="AUTOPILOT"));if(announce)toast(p==="AUTOPILOT"?"Autopilot engaged":"Autopilot disconnected — manual control");if(p==="AUTOPILOT")sim.intent("HOLD")}
setPilot(pilot);
const KEYMAP:Record<string,PilotIntent>={KeyW:"CLIMB",ArrowUp:"CLIMB",KeyS:"DESCEND",ArrowDown:"DESCEND",ArrowLeft:"TURN_LEFT",KeyQ:"TURN_LEFT",ArrowRight:"TURN_RIGHT",KeyE:"TURN_RIGHT",ShiftLeft:"SLOW",ShiftRight:"SLOW",KeyX:"ABORT"};
const held:PilotIntent[]=[];let sentIntent:PilotIntent="HOLD";
function pushIntent(i:PilotIntent){if(pilot==="AUTOPILOT")setPilot("MANUAL",true);if(!held.includes(i))held.push(i);syncIntent()}
function releaseIntent(i:PilotIntent){const k=held.indexOf(i);if(k>=0)held.splice(k,1);syncIntent()}
function syncIntent(){const i=held.at(-1)??"HOLD";if(i!==sentIntent){sentIntent=i;sim.intent(i)}}
window.addEventListener("keydown",e=>{
 if(e.target instanceof HTMLInputElement)return;const intent=KEYMAP[e.code];
 if(intent){e.preventDefault();if(!e.repeat)pushIntent(intent);return}
 if(e.repeat)return;
 switch(e.code){
  case "KeyA":setPilot(pilot==="AUTOPILOT"?"MANUAL":"AUTOPILOT",true);break;
  case "KeyC":rig.next(view.aircraft.group);break;
  case "Digit1":case "Digit2":case "Digit3":case "Digit4":rig.set(CAMERA_MODES[Number(e.code.slice(-1))-1]!,view.aircraft.group);break;
  case "KeyP":case "Space":e.preventDefault();togglePause();break;
  case "KeyR":restart();break;case "KeyN":restart(true);break;
  case "KeyI":togglePanel();break;case "KeyH":$("help").classList.toggle("show");break;
  case "Escape":$("help").classList.remove("show");break;
  case "Equal":case "NumpadAdd":rate=RATES[Math.min(RATES.length-1,RATES.indexOf(rate)+1)]!;break;
  case "Minus":case "NumpadSubtract":rate=RATES[Math.max(0,RATES.indexOf(rate)-1)]!;break;
 }
});
window.addEventListener("keyup",e=>{const i=KEYMAP[e.code];if(i)releaseIntent(i)});
window.addEventListener("blur",()=>{held.length=0;syncIntent()});
for(const b of document.querySelectorAll<HTMLButtonElement>("#pad [data-intent]")){const i=b.dataset.intent as PilotIntent;
 b.addEventListener("pointerdown",e=>{e.preventDefault();b.setPointerCapture(e.pointerId);pushIntent(i)});for(const ev of ["pointerup","pointercancel"])b.addEventListener(ev,()=>releaseIntent(i))}
function togglePause(){paused=!paused;sim.pause(paused);$("btnPause").textContent=paused?"Resume":"Pause";$("btnPause").setAttribute("aria-pressed",String(paused))}
function togglePanel(){const hidden=$("panel").classList.toggle("hidden");$("btnPanel").setAttribute("aria-pressed",String(!hidden))}
$("btnPilot").onclick=()=>setPilot(pilot==="AUTOPILOT"?"MANUAL":"AUTOPILOT",true);$("btnCam").onclick=()=>rig.next(view.aircraft.group);
$("btnPause").onclick=togglePause;$("btnReset").onclick=()=>restart();$("btnNew").onclick=()=>restart(true);$("btnPanel").onclick=togglePanel;
$("btnHelp").onclick=()=>$("help").classList.toggle("show");$("help").onclick=e=>{if(e.target===$("help"))$("help").classList.remove("show")};

// ---- Frame loop: request simulation ticks in real time (×rate), render the latest authoritative snapshot.
const clock=new THREE.Clock();let frames=0,fpsClock=performance.now(),fps=0,elapsed=0;
function frame(){
 requestAnimationFrame(frame);const raw=clock.getDelta(),dt=Math.min(.1,raw);elapsed+=dt;
 // Simulated time follows wall-clock time (×rate) even at low frame rates, up to 0.25 s per frame.
 if(!paused&&!document.hidden){tickDebt+=Math.min(.25,raw)*120*rate;const whole=Math.min(240,Math.floor(tickDebt));if(whole>0&&sim.step(whole)){tickDebt-=whole;stepTicks+=whole}if(tickDebt>480)tickDebt=480}
 const w=latest?.world;
 if(w){view.sync(w,latest!.controls,dt,elapsed);scenery.update(rig.camera,view.aircraft.group.position,elapsed);rig.update(view.aircraft.group,view.aircraft.eye,dt);
  const d=flightData(w,prevHeading,(latest as any).turnDt??0);if(!$("panel").classList.contains("hidden"))sixpack.draw(d);minimap.draw(w);
  $("phase").textContent=w.objective.phase;$("phase").className=w.objective.phase;$("apMode").textContent=pilot==="AUTOPILOT"?latest!.autopilotMode??"":sentIntent;
  $("camLabel").textContent=rig.mode;$("scenario").textContent=`${latest!.scenarioId??"—"}`;$("simTime").textContent=`${(Number(w.tick)/120).toFixed(1)} s`;
  const c=latest!.controls;
  $("readout").innerHTML=[["IAS",`${d.speedKt.toFixed(0)} kt`],["ALT",`${d.altFt.toFixed(0)} ft`],["V/S",`${d.vsFpm>=0?"+":""}${d.vsFpm.toFixed(0)} fpm`],["HDG",`${d.headingDeg.toFixed(0).padStart(3,"0")}°`],["THR",`${Math.round((c?.throttle??0)*100)} %`],["FPS",String(fps)],["SIM",`×${measuredRate.toFixed(2)}`],["CHK",(sim.checksum??"—").slice(0,10)]].map(([k,v])=>`<span class="k">${k}</span>${v}`).join("<br>");
 }
 renderer.render(scene,rig.camera);
 frames++;const now=performance.now();if(now-fpsClock>1000){fps=Math.round(frames*1000/(now-fpsClock));measuredRate=stepTicks/120/((now-stepClock)/1000);frames=0;fpsClock=now;stepTicks=0;stepClock=now;$("rate").textContent=`×${rate}`;adaptQuality()}
}
// Adaptive quality: after 3 consecutive slow seconds drop shadows, then resolution, so slow GPUs stay usable.
let slowSeconds=0,degraded=0;
function adaptQuality(){if(fps>=24||document.hidden){slowSeconds=0;return}if(++slowSeconds<3||degraded>=2)return;slowSeconds=0;degraded++;
 if(degraded===1&&renderer.shadowMap.enabled){renderer.shadowMap.enabled=false;scene.traverse(o=>{const m=(o as THREE.Mesh).material as THREE.Material|undefined;if(m)m.needsUpdate=true});toast("Low frame rate — shadows disabled")}
 else{renderer.setPixelRatio(Math.max(.75,renderer.getPixelRatio()*.6));resize();toast("Low frame rate — render resolution reduced")}}
frame();
// Read-only hook for automated QA and debugging.
(globalThis as any).flightSim={get world(){return latest?.world},get pilot(){return pilot},get camera(){return rig.mode},get fps(){return fps},get paused(){return paused},get checksum(){return sim.checksum}};
