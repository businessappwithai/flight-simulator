import {expect,test} from "bun:test";
import type * as ThreeTypes from "../apps/simulator/node_modules/@types/three";
// three resolves only from apps/simulator: load the very module the simulator uses (its types come from the line above).
// @ts-ignore -- plain JS module without a declaration file
import * as ThreeModule from "../apps/simulator/node_modules/three/build/three.module.js";
const THREE=ThreeModule as typeof ThreeTypes;
import {TerrainProbe} from "../apps/simulator/src/terrain-probe.ts";
import {CameraRig} from "../apps/simulator/src/cameras.ts";

/** A hill: a 200 m plateau 2 km across standing on a plane at 0, and a 60 m block (a building). */
function world(){
 const root=new THREE.Group();
 const plane=new THREE.Mesh(new THREE.PlaneGeometry(20000,20000,4,4).rotateX(-Math.PI/2));root.add(plane);
 const hill=new THREE.Mesh(new THREE.BoxGeometry(2000,200,2000));hill.position.set(0,100,3000);root.add(hill);
 const block=new THREE.Mesh(new THREE.BoxGeometry(40,60,40));block.position.set(500,30,-500);root.add(block);
 root.updateMatrixWorld(true);return root;
}
const dom={addEventListener(){},removeEventListener(){},style:{},ownerDocument:{addEventListener(){},removeEventListener(){}},getRootNode(){return this}} as unknown as HTMLElement;

test("the probe answers ground height and line of sight from BVH ray queries",()=>{
 const p=new TerrainProbe(),w=world();p.add(w);
 expect(p.heightAt(0,3000)).toBeCloseTo(200,3);expect(p.heightAt(500,-500)).toBeCloseTo(60,3);expect(p.heightAt(-4000,0)).toBeCloseTo(0,3);
 expect(p.heightAt(50000,0)).toBeNull();
 const hit=p.firstHit(new THREE.Vector3(0,100,1000),new THREE.Vector3(0,100,5000))!;expect(hit.z).toBeCloseTo(2000,3);
 expect(p.firstHit(new THREE.Vector3(0,300,1000),new THREE.Vector3(0,300,5000))).toBeNull();
 p.remove(w);expect(p.size).toBe(0);expect(p.heightAt(0,3000)).toBeNull();
});

test("the chase camera stays above the ground and in front of anything hiding the aircraft",()=>{
 const probe=new TerrainProbe();probe.add(world());
 const cam=new THREE.PerspectiveCamera(60,1,.5,1e6),rig=new CameraRig(cam,dom);rig.probe=probe;
 const aircraft=new THREE.Object3D(),eye=new THREE.Object3D();aircraft.add(eye);
 // Flying low towards +z just past the hill: the camera 24 m behind would be inside the hill's far face.
 aircraft.position.set(0,205,4010);aircraft.rotation.set(0,0,0,"YXZ");aircraft.updateMatrixWorld(true);
 rig.set("CHASE",aircraft);rig.update(aircraft,eye,.016);
 expect(cam.position.y).toBeGreaterThanOrEqual(200+1.2-1e-6);
 // Nothing between the aircraft and the camera.
 expect(probe.firstHit(aircraft.position,cam.position)).toBeNull();
 // Low behind a building: the camera moves in front of it rather than showing the wall.
 aircraft.position.set(500,40,-470);aircraft.updateMatrixWorld(true);rig.set("CHASE",aircraft);rig.update(aircraft,eye,.016);
 expect(probe.firstHit(aircraft.position,cam.position)).toBeNull();expect(cam.position.z).toBeGreaterThan(-480);
 rig.dispose();
});
