import {useEffect,useMemo,useRef} from "react";
import {useFrame,useThree} from "@react-three/fiber";
import * as THREE from "three";
import type {EntityState,WorldSnapshot} from "@flight/protocol";
import {buildScenery,toThree,type Scenery} from "./scenery.ts";
import {createAircraft,type AircraftModel} from "./aircraft-model.ts";
import {CameraRig,type CameraMode} from "./cameras.ts";
import type {SimStore} from "./sim-store.ts";
/*
 * React Three Fiber scene. Every component here renders protocol snapshots (`store.latest`) and nothing else:
 * no simulation, controller or AI code is reachable from the render tree (enforced by scripts/dependency-audit.ts).
 * Per-frame work happens in useFrame against refs, so React only re-renders on structural changes.
 */
export function SimulationDriver({store}:{store:SimStore}){
 useFrame((_,delta)=>store.frame(delta,document.hidden));return null;
}
export function Scenery({onReady}:{onReady:(s:Scenery)=>void}){
 const {scene,gl}=useThree();const root=useMemo(()=>new THREE.Group(),[]);
 useEffect(()=>{const s=buildScenery(root,scene,gl);onReady(s);return()=>s.dispose()},[root,scene,gl,onReady]);
 return <primitive object={root}/>;
}
export function Aircraft({store,model}:{store:SimStore;model:AircraftModel}){
 useFrame((state,delta)=>{const l=store.latest;if(!l)return;const a=l.world.aircraft,g=model.group;
  g.position.copy(toThree(a.position.x,a.position.y+1.3,a.position.z)); // +1.3 m: wheels rest on the ground at y=0
  g.rotation.set(-a.pitch,-a.heading,a.roll,"YXZ");model.update(l.controls,Math.min(delta,.1),state.clock.elapsedTime)});
 return <primitive object={model.group}/>;
}
function balloonTexture(){const c=document.createElement("canvas");c.width=512;c.height=256;const g=c.getContext("2d")!;
 ["#e23b3b","#f5c518","#2c7be5","#f5f5f5","#e23b3b","#1fb57a","#f5c518","#2c7be5"].forEach((col,i)=>{g.fillStyle=col;g.fillRect(i*64,0,64,256)});
 g.fillStyle="rgba(0,0,0,.18)";g.fillRect(0,230,512,26);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t}
