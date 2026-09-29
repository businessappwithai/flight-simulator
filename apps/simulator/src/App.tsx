import {Component,useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {Canvas} from "@react-three/fiber";
import * as THREE from "three";
import type {EntityState,PilotIntent,SimPilot} from "@flight/protocol";
import {RATES,jevUrlOption,type SimStore,type ScenarioKind} from "./sim-store.ts";
import {Aircraft,CameraController,Entities,GeoAirports,GeoFeatures,GeoRoute,GeoTerrain,QualityGovernor,Scenery,SimulationDriver,Tiles3D,Trail,ViewDistance} from "./scene.tsx";
import {TerrainProbe} from "./terrain-probe.ts";
import {createAircraft} from "./aircraft-model.ts";
import {CAMERA_MODES,type CameraMode} from "./cameras.ts";
import type {Scenery as SceneryHandle} from "./scenery.ts";
import {AiPanel,Attribution,Banner,ErrorBox,GeoBadge,Help,Instruments,MovingMap,Readout,StartPanel,TopBar,TouchPad,useHud,LEARNING_LAB_URL} from "./hud.tsx";
// URL options (also used by automated QA): ?seed=7&scenario=seeded&pilot=manual&camera=cockpit&rate=2&quality=low&hud=0
// Real world: &airport=VOMM&runway=07 (and &terrain=<Terrarium URL template with {z}/{x}/{y}> to use another tile server).
// Cross-country: &to=VOBL (&toRunway=09L): a flight plan to that runway.
// 3D Tiles over the real world: &tiles3d=<tileset.json URL>, or a Google Maps API key for Photorealistic 3D Tiles (saved in
// the Jev & learning panel; &tiles3dKey=<key> in a link is saved once and removed from the address bar).
// &tiles3dOffset=<m> fixes their height (default: measured on the home runway).
// Self-hosted Jev for the autopilot: &jevUrl=http://localhost:<port> (localhost or this site only; see jevUrlOption).
export interface AppOptions{seed:bigint;scenario:ScenarioKind;pilot:SimPilot;rate:number;camera:CameraMode;quality:"high"|"low";hud:boolean;airport?:string;runway?:string;terrainUrl?:string;featuresUrl?:string;destination?:string;destinationRunway?:string;tiles3d?:{url?:string;offsetM?:number};tiles3dKey?:string;jevUrl?:string}
export function parseOptions(search:string):AppOptions{
 const p=new URLSearchParams(search),seed=p.get("seed"),cam=(p.get("camera")??"").toUpperCase() as CameraMode,rate=Number(p.get("rate"));
 return {seed:seed&&/^\d{1,19}$/.test(seed)?BigInt(seed):1n,scenario:p.get("scenario")==="seeded"?"seeded":"default",pilot:p.get("pilot")?.toUpperCase()==="MANUAL"?"MANUAL":"AUTOPILOT",
  rate:(RATES as readonly number[]).includes(rate)?rate:1,camera:CAMERA_MODES.includes(cam)?cam:"CHASE",quality:p.get("quality")==="low"?"low":"high",hud:p.get("hud")!=="0",
  ...(/^[A-Za-z0-9-]{2,8}$/.test(p.get("airport")??"")?{airport:p.get("airport")!.toUpperCase()}:{}),...(/^[0-9]{1,2}[LRCT]?$/i.test(p.get("runway")??"")?{runway:p.get("runway")!.toUpperCase()}:{}),
  ...(p.get("terrain")?{terrainUrl:p.get("terrain")!}:{}),...(p.get("features")?{featuresUrl:p.get("features")!}:{}),
  ...(/^[A-Za-z0-9-]{2,8}$/.test(p.get("to")??"")?{destination:p.get("to")!.toUpperCase()}:{}),...(/^[0-9]{1,2}[LRCT]?$/i.test(p.get("toRunway")??"")?{destinationRunway:p.get("toRunway")!.toUpperCase()}:{}),
  ...tiles3dOption(p),...(jevUrlOption(p.get("jevUrl"))?{jevUrl:jevUrlOption(p.get("jevUrl"))!}:{})};
}
function tiles3dOption(p:URLSearchParams):Pick<AppOptions,"tiles3d"|"tiles3dKey">{
 const url=p.get("tiles3d")??"",key=p.get("tiles3dKey")??"",off=p.get("tiles3dOffset"),offsetM=off!==null&&Number.isFinite(Number(off))?Number(off):undefined;
 return {...(url&&/^(https?:\/\/|\/|\.)/.test(url)?{tiles3d:{url,...(offsetM!==undefined?{offsetM}:{})}}:offsetM!==undefined?{tiles3d:{offsetM}}:{}),...(key?{tiles3dKey:key}:{})};
}
const KEYMAP:Record<string,PilotIntent>={KeyW:"CLIMB",ArrowUp:"CLIMB",KeyS:"DESCEND",ArrowDown:"DESCEND",ArrowLeft:"TURN_LEFT",KeyQ:"TURN_LEFT",ArrowRight:"TURN_RIGHT",KeyE:"TURN_RIGHT",ShiftLeft:"SLOW",ShiftRight:"SLOW",KeyX:"ABORT"};
class RenderBoundary extends Component<{children:ReactNode;onError:(m:string)=>void},{failed:boolean}>{
 override state={failed:false};static getDerivedStateFromError(){return {failed:true}}
 override componentDidCatch(e:Error){this.props.onError(`3D view failed: ${e.message}`)}
 override render(){return this.state.failed?<div className="fallback">The 3D view could not start. The simulation keeps running; reload to retry.</div>:this.props.children}
}
/** `store` is created outside React (main.tsx) so StrictMode's double mount cannot tear down the worker. */
export function App({options,store}:{options:AppOptions;store:SimStore}){
 const hud=useHud(store),model=useMemo(createAircraft,[]),scenery=useRef<SceneryHandle|null>(null),probe=useMemo(()=>new TerrainProbe(),[]);
 const [camera,setCamera]=useState<CameraMode>(options.camera),[panel,setPanel]=useState(true),[help,setHelp]=useState(false);
 // Open on arrival when there is no Jev key yet, so the key box is the first thing offered.
 const [ai,setAi]=useState(()=>!store.jevKey);
 const onScenery=useCallback((s:SceneryHandle)=>{scenery.current=s},[]);
 // 3D Tiles attribution (Google requires its data credits on screen) and load errors.
 const [credits,setCredits]=useState<string[]>([]),onTilesError=useCallback((m:string)=>store.showError(m),[store]);
 // Google's photorealistic tiles are the ground itself: once they load, the streamed terrain and the procedural airfield step aside.
 const tilesStatus=useRef({models:0,liftM:0,aligned:false});
 const [photoreal,setPhotoreal]=useState(false),onTilesLoaded=useCallback((l:boolean)=>setPhotoreal(l&&!options.tiles3d?.url&&!!store.tiles3dKey),[store,options.tiles3d?.url]);
 useEffect(()=>{if(!hud.airport)setCredits([])},[hud.airport]);
 const nextCamera=useCallback(()=>setCamera(c=>CAMERA_MODES[(CAMERA_MODES.indexOf(c)+1)%CAMERA_MODES.length]!),[]);
 // Entities are mounted once per scenario (ids/kinds/radii); their motion comes from snapshots each frame.
 const entityKey=hud.world?.entities.map(e=>`${e.id}:${e.kind}:${e.radius}`).join("|")??"";
 const entities=useMemo<readonly EntityState[]>(()=>hud.world?.entities??[],[entityKey]); // eslint-disable-line react-hooks/exhaustive-deps
 // Keep the URL shareable: it always reproduces the scenario on screen.
 useEffect(()=>{const u=new URL(location.href);u.searchParams.set("seed",String(store.seed));u.searchParams.set("scenario",store.scenario);
  u.searchParams.delete("tiles3dKey"); // a key never stays in the address bar (it is kept in this browser instead)
  for(const [k,v] of [["airport",hud.airport],["runway",hud.runway],["to",hud.destination],["toRunway",hud.destinationRunway],["terrain",hud.terrainUrl],["features",hud.featuresUrl]] as const)v?u.searchParams.set(k,v):u.searchParams.delete(k);history.replaceState(null,"",u)},[store,hud.scenarioId,hud.airport,hud.runway,hud.destination,hud.destinationRunway,hud.terrainUrl,hud.featuresUrl]);
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
 useEffect(()=>{(globalThis as any).flightSim={get world(){return store.latest?.world},get pilot(){return store.pilot},get camera(){return cameraRef.current},get fps(){return store.fps},get paused(){return store.paused},get checksum(){return store.client.checksum},get geo(){return store.latest?.geo},get terrainTiles(){return store.terrain.size},get featurePatches(){return store.features.size},get tiles3d(){return {...tilesStatus.current}}}},[store]);
 const cameraRef=useRef(camera);cameraRef.current=camera;
 return <>
  <RenderBoundary onError={m=>store.showError(m,true)}>
   <Canvas className="view" shadows={options.quality==="high"} dpr={options.quality==="low"?1:[1,2]} camera={{fov:60,near:.3,far:60000}}
    gl={{antialias:true,powerPreference:"high-performance",logarithmicDepthBuffer:true}} aria-label="3D flight view"
    fallback={<div className="fallback">WebGL is not available, so the 3D view cannot start. Use a current Safari, Chrome, Edge or Firefox with hardware acceleration.</div>}
    onCreated={({gl})=>{gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=.62;gl.shadowMap.type=THREE.PCFSoftShadowMap;
     gl.domElement.addEventListener("webglcontextlost",e=>{e.preventDefault();store.showError("The graphics context was lost (GPU reset). Reload the page to continue.",true)})}}>
    <SimulationDriver store={store}/>
    <Scenery onReady={onScenery} geo={!!hud.airport} store={store} probe={probe} fieldHidden={photoreal&&!!hud.airport}/>
    <ViewDistance geo={!!hud.airport}/>
    <GeoTerrain store={store} probe={probe} hidden={photoreal&&!!hud.airport}/>
    <GeoFeatures store={store} probe={probe} hidden={photoreal&&!!hud.airport}/>
    {hud.geo&&<GeoAirports airports={hud.geo.airports} home={hud.geo.airport} destination={hud.geo.route?.destination}/>}
    {hud.geo?.route&&<GeoRoute path={hud.geo.route.path}/>}
    {hud.airport&&(options.tiles3d?.url||hud.tiles3dKeyHint)&&<Tiles3D key={options.tiles3d?.url??store.tiles3dKey} store={store} url={options.tiles3d?.url}
     googleKey={options.tiles3d?.url?undefined:store.tiles3dKey} offsetM={options.tiles3d?.offsetM} probe={probe} onCredits={setCredits} onError={onTilesError} onLoaded={onTilesLoaded} status={tilesStatus.current}/>}
    <Aircraft store={store} model={model}/>
    <Entities store={store} entities={entities}/>
    <Trail store={store} model={model}/>
    <CameraController mode={camera} model={model} scenery={scenery} probe={hud.airport?probe:undefined}/>
    <QualityGovernor store={store} quality={options.quality}/>
   </Canvas>
  </RenderBoundary>
  <TopBar hud={hud} camera={camera} panel={panel} ai={ai} store={store} onCamera={nextCamera} onPanel={()=>setPanel(v=>!v)} onAi={()=>setAi(v=>!v)} onHelp={()=>setHelp(v=>!v)}/>
  {ai&&<AiPanel hud={hud} store={store} onClose={()=>setAi(false)}/>}
  <StartPanel hud={hud} store={store}/>
  <ErrorBox hud={hud}/><Banner hud={hud}/>
  {hud.geo&&<GeoBadge geo={hud.geo}/>}{hud.geo&&<Attribution lines={[...hud.geo.attribution,...credits]}/>}
  {/* Parked on the runway the Start card offers the same action, and on phones the yoke would cover it. */}
  {hud.started&&<TouchPad store={store}/>}
  {options.hud&&<footer className="dock"><Readout hud={hud}/>{panel&&<Instruments store={store}/>}<MovingMap store={store}/></footer>}
  {help&&<Help onClose={()=>setHelp(false)}/>}
 </>;
}
