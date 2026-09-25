import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";
import {sceneryHeight,toThree} from "./scenery.ts";
import {EXTERIOR_LAYER} from "./aircraft-model.ts";
export const CAMERA_MODES=["CHASE","COCKPIT","ORBIT","TOWER"] as const;
export type CameraMode=typeof CAMERA_MODES[number];
/** Chase, cockpit, free orbit and tower views, switched like the default views in desktop flight simulators. */
export class CameraRig{
 readonly orbit:OrbitControls;mode:CameraMode="CHASE";
 #chasePos=new THREE.Vector3();#lookAt=new THREE.Vector3();#initialised=false;
 #tower=toThree(-138,34,-30); // on the cab balcony, outside the tower geometry
 /** Drives the given camera (in R3F: the Canvas default camera). */
 constructor(readonly camera:THREE.PerspectiveCamera,dom:HTMLElement){this.camera.layers.enable(EXTERIOR_LAYER);this.orbit=new OrbitControls(this.camera,dom);this.orbit.enabled=false;this.orbit.enableDamping=true;this.orbit.minDistance=12;this.orbit.maxDistance=900}
 set(mode:CameraMode,aircraft:THREE.Object3D){
  this.mode=mode;this.orbit.enabled=mode==="ORBIT";
  if(mode==="ORBIT"){const off=new THREE.Vector3(-30,12,-38).applyQuaternion(aircraft.quaternion);this.camera.position.copy(aircraft.position).add(off);this.orbit.target.copy(aircraft.position);this.orbit.update()}
  if(mode==="COCKPIT")this.camera.layers.disable(EXTERIOR_LAYER);else this.camera.layers.enable(EXTERIOR_LAYER);
  this.camera.fov=mode==="COCKPIT"?72:mode==="TOWER"?35:60;this.camera.updateProjectionMatrix();this.#initialised=false;
 }
 next(aircraft:THREE.Object3D){this.set(CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode)+1)%CAMERA_MODES.length]!,aircraft)}
 dispose(){this.orbit.dispose()}
 update(aircraft:THREE.Object3D,eye:THREE.Object3D,dt:number){
  const k=1-Math.exp(-dt*4.5);
  if(this.mode==="CHASE"){
   // Follow behind and above in the aircraft's yaw frame (not its roll) so the horizon stays readable.
   const yaw=new THREE.Euler(0,aircraft.rotation.y,0,"YXZ"),behind=new THREE.Vector3(0,6.5,-24).applyEuler(yaw);
   const want=aircraft.position.clone().add(behind),look=aircraft.position.clone().add(new THREE.Vector3(0,2,30).applyEuler(yaw));
   if(!this.#initialised){this.#chasePos.copy(want);this.#lookAt.copy(look);this.#initialised=true}
   this.#chasePos.lerp(want,k);this.#lookAt.lerp(look,Math.min(1,k*1.5));
   // Never let smoothing lose the aircraft (slow frames, time acceleration): cap the lag.
   if(this.#chasePos.distanceTo(want)>18)this.#chasePos.sub(want).setLength(18).add(want);if(this.#lookAt.distanceTo(look)>12)this.#lookAt.sub(look).setLength(12).add(look);
   this.#chasePos.y=Math.max(this.#chasePos.y,sceneryHeight(-this.#chasePos.x,this.#chasePos.z)+1.2);
   this.camera.position.copy(this.#chasePos);this.camera.up.set(0,1,0);this.camera.lookAt(this.#lookAt);
  }else if(this.mode==="COCKPIT"){
   eye.getWorldPosition(this.camera.position);const q=new THREE.Quaternion();aircraft.getWorldQuaternion(q);
   this.camera.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-.06,Math.PI,0)));
  }else if(this.mode==="ORBIT"){
   const delta=aircraft.position.clone().sub(this.orbit.target);this.orbit.target.add(delta);this.camera.position.add(delta);this.orbit.update();
  }else{this.camera.position.copy(this.#tower);this.camera.up.set(0,1,0);this.camera.lookAt(aircraft.position);
   const d=this.camera.position.distanceTo(aircraft.position);this.camera.fov=THREE.MathUtils.clamp(2*Math.atan(40/Math.max(d,1))*180/Math.PI,4,50);this.camera.updateProjectionMatrix()}
 }
}
