import * as THREE from "three";
import type {AircraftControls} from "@flight/protocol";
/**
 * Procedural high-wing light aircraft (Cessna 172 proportions), nose along +Z, up +Y, pilot's right wing at -X.
 * Control surfaces are pivoted at their hinge lines and follow the controls actually applied by the simulation.
 */
/** Render layer for the exterior skin, hidden from the cockpit camera (still casts shadows). */
export const EXTERIOR_LAYER=2;
export interface AircraftModel{group:THREE.Group;update(c:AircraftControls|undefined,dt:number,time:number):void;eye:THREE.Object3D}
const mat=(color:number,o:Partial<THREE.MeshStandardMaterialParameters>={})=>new THREE.MeshStandardMaterial({color,roughness:.38,metalness:.08,...o});
export function createAircraft():AircraftModel{
 const g=new THREE.Group();g.name="aircraft";
 const white=mat(0xf4f5f2),blue=mat(0x1d4f9c),dark=mat(0x23262b,{roughness:.6}),glass=mat(0x1b2733,{roughness:.05,metalness:.7,transparent:true,opacity:.82}),windshield=mat(0x9fc4e0,{roughness:.02,metalness:0,transparent:true,opacity:.12,depthWrite:false}),tyre=mat(0x111111,{roughness:.9}),metal=mat(0xb8bcc2,{metalness:.8,roughness:.3});
 const add=(m:THREE.Mesh,p:[number,number,number],parent:THREE.Object3D=g)=>{m.position.set(...p);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m};
 // Fuselage: lathe profile (radius, station) swept around the long axis.
 const profile=[[.02,4.3],[.42,4.0],[.62,3.4],[.72,2.4],[.74,1.0],[.66,-.8],[.46,-2.8],[.26,-4.4],[.08,-5.1]].map(([r,z])=>new THREE.Vector2(r!,z!));
 const fus=new THREE.LatheGeometry(profile,28);fus.rotateX(Math.PI/2);fus.scale(1,1.12,1);
 const exterior:THREE.Object3D[]=[];
 exterior.push(add(new THREE.Mesh(fus,white),[0,0,0]));
 const stripe=new THREE.LatheGeometry(profile.map(v=>new THREE.Vector2(v.x*1.004,v.y)).slice(3,7),28,0,Math.PI*2);stripe.rotateX(Math.PI/2);stripe.scale(1,.18,1);
 exterior.push(add(new THREE.Mesh(stripe,blue),[0,-.12,0]));
 // Cabin glass
 // Windshield: nearly clear so the cockpit camera sees out through it; tinted only at grazing angles.
 const wind=new THREE.PlaneGeometry(1.25,.8);const ws=add(new THREE.Mesh(wind,windshield),[0,.78,2.05]);ws.rotation.x=-.9;(ws.material as THREE.Material).side=THREE.DoubleSide;ws.castShadow=false;
 for(const s of [1,-1])exterior.push(add(new THREE.Mesh(new THREE.BoxGeometry(.04,.45,1.5),glass),[s*.7,.45,.9]));
 // Wing (high wing, slight dihedral per side) with struts
 const wingL=new THREE.Group(),wingR=new THREE.Group();g.add(wingL,wingR);
 for(const [w,s] of [[wingL,1],[wingR,-1]] as const){
  w.position.set(0,.86,.9);w.rotation.z=s*.035;
  add(new THREE.Mesh(new THREE.BoxGeometry(5.3,.13,1.55),white),[s*2.75,0,0],w);
  add(new THREE.Mesh(new THREE.BoxGeometry(.9,.135,1.56),blue),[s*5.0,0,0],w);
  add(new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,2.1,6),metal),[s*1.5,-.75,.1]).rotation.z=s*-.95;
 }
 // Ailerons hinge at the outer trailing edge (pilot left = +X)
 const aileron=(s:number)=>{const pivot=new THREE.Group();pivot.position.set(s*3.9,0,-.78);(s>0?wingL:wingR).add(pivot);add(new THREE.Mesh(new THREE.BoxGeometry(2,.07,.38),white),[0,0,-.19],pivot);return pivot};
 const aileronL=aileron(1),aileronR=aileron(-1);
 // Flaps (fixed, inboard)
 for(const s of [1,-1])add(new THREE.Mesh(new THREE.BoxGeometry(2.2,.06,.34),white),[s*1.6,-.02,-.93],s>0?wingL:wingR);
 // Empennage
 add(new THREE.Mesh(new THREE.BoxGeometry(3.6,.08,.85),white),[0,.18,-4.25]);
 const elevator=new THREE.Group();elevator.position.set(0,.18,-4.68);g.add(elevator);add(new THREE.Mesh(new THREE.BoxGeometry(3.6,.06,.45),white),[0,0,-.22],elevator);
 const fin=new THREE.Shape([new THREE.Vector2(0,0),new THREE.Vector2(1.45,0),new THREE.Vector2(.95,1.55),new THREE.Vector2(.25,1.55)]);
 const finGeo=new THREE.ExtrudeGeometry(fin,{depth:.08,bevelEnabled:false});finGeo.rotateY(Math.PI/2);finGeo.translate(-.04,.25,-3.3);
 add(new THREE.Mesh(finGeo,white),[0,0,0]);add(new THREE.Mesh(new THREE.BoxGeometry(.085,.55,.9),blue),[0,1.35,-4.35]);
 const rudder=new THREE.Group();rudder.position.set(0,.25,-4.72);g.add(rudder);add(new THREE.Mesh(new THREE.BoxGeometry(.06,1.5,.42),white),[0,.75,-.2],rudder);
 // Engine: cowling, spinner, two-blade prop and a translucent disc at speed
 exterior.push(add(new THREE.Mesh(new THREE.ConeGeometry(.22,.55,16).rotateX(Math.PI/2),metal),[0,0,4.55]));
 const prop=new THREE.Group();prop.position.set(0,0,4.42);g.add(prop);
 for(const s of [1,-1])add(new THREE.Mesh(new THREE.BoxGeometry(.16,.95,.05),dark),[0,s*.52,0],prop).rotation.y=s*.25;
 const disc=new THREE.Mesh(new THREE.CircleGeometry(1.05,32),new THREE.MeshBasicMaterial({color:0x222222,transparent:true,opacity:.12,depthWrite:false,side:THREE.DoubleSide}));disc.position.set(0,0,4.43);g.add(disc);
 // Fixed tricycle gear
 const wheel=new THREE.CylinderGeometry(.24,.24,.16,16).rotateZ(Math.PI/2);
 add(new THREE.Mesh(wheel,tyre),[0,-1.05,3.1]);add(new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.55,6),metal),[0,-.75,3.1]);
 for(const s of [1,-1]){add(new THREE.Mesh(wheel,tyre),[s*1.15,-1.05,.3]);add(new THREE.Mesh(new THREE.BoxGeometry(.9,.05,.12),metal),[s*.75,-.8,.3]).rotation.z=s*.5}
 // Navigation lights: red on the left (+X) tip, green on the right, white tail, red beacon, white strobes.
 const light=(c:number,p:[number,number,number])=>{const m=new THREE.Mesh(new THREE.SphereGeometry(.09,8,6),new THREE.MeshBasicMaterial({color:c}));m.position.set(...p);g.add(m);return m};
 light(0xff2020,[5.55,1.05,.9]);light(0x20ff40,[-5.55,1.05,.9]);light(0xffffff,[0,.3,-5.15]);
 const beacon=light(0xff3030,[0,1.85,-3.9]),strobes=[light(0xffffff,[5.6,1.05,.6]),light(0xffffff,[-5.6,1.05,.6])];
 // Cabin interior seen from the cockpit camera: instrument panel, glare shield, windshield posts, yoke.
 const cabin=mat(0x2b2f35,{roughness:.8});
 add(new THREE.Mesh(new THREE.BoxGeometry(1.3,.42,.12),cabin),[0,.22,2.05]);add(new THREE.Mesh(new THREE.BoxGeometry(1.34,.06,.35),mat(0x15171a,{roughness:.9})),[0,.45,1.95]);
 for(const s of [1,-1])add(new THREE.Mesh(new THREE.BoxGeometry(.06,.62,.06),cabin),[s*.62,.72,1.95]).rotation.x=-.45;
 add(new THREE.Mesh(new THREE.TorusGeometry(.13,.02,6,16,Math.PI),cabin),[.32,.05,1.7]);
 // Cabin side walls and floor, only meaningful from inside.
 const lining=mat(0x3a3f47,{roughness:.9,side:THREE.DoubleSide});
 for(const s of [1,-1])add(new THREE.Mesh(new THREE.PlaneGeometry(1.9,.55).rotateY(Math.PI/2),lining),[s*.69,.05,1.1]);
 add(new THREE.Mesh(new THREE.PlaneGeometry(1.3,2).rotateX(-Math.PI/2),lining),[0,-.35,1.1]);
 for(const o of exterior)o.layers.set(EXTERIOR_LAYER);
 const eye=new THREE.Object3D();eye.position.set(.32,.72,1.35);g.add(eye);
 const lerp=(a:number,b:number,k:number)=>a+(b-a)*k;let throttle=0,propAngle=0;
 return {group:g,eye,update(c,dt,time){
  const k=1-Math.exp(-dt*12),ai=c?.aileron??0,el=c?.elevator??0,ru=c?.rudder??0;
  // Right roll (+aileron): left (+X) aileron trailing edge down, right one up. +rotation.x raises a trailing edge.
  aileronL.rotation.x=lerp(aileronL.rotation.x,-ai*.35,k);aileronR.rotation.x=lerp(aileronR.rotation.x,ai*.35,k);
  elevator.rotation.x=lerp(elevator.rotation.x,el*.4,k);rudder.rotation.y=lerp(rudder.rotation.y,ru*.5,k);
  throttle=lerp(throttle,c?.throttle??0,k);propAngle+=dt*(8+throttle*110);prop.rotation.z=propAngle;
  (disc.material as THREE.MeshBasicMaterial).opacity=.04+throttle*.14;
  beacon.visible=Math.floor(time*1.5)%2===0;const flash=(time%1.3)<.06;for(const s of strobes)s.visible=flash;
 }};
}
