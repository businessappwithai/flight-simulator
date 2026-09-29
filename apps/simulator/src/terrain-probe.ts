import * as THREE from "three";
import {acceleratedRaycast,computeBoundsTree,disposeBoundsTree} from "three-mesh-bvh";
/*
 * Fast ray queries against the streamed world (terrain patches, buildings, the airfield) for the camera: a BVH per
 * mesh (three-mesh-bvh) makes a downward ray or a line-of-sight test cost microseconds, so every frame can keep the
 * camera above the ground and out of hillsides and buildings. Presentation only: physics never reads this.
 */
THREE.BufferGeometry.prototype.computeBoundsTree=computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree=disposeBoundsTree;
THREE.Mesh.prototype.raycast=acceleratedRaycast;
const DOWN=new THREE.Vector3(0,-1,0);
export class TerrainProbe{
 readonly #roots=new Set<THREE.Object3D>();
 readonly #ray=new THREE.Raycaster();
 readonly #from=new THREE.Vector3();readonly #dir=new THREE.Vector3();
 constructor(){this.#ray.firstHitOnly=true}
 /** Starts answering queries against `root` (a terrain patch, a feature tile, the airfield) and builds its BVHs. */
 add(root:THREE.Object3D){
  root.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh&&!(o as THREE.InstancedMesh).isInstancedMesh&&!m.geometry.boundsTree&&m.geometry.getAttribute("position"))m.geometry.computeBoundsTree()});
  this.#roots.add(root);
 }
 remove(root:THREE.Object3D){if(!this.#roots.delete(root))return;root.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh)m.geometry.disposeBoundsTree?.()})}
 get size(){return this.#roots.size}
 #cast(){const hits=this.#ray.intersectObjects([...this.#roots],true);return hits.find(h=>!(h.object as THREE.InstancedMesh).isInstancedMesh)}
 /** Height of the highest surface under (x, z), or null where nothing is loaded. */
 heightAt(x:number,z:number):number|null{this.#ray.set(this.#from.set(x,1e5,z),DOWN);this.#ray.far=2e5;const h=this.#cast();return h?h.point.y:null}
 /** The first surface between `from` and `to` (e.g. aircraft → camera), or null when the line of sight is clear. */
 firstHit(from:THREE.Vector3,to:THREE.Vector3):THREE.Vector3|null{
  const len=this.#dir.subVectors(to,from).length();if(len<1e-3)return null;
  this.#ray.set(from,this.#dir.divideScalar(len));this.#ray.far=len;const h=this.#cast();return h?h.point:null;
 }
}
