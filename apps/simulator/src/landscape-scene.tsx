import {useEffect,useMemo} from "react";
import {useFrame,useThree} from "@react-three/fiber";
import * as THREE from "three";
import {curvatureDrop,lensFov,revealLens,revealPoint,type LandscapeInfo,type TerrainPatch} from "@flight/protocol";
import type {SimStore} from "./sim-store.ts";
import type {TerrainProbe} from "./terrain-probe.ts";
import type {Scenery} from "./scenery.ts";
import {linearColors} from "./vertex-colors.ts";
import {TERRAIN_FEATURES,createGrowingMaterial,createTerrainMaterial,createTerrainUniforms} from "./terrain-material.ts";
import {createAtmosphere,type Atmosphere} from "./atmosphere.ts";
import type {RevealDirector} from "./reveal.ts";
/*
 * The simulated planet in the 3D view: LOD terrain patches from the worker (global chunks, L1 and L0 tiles) in the
 * shared terrain shader, the trees and city that come with them as instances, and the planet's sky, ocean, lakes and
 * limb. Every build stage reads the reveal director's state (a front radius, a level), so the same components show
 * the finished world in flight and the world being built during the reveal.
 */
const LEVEL={10:"G",12:"L1",14:"L0"} as const;
/** Exposure low over the land and the extra stops ramped in over the climb (measured: the continent reads as its brand colour from orbit). */
export const EXPOSURE={base:.75,climbStops:-.36};
const TREE_COLORS=[[0x2c4a24,0x3b5a2a,0x254020],[0x5d6b45,0x6f7a50,0x4f5c3c],[0x7c9a3a,0x92a848,0x6d8c34]] as const;
export function LandscapeWorld({store,probe,scenery,director,quality}:{store:SimStore;probe:TerrainProbe;scenery:React.RefObject<Scenery|null>;director:RevealDirector;quality:"high"|"low"}){
 const {scene,gl,camera}=useThree();
 const group=useMemo(()=>new THREE.Group(),[]);
 const uniforms=useMemo(createTerrainUniforms,[]);
 const cuts=useMemo(()=>({l1:{value:new THREE.Vector4(1,1,0,0)},l0:{value:new THREE.Vector4(1,1,0,0)}}),[]);
 const grow=useMemo(()=>({forest:{value:1e9},city:{value:1e9},origin:uniforms.uOrigin,cityOrigin:{value:new THREE.Vector2()},treeFar:{value:9000},cityFar:{value:60_000}}),[uniforms]);
 const mats=useMemo(()=>{uniforms.uFeatures.value=TERRAIN_FEATURES.PLANET;return{
  G:createTerrainMaterial({uniforms,river:[8.7,9.5],cut:cuts.l1}),L1:createTerrainMaterial({uniforms,river:[7.25,7.75],cut:cuts.l0}),L0:createTerrainMaterial({uniforms,river:[6.2,6.7]}),
  tree:[0,1,2].map(k=>(lv:"L1"|"L0")=>createGrowingMaterial(new THREE.MeshStandardMaterial({roughness:.9,flatShading:k===1}),{front:grow.forest,origin:grow.origin,far:grow.treeFar,...(lv==="L1"?{cut:cuts.l0}:{})})),
  building:(lv:"L1"|"L0")=>createGrowingMaterial(new THREE.MeshStandardMaterial({roughness:.55,metalness:.15}),{front:grow.city,origin:grow.cityOrigin,far:grow.cityFar,vertical:true,ramp:500,...(lv==="L1"?{cut:cuts.l0}:{})})}},[uniforms,cuts,grow]);
 const geoms=useMemo(()=>({tree:[new THREE.ConeGeometry(.3,1,6).translate(0,.5,0),new THREE.IcosahedronGeometry(.5,0).translate(0,.42,0),new THREE.IcosahedronGeometry(.5,1).translate(0,.55,0)] as THREE.BufferGeometry[],
  box:new THREE.BoxGeometry(1,1,1).translate(0,.5,0)}),[]);
 const atmRef=useMemo(()=>({current:undefined as Atmosphere|undefined}),[]);
 // ---- Patches → meshes (+ their trees and buildings)
 useEffect(()=>{
  const objs=new Map<string,{root:THREE.Group;mesh:THREE.Mesh;mats:THREE.Material[]}>(),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3(),p=new THREE.Vector3(),col=new THREE.Color(),up=new THREE.Vector3(0,1,0);
  const drop=(k:string)=>{const o=objs.get(k);if(!o)return;probe.remove(o.mesh);group.remove(o.root);o.root.traverse(x=>{const m=x as THREE.Mesh;if(m.geometry&&!geoms.tree.includes(m.geometry)&&m.geometry!==geoms.box)m.geometry.dispose()});for(const m of o.mats)m.dispose();objs.delete(k)};
  const add=(pt:TerrainPatch)=>{drop(pt.key);const level=LEVEL[pt.z as 10|12|14]??"G",root=new THREE.Group(),own:THREE.Material[]=[];root.name=`planet:${pt.key}`;
   const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(pt.positions,3));g.setAttribute("color",new THREE.BufferAttribute(linearColors(pt.colors),3));
   if(pt.attrs)g.setAttribute("attrs",new THREE.BufferAttribute(pt.attrs,2));g.setIndex(new THREE.BufferAttribute(pt.indices,1));g.computeVertexNormals();g.computeBoundingSphere();
   const mesh=new THREE.Mesh(g,mats[level]);mesh.position.set(pt.center[0],pt.center[1],pt.center[2]);mesh.receiveShadow=level==="L0";mesh.name=`terrain:${pt.key}`;root.add(mesh);
   if(level!=="G"&&pt.trees?.length){
    const n=pt.trees.length/5,keep=quality==="low"?6:1,byKind:number[][]=[[],[],[]];
    for(let i=0;i<n;i+=keep)byKind[pt.trees[i*5+4]!|0]!.push(i);
    byKind.forEach((list,kind)=>{if(!list.length)return;const mat=mats.tree[kind]!(level);own.push(mat);const inst=new THREE.InstancedMesh(geoms.tree[kind]!,mat,list.length);
     list.forEach((i,j)=>{const h=pt.trees![i*5+3]!,r=Math.sin(i*12.9898)*43758.5453,f=r-Math.floor(r);
      q.setFromAxisAngle(up,f*6.28);s.set(h*(kind===0?.9+.3*f:1),h,h*(kind===0?.9+.3*f:1));p.set(pt.trees![i*5]!,pt.trees![i*5+1]!-.4,pt.trees![i*5+2]!);
      inst.setMatrixAt(j,m4.compose(p,q,s));inst.setColorAt(j,col.setHex(TREE_COLORS[kind]![Math.floor(f*3)]!))});
     inst.frustumCulled=false;inst.castShadow=level==="L0";root.add(inst)})}
   if(pt.buildings?.length){const n=pt.buildings.length/6,mat=mats.building(level==="L0"?"L0":"L1");own.push(mat);const inst=new THREE.InstancedMesh(geoms.box,mat,n);
    for(let i=0;i<n;i++){const b=pt.buildings.subarray(i*6,i*6+6),f=(Math.sin(i*78.233+b[0]!)*43758.5453)%1;q.identity();s.set(b[3]!,b[5]!+20,b[4]!);p.set(b[0]!,b[1]!-20,b[2]!);
     inst.setMatrixAt(i,m4.compose(p,q,s));inst.setColorAt(i,col.setHex(Math.abs(f)<.4?0xcfc6b4:Math.abs(f)<.75?0x8fa3b4:0xe8e4dc))}
    inst.frustumCulled=false;inst.castShadow=true;root.add(inst)}
   group.add(root);objs.set(pt.key,{root,mesh,mats:own});
   // The finer levels keep the camera out of the ground (as real-world terrain does).
   if(pt.z>=12){mesh.updateMatrixWorld();probe.add(mesh)}};
  for(const pt of store.terrain.values())add(pt);
  const off=store.onTerrain(d=>{if(d.clear)for(const k of [...objs.keys()])drop(k);for(const k of d.remove)drop(k);for(const pt of d.add)add(pt)});
  return()=>{off();for(const k of [...objs.keys()])drop(k)};
 },[store,group,mats,geoms,probe,quality]);
 // ---- Sky, ocean, lakes, limb (once the planet's constants arrive)
 useEffect(()=>{
  let atm:Atmosphere|undefined;
  const build=(info:LandscapeInfo|undefined)=>{if(atm){group.remove(atm.group);atm.dispose();atm=undefined}
   if(!info||!scenery.current)return;atm=createAtmosphere(info,scenery.current.sunDirection);group.add(atm.group);
   uniforms.uPad.value=info.padElevationM;uniforms.uRadius.value=info.planetRadiusM;uniforms.uOrigin.value.set(info.buildOrigin[0],info.buildOrigin[1]);grow.cityOrigin.value.set(info.city[0],info.city[1]);
   atmRef.current=atm};
  build(store.landscape);const off=store.onLandscape(build);
  return()=>{off();build(undefined);atmRef.current=undefined};
 },[store,group,scenery,uniforms,grow]);
 // ---- Tone mapping, haze and the per-frame build state
 useEffect(()=>{const prev={tm:gl.toneMapping,exp:gl.toneMappingExposure,fog:scene.fog};gl.toneMapping=THREE.NeutralToneMapping;
  const fog=new THREE.FogExp2(0x9fb2c6,1.5e-5);scene.fog=fog;
  return()=>{gl.toneMapping=prev.tm;gl.toneMappingExposure=prev.exp;scene.fog=prev.fog}},[gl,scene]);
 useFrame((state)=>{
  const r=director.state(),a=atmRef.current,l=store.latest?.landscape,inset=(b:number[]|undefined,d:number,v:THREE.Vector4)=>b?v.set(b[0]!+d,b[1]!+d,b[2]!-d,b[3]!-d):v.set(1,1,0,0);
  inset(l?.rings.l1,150,cuts.l1.value);inset(l?.rings.l0,30,cuts.l0.value);
  uniforms.uClayR.value=r.clayR;uniforms.uPbrR.value=r.pbrR;uniforms.uRiverReveal.value=r.riverLog;uniforms.uWater.value=r.water;uniforms.uTime.value=state.clock.elapsedTime;
  grow.forest.value=r.forestR;grow.city.value=r.cityR;
  const at=a?.update(camera,{water:r.water,eyes:r.eyes,time:state.clock.elapsedTime});
  const alt=at?.altitude??0;
  uniforms.uOrbit.value=THREE.MathUtils.smoothstep(alt,12_000,30_000);
  grow.treeFar.value=alt>15_000?0:9000;
  if(scene.fog instanceof THREE.FogExp2)scene.fog.density=at?.fogDensity??1.5e-5;
  // +0.62 stop over the climb, hidden by the camera move.
  gl.toneMappingExposure=EXPOSURE.base*Math.pow(2,EXPOSURE.climbStops*Math.max(r.climb,THREE.MathUtils.smoothstep(alt,14_000,40_000)));
 });
 useEffect(()=>()=>{for(const m of [mats.G,mats.L1,mats.L0])m.dispose();for(const g of geoms.tree)g.dispose();geoms.box.dispose()},[mats,geoms]);
 return <primitive object={group}/>;
}
/** Flies the reveal shot: the planned camera and look-at paths, the lens, and terrain streamed around the camera. */
export function RevealCamera({store,director}:{store:SimStore;director:RevealDirector}){
 const {camera,size}=useThree();const last=useMemo(()=>({t:0,focus:false}),[]);
 useEffect(()=>director.onChange(p=>{if(p)return;if(last.focus){store.focus(null);last.focus=false}const c=camera as THREE.PerspectiveCamera;c.near=.5;c.far=4e6;c.updateProjectionMatrix()}),[director,store,last,camera]);
 useFrame(()=>{
  const info=store.landscape,t=director.time();if(!info||!Number.isFinite(t))return;
  const c=camera as THREE.PerspectiveCamera,pos=revealPoint(info.camera,t),tgt=revealPoint(info.target,t),P=info.padElevationM;
  c.position.set(pos.x,pos.alt-P-curvatureDrop(pos.x,pos.z),pos.z);c.up.set(0,1,0);c.lookAt(tgt.x,tgt.alt-P-curvatureDrop(tgt.x,tgt.z),tgt.z);
  c.fov=lensFov(revealLens(t),size.width/Math.max(1,size.height));c.near=pos.alt>20_000?40:pos.alt>4000?4:.5;c.far=4e6;c.updateProjectionMatrix();
  const now=performance.now();if(now-last.t>200){last.t=now;last.focus=true;store.focus({x:pos.x,z:pos.z,alt:pos.alt})}
 });
 return null;
}
