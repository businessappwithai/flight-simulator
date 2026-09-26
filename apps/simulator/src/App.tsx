import {Component,useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {Canvas} from "@react-three/fiber";
import * as THREE from "three";
import type {EntityState,PilotIntent,SimPilot} from "@flight/protocol";
import {RATES,type SimStore,type ScenarioKind} from "./sim-store.ts";
import {Aircraft,CameraController,Entities,QualityGovernor,Scenery,SimulationDriver,Trail} from "./scene.tsx";
import {createAircraft} from "./aircraft-model.ts";
import {CAMERA_MODES,type CameraMode} from "./cameras.ts";
import type {Scenery as SceneryHandle} from "./scenery.ts";
import {AiPanel,Banner,ErrorBox,Help,Instruments,MovingMap,Readout,StartPanel,TopBar,TouchPad,useHud,LEARNING_LAB_URL} from "./hud.tsx";
// URL options (also used by automated QA): ?seed=7&scenario=seeded&pilot=manual&camera=cockpit&rate=2&quality=low&hud=0
export interface AppOptions{seed:bigint;scenario:ScenarioKind;pilot:SimPilot;rate:number;camera:CameraMode;quality:"high"|"low";hud:boolean}
export function parseOptions(search:string):AppOptions{
 const p=new URLSearchParams(search),seed=p.get("seed"),cam=(p.get("camera")??"").toUpperCase() as CameraMode,rate=Number(p.get("rate"));
 return {seed:seed&&/^\d{1,19}$/.test(seed)?BigInt(seed):1n,scenario:p.get("scenario")==="seeded"?"seeded":"default",pilot:p.get("pilot")?.toUpperCase()==="MANUAL"?"MANUAL":"AUTOPILOT",
  rate:(RATES as readonly number[]).includes(rate)?rate:1,camera:CAMERA_MODES.includes(cam)?cam:"CHASE",quality:p.get("quality")==="low"?"low":"high",hud:p.get("hud")!=="0"};
}
const KEYMAP:Record<string,PilotIntent>={KeyW:"CLIMB",ArrowUp:"CLIMB",KeyS:"DESCEND",ArrowDown:"DESCEND",ArrowLeft:"TURN_LEFT",KeyQ:"TURN_LEFT",ArrowRight:"TURN_RIGHT",KeyE:"TURN_RIGHT",ShiftLeft:"SLOW",ShiftRight:"SLOW",KeyX:"ABORT"};
class RenderBoundary extends Component<{children:ReactNode;onError:(m:string)=>void},{failed:boolean}>{
 override state={failed:false};static getDerivedStateFromError(){return {failed:true}}
 override componentDidCatch(e:Error){this.props.onError(`3D view failed: ${e.message}`)}
 override render(){return this.state.failed?<div className="fallback">The 3D view could not start. The simulation keeps running; reload to retry.</div>:this.props.children}
}
/** `store` is created outside React (main.tsx) so StrictMode's double mount cannot tear down the worker. */
export function App({options,store}:{options:AppOptions;store:SimStore}){
 const hud=useHud(store),model=useMemo(createAircraft,[]),scenery=useRef<SceneryHandle|null>(null);
 const [camera,setCamera]=useState<CameraMode>(options.camera),[panel,setPanel]=useState(true),[help,setHelp]=useState(false);
 // Open on arrival when there is no Jev key yet, so the key box is the first thing offered.
 const [ai,setAi]=useState(()=>!store.jevKey);
 const onScenery=useCallback((s:SceneryHandle)=>{scenery.current=s},[]);
 const nextCamera=useCallback(()=>setCamera(c=>CAMERA_MODES[(CAMERA_MODES.indexOf(c)+1)%CAMERA_MODES.length]!),[]);
 // Entities are mounted once per scenario (ids/kinds/radii); their motion comes from snapshots each frame.
 const entityKey=hud.world?.entities.map(e=>`${e.id}:${e.kind}:${e.radius}`).join("|")??"";
 const entities=useMemo<readonly EntityState[]>(()=>hud.world?.entities??[],[entityKey]); // eslint-disable-line react-hooks/exhaustive-deps
 // Keep the URL shareable: it always reproduces the scenario on screen.
 useEffect(()=>{const u=new URL(location.href);u.searchParams.set("seed",String(store.seed));u.searchParams.set("scenario",store.scenario);history.replaceState(null,"",u)},[store,hud.scenarioId]);
 useEffect(()=>{
  const held:PilotIntent[]=[];const sync=()=>store.setIntent(held.at(-1)??"HOLD");
  // Typing in a field (the Jev key box) must not fly the aircraft or trigger shortcuts.
  const typing=(e:KeyboardEvent)=>e.target instanceof HTMLElement&&(e.target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
  const down=(e:KeyboardEvent)=>{if(typing(e))return;const i=KEYMAP[e.code];if(i){e.preventDefault();if(!e.repeat){if(store.pilot==="AUTOPILOT")store.setPilot("MANUAL",true);if(!held.includes(i))held.push(i);sync()}return}
   if(e.repeat||e.metaKey||e.ctrlKey||e.altKey)return;
   switch(e.code){case "KeyA":store.setPilot(store.pilot==="AUTOPILOT"?"MANUAL":"AUTOPILOT",true);break;case "KeyC":nextCamera();break;
    case "Digit1":case "Digit2":case "Digit3":case "Digit4":setCamera(CAMERA_MODES[Number(e.code.slice(-1))-1]!);break;
    case "KeyP":case "Space":e.preventDefault();store.togglePause();break;case "KeyR":store.restart();break;case "KeyN":store.restart(true);break;
    case "KeyI":setPanel(v=>!v);break;case "KeyH":setHelp(v=>!v);break;case "KeyL":window.open(LEARNING_LAB_URL,"_blank","noopener");break;case "Escape":setHelp(false);break;
    case "Equal":case "NumpadAdd":store.changeRate(1);break;case "Minus":case "NumpadSubtract":store.changeRate(-1);break}};
  const up=(e:KeyboardEvent)=>{const i=KEYMAP[e.code];if(!i)return;const k=held.indexOf(i);if(k>=0)held.splice(k,1);sync()};
  const blur=()=>{held.length=0;sync()};
  window.addEventListener("keydown",down);window.addEventListener("keyup",up);window.addEventListener("blur",blur);
  return()=>{window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);window.removeEventListener("blur",blur)};
 },[store,nextCamera]);
 // Read-only hook for automated QA and debugging.
 useEffect(()=>{(globalThis as any).flightSim={get world(){return store.latest?.world},get pilot(){return store.pilot},get camera(){return cameraRef.current},get fps(){return store.fps},get paused(){return store.paused},get checksum(){return store.client.checksum}}},[store]);
 const cameraRef=useRef(camera);cameraRef.current=camera;
 return <>
  <RenderBoundary onError={m=>store.showError(m,true)}>
   <Canvas className="view" shadows={options.quality==="high"} dpr={options.quality==="low"?1:[1,2]} camera={{fov:60,near:.3,far:60000}}
    gl={{antialias:true,powerPreference:"high-performance"}} aria-label="3D flight view"
    fallback={<div className="fallback">WebGL is not available, so the 3D view cannot start. Use a current Safari, Chrome, Edge or Firefox with hardware acceleration.</div>}
    onCreated={({gl})=>{gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=.62;gl.shadowMap.type=THREE.PCFSoftShadowMap;
     gl.domElement.addEventListener("webglcontextlost",e=>{e.preventDefault();store.showError("The graphics context was lost (GPU reset). Reload the page to continue.",true)})}}>
    <SimulationDriver store={store}/>
    <Scenery onReady={onScenery}/>
    <Aircraft store={store} model={model}/>
    <Entities store={store} entities={entities}/>
    <Trail store={store} model={model}/>
    <CameraController mode={camera} model={model} scenery={scenery}/>
    <QualityGovernor store={store} quality={options.quality}/>
   </Canvas>
  </RenderBoundary>
  <TopBar hud={hud} camera={camera} panel={panel} ai={ai} store={store} onCamera={nextCamera} onPanel={()=>setPanel(v=>!v)} onAi={()=>setAi(v=>!v)} onHelp={()=>setHelp(v=>!v)}/>
  {ai&&<AiPanel hud={hud} store={store} onClose={()=>setAi(false)}/>}
  <StartPanel hud={hud} store={store}/>
  <ErrorBox hud={hud}/><Banner hud={hud}/>
  {/* Parked on the runway the Start card offers the same action, and on phones the yoke would cover it. */}
  {hud.started&&<TouchPad store={store}/>}
  {options.hud&&<footer className="dock"><Readout hud={hud}/>{panel&&<Instruments store={store}/>}<MovingMap store={store}/></footer>}
  {help&&<Help onClose={()=>setHelp(false)}/>}
 </>;
}
