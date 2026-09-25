import * as THREE from "three";
import type {AircraftControls,WorldSnapshot} from "@flight/protocol";
import {createAircraft,type AircraftModel} from "./aircraft-model.ts";
import {toThree} from "./scenery.ts";
/** Mirrors simulation snapshots into the scene. Holds no simulation state of its own. */
export class WorldView{
 readonly aircraft:AircraftModel=createAircraft();
 readonly entities=new Map<string,THREE.Object3D>();
 static readonly TRAIL=900;
 readonly trail:THREE.Line;
 #trail:THREE.Vector3[]=[];#checkpointMat=new THREE.MeshStandardMaterial({color:0xffb020,emissive:0xff8a00,emissiveIntensity:1.4,roughness:.4});
 constructor(readonly scene:THREE.Scene){
  scene.add(this.aircraft.group);
  const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(new Float32Array(WorldView.TRAIL*3),3));geo.setDrawRange(0,0);
  this.trail=new THREE.Line(geo,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.55}));this.trail.frustumCulled=false;scene.add(this.trail);
 }
 #entity(id:string,kind:string,radius:number){
  let o=this.entities.get(id);if(o)return o;
  if(kind==="OBSTACLE"){ // hot-air balloon: envelope of the simulated collision radius plus basket
   o=new THREE.Group();const env=new THREE.Mesh(new THREE.SphereGeometry(radius,32,24),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.6,map:balloonTexture()}));env.scale.y=1.15;env.castShadow=true;o.add(env);
   const basket=new THREE.Mesh(new THREE.BoxGeometry(2.4,1.6,2.4),new THREE.MeshStandardMaterial({color:0x7a5a34,roughness:.9}));basket.position.y=-radius*1.15-4;basket.castShadow=true;o.add(basket);
   for(const [x,z] of [[1,1],[1,-1],[-1,1],[-1,-1]]){const l=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,4.6,4),new THREE.MeshBasicMaterial({color:0x333333}));l.position.set(x!*1.1,-radius*1.15-1.8,z!*1.1);o.add(l)}
  }else if(kind==="CHECKPOINT"){ // air-race gate the size of the simulated capture radius
   o=new THREE.Group();const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.9,12,64),this.#checkpointMat);o.add(ring);
   const beacon=new THREE.PointLight(0xffa020,3,120,2);o.add(beacon);o.userData.ring=ring;
  }else return undefined; // the runway entity is scenery
  this.entities.set(id,o);this.scene.add(o);return o;
 }
 sync(w:WorldSnapshot,controls:AircraftControls|undefined,dt:number,time:number){
  const a=w.aircraft,g=this.aircraft.group;
  g.position.copy(toThree(a.position.x,a.position.y+1.3,a.position.z)); // +1.3: wheels rest on the ground at y=0
  g.rotation.set(-a.pitch,-a.heading,a.roll,"YXZ");
  this.aircraft.update(controls,dt,time);
  for(const e of w.entities){const o=this.#entity(e.id,e.kind,e.radius);if(!o)continue;o.position.copy(toThree(e.position.x,e.position.y,e.position.z));
   if(e.kind==="CHECKPOINT"){o.rotation.y=time*.4;const reached=w.objective.checkpointReached;this.#checkpointMat.color.set(reached?0x30e070:0xffb020);this.#checkpointMat.emissive.set(reached?0x10a040:0xff8a00)}}
  const last=this.#trail.at(-1),p=g.position;
  if(!last||last.distanceToSquared(p)>9){this.#trail.push(p.clone());if(this.#trail.length>WorldView.TRAIL)this.#trail.shift();this.#writeTrail()}
 }
 resetTrail(){this.#trail=[];this.#writeTrail()}
 #writeTrail(){const attr=this.trail.geometry.getAttribute("position") as THREE.BufferAttribute;this.#trail.forEach((v,i)=>attr.setXYZ(i,v.x,v.y,v.z));attr.needsUpdate=true;this.trail.geometry.setDrawRange(0,this.#trail.length)}
}
function balloonTexture(){const c=document.createElement("canvas");c.width=512;c.height=256;const g=c.getContext("2d")!;
 const cols=["#e23b3b","#f5c518","#2c7be5","#f5f5f5","#e23b3b","#1fb57a","#f5c518","#2c7be5"];cols.forEach((col,i)=>{g.fillStyle=col;g.fillRect(i*64,0,64,256)});
 g.fillStyle="rgba(0,0,0,.18)";g.fillRect(0,230,512,26);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t}
