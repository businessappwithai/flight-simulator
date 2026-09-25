import * as THREE from "three";
import type { WorldSnapshot } from "@flight/protocol";
export class WorldView{
 readonly entities=new Map<string,THREE.Object3D>();
 constructor(readonly scene:THREE.Scene,readonly aircraft:THREE.Object3D){}
 sync(w:WorldSnapshot){
  this.aircraft.position.set(w.aircraft.position.x,w.aircraft.position.y,w.aircraft.position.z);
  this.aircraft.rotation.set(w.aircraft.pitch,w.aircraft.heading,-w.aircraft.roll);
  for(const e of w.entities){
   let obj=this.entities.get(e.id);
   if(!obj){obj=new THREE.Mesh(new THREE.SphereGeometry(e.radius,12,8),new THREE.MeshNormalMaterial({wireframe:true}));this.entities.set(e.id,obj);this.scene.add(obj)}
   obj.position.set(e.position.x,e.position.y,e.position.z);
  }
 }
}