/** Hot-air balloon whose envelope is the simulated collision sphere. */
function Balloon({entity,store}:{entity:EntityState;store:SimStore}){
 const ref=useRef<THREE.Group>(null);const map=useMemo(balloonTexture,[]);useEffect(()=>()=>map.dispose(),[map]);
 useFrame(()=>{const e=store.latest?.world.entities.find(x=>x.id===entity.id);if(e&&ref.current)ref.current.position.copy(toThree(e.position.x,e.position.y,e.position.z))});
 const r=entity.radius;
 return <group ref={ref}>
  <mesh castShadow scale={[1,1.15,1]}><sphereGeometry args={[r,32,24]}/><meshStandardMaterial map={map} roughness={.6}/></mesh>
  <mesh castShadow position={[0,-r*1.15-4,0]}><boxGeometry args={[2.4,1.6,2.4]}/><meshStandardMaterial color={0x7a5a34} roughness={.9}/></mesh>
  {[[1,1],[1,-1],[-1,1],[-1,-1]].map(([x,z])=><mesh key={`${x}${z}`} position={[x!*1.1,-r*1.15-1.8,z!*1.1]}><cylinderGeometry args={[.04,.04,4.6,4]}/><meshBasicMaterial color={0x333333}/></mesh>)}
 </group>;
}
/** Air-race gate the size of the simulated capture radius; turns green once passed. */
function Gate({entity,store}:{entity:EntityState;store:SimStore}){
 const ref=useRef<THREE.Group>(null),mat=useRef<THREE.MeshStandardMaterial>(null);
 useFrame(state=>{const w=store.latest?.world,e=w?.entities.find(x=>x.id===entity.id);if(!w||!e||!ref.current||!mat.current)return;
  ref.current.position.copy(toThree(e.position.x,e.position.y,e.position.z));ref.current.rotation.y=state.clock.elapsedTime*.4;
  const ok=w.objective.checkpointReached;mat.current.color.set(ok?0x30e070:0xffb020);mat.current.emissive.set(ok?0x10a040:0xff8a00)});
 return <group ref={ref}><mesh><torusGeometry args={[entity.radius,.9,12,64]}/><meshStandardMaterial ref={mat} color={0xffb020} emissive={0xff8a00} emissiveIntensity={1.4} roughness={.4}/></mesh><pointLight color={0xffa020} intensity={3} distance={120} decay={2}/></group>;
}
/** Entities are mounted per scenario (their ids/kinds/radii), then moved every frame from snapshots. */
export function Entities({store,entities}:{store:SimStore;entities:readonly EntityState[]}){
 return <>{entities.map(e=>e.kind==="OBSTACLE"?<Balloon key={e.id} entity={e} store={store}/>:e.kind==="CHECKPOINT"?<Gate key={e.id} entity={e} store={store}/>:null)}</>;
}
const TRAIL=900;
export function Trail({store,model}:{store:SimStore;model:AircraftModel}){
 const line=useMemo(()=>{const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(TRAIL*3),3));g.setDrawRange(0,0);const l=new THREE.Line(g,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.55}));l.frustumCulled=false;return l},[]);
 const pts=useRef<THREE.Vector3[]>([]);
 useEffect(()=>store.onReset(()=>{pts.current=[];line.geometry.setDrawRange(0,0)}),[store,line]);
 useEffect(()=>()=>{line.geometry.dispose();(line.material as THREE.Material).dispose()},[line]);
 useFrame(()=>{if(!store.latest)return;const p=model.group.position,last=pts.current.at(-1);if(last&&last.distanceToSquared(p)<=9)return;
  pts.current.push(p.clone());if(pts.current.length>TRAIL)pts.current.shift();const attr=line.geometry.getAttribute("position") as THREE.BufferAttribute;
  pts.current.forEach((v,i)=>attr.setXYZ(i,v.x,v.y,v.z));attr.needsUpdate=true;line.geometry.setDrawRange(0,pts.current.length)});
 return <primitive object={line}/>;
}
export function CameraController({mode,model,scenery}:{mode:CameraMode;model:AircraftModel;scenery:React.RefObject<Scenery|null>}){
 const {camera,gl}=useThree();const rig=useRef<CameraRig|null>(null);
 useEffect(()=>{const r=new CameraRig(camera as THREE.PerspectiveCamera,gl.domElement);rig.current=r;return()=>{r.dispose();rig.current=null}},[camera,gl]);
 useEffect(()=>{rig.current?.set(mode,model.group)},[mode,model,camera,gl]);
 useFrame((state,delta)=>{if(rig.current&&rig.current.mode!==mode)rig.current.set(mode,model.group);rig.current?.update(model.group,model.eye,Math.min(delta,.1));scenery.current?.update(model.group.position,state.clock.elapsedTime)});
 return null;
}
/** After 3 consecutive slow seconds: drop shadows, then resolution, so slower tablets and GPUs stay usable. */
export function QualityGovernor({store,quality}:{store:SimStore;quality:"high"|"low"}){
 const {gl,scene,setDpr}=useThree();const slow=useRef(0),level=useRef(0),last=useRef(performance.now());
 useEffect(()=>{if(quality==="low"){gl.shadowMap.enabled=false;setDpr(1)}},[quality,gl,setDpr]);
 useFrame(()=>{const now=performance.now();if(now-last.current<1000)return;last.current=now;
  if(store.fps>=24||document.hidden){slow.current=0;return}if(++slow.current<3||level.current>=2)return;slow.current=0;level.current++;
  if(level.current===1&&gl.shadowMap.enabled){gl.shadowMap.enabled=false;scene.traverse(o=>{const m=(o as THREE.Mesh).material as THREE.Material|undefined;if(m)m.needsUpdate=true});store.toast("Low frame rate — shadows disabled")}
  else{setDpr(Math.max(.75,gl.getPixelRatio()*.6));store.toast("Low frame rate — render resolution reduced")}});
 return null;
}
export type {WorldSnapshot};
