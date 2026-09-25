import * as THREE from "three";
import {Sky} from "three/examples/jsm/objects/Sky.js";
import {SplitMix64} from "@flight/simulation";
/**
 * Procedural, deterministic scenery. Everything is generated in code (no external assets) from a fixed seed.
 * Coordinates: simulation (x, y, z) maps to three.js (-x, y, z) so a right turn in the simulation appears as a
 * right turn on screen. The physics ground is flat at y=0 within the flying area, so terrain relief is only
 * placed well outside it (distant hills and mountains); nothing visible contradicts the collision model.
 */
export const toThree=(x:number,y:number,z:number)=>new THREE.Vector3(-x,y,z);
export const RUNWAY={x:0,zStart:-320,zEnd:520,width:30};
export const FLAT_RADIUS=3200;
const rng=new SplitMix64(0x5ce4e5n),rand=(a=0,b=1)=>a+(b-a)*rng.nextFloat();
function canvas(w:number,h:number,draw:(g:CanvasRenderingContext2D)=>void){const c=document.createElement("canvas");c.width=w;c.height=h;draw(c.getContext("2d")!);return c}
function texture(c:HTMLCanvasElement,repeat=1,renderer?:THREE.WebGLRenderer){const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repeat,repeat);if(renderer)t.anisotropy=renderer.capabilities.getMaxAnisotropy();return t}
// Deterministic value-noise fBm for terrain relief.
function hash(x:number,y:number){const s=Math.sin(x*127.1+y*311.7)*43758.5453;return s-Math.floor(s)}
function noise(x:number,y:number){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
 const a=hash(xi,yi),b=hash(xi+1,yi),c=hash(xi,yi+1),d=hash(xi+1,yi+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v}
const fbm=(x:number,y:number)=>{let s=0,amp=.5,f=1;for(let i=0;i<6;i++){s+=amp*noise(x*f,y*f);amp*=.5;f*=2.03}return s};
/** Terrain height of the scenery (m). Exactly 0 inside FLAT_RADIUS, matching the simulation's flat ground. */
export function sceneryHeight(x:number,z:number){const r=Math.hypot(x,z);if(r<=FLAT_RADIUS)return 0;
 const t=Math.min(1,(r-FLAT_RADIUS)/2600),ramp=t*t*(3-2*t),ridges=1-Math.abs(fbm(x/2200,z/2200)*2-1);
 return ramp*(120+fbm(x/900+7,z/900-3)*380+ridges*ridges*1100*Math.min(1,(r-FLAT_RADIUS)/5000))}
export interface Scenery{sun:THREE.DirectionalLight;sunDirection:THREE.Vector3;update(camera:THREE.Camera,focus:THREE.Vector3,time:number):void}
export function buildScenery(scene:THREE.Scene,renderer:THREE.WebGLRenderer):Scenery{
 // --- Sky, sun and atmosphere
 const sky=new Sky();sky.scale.setScalar(40000);scene.add(sky);
 const u=sky.material.uniforms;u.turbidity!.value=5.5;u.rayleigh!.value=1.35;u.mieCoefficient!.value=.004;u.mieDirectionalG!.value=.82;
 const sunDirection=new THREE.Vector3().setFromSphericalCoords(1,THREE.MathUtils.degToRad(90-38),THREE.MathUtils.degToRad(145));
 u.sunPosition!.value.copy(sunDirection);
 const pmrem=new THREE.PMREMGenerator(renderer),envScene=new THREE.Scene(),envSky=new Sky();envSky.scale.setScalar(1000);
 for(const k of ["turbidity","rayleigh","mieCoefficient","mieDirectionalG","sunPosition"])envSky.material.uniforms[k]!.value=u[k]!.value;
 envScene.add(envSky);scene.environment=pmrem.fromScene(envScene).texture;pmrem.dispose();
 scene.fog=new THREE.Fog(0xc4d6e6,1500,14000);
 scene.add(new THREE.HemisphereLight(0xd8ecff,0x55643a,.9));
 const sun=new THREE.DirectionalLight(0xfff1dc,3.1);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
 const sc=sun.shadow.camera;sc.left=-120;sc.right=120;sc.top=120;sc.bottom=-120;sc.near=10;sc.far=1200;sun.shadow.bias=-.0004;sun.shadow.normalBias=.6;
 sun.shadow.camera.layers.enableAll(); // exterior-only meshes (aircraft skin) still cast shadows
 scene.add(sun,sun.target);
 // --- Farmland patchwork ground (flat area)
 const fields=canvas(1024,1024,g=>{
  const cols=["#6f8f3a","#7d9a44","#8aa14e","#a8a45a","#bba865","#5f7f35","#93873f","#6d8540","#c2b278","#7a8c3e"];
  g.fillStyle="#6c8a3b";g.fillRect(0,0,1024,1024);
  for(let i=0;i<260;i++){const w=rand(40,190),h=rand(30,170),x=rand(-40,1024),y=rand(-40,1024);g.fillStyle=cols[Math.floor(rand(0,cols.length))]!;g.globalAlpha=rand(.75,1);g.fillRect(x,y,w,h);
   g.globalAlpha=.12;g.strokeStyle="#2f3a1a";g.lineWidth=1;for(let s=4;s<Math.max(w,h);s+=6){g.beginPath();g.moveTo(x+s,y);g.lineTo(x+s,y+h);g.stroke()}}
  g.globalAlpha=1;g.strokeStyle="#8e8a7e";g.lineWidth=3;for(let i=0;i<7;i++){g.beginPath();const y=rand(0,1024);g.moveTo(0,y);g.bezierCurveTo(300,y+rand(-80,80),700,y+rand(-80,80),1024,y);g.stroke()}
  const img=g.getImageData(0,0,1024,1024);for(let i=0;i<img.data.length;i+=4){const n=(hash(i%4096,i>>12)-.5)*22,d=img.data;d[i]=d[i]!+n;d[i+1]=d[i+1]!+n;d[i+2]=d[i+2]!+n}g.putImageData(img,0,0);
 });
 const ground=new THREE.Mesh(new THREE.CircleGeometry(FLAT_RADIUS+60,96),new THREE.MeshStandardMaterial({map:texture(fields,9,renderer),roughness:1,metalness:0}));
 ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
 // --- Hills and mountains beyond the flying area
 const size=36000,seg=220,tg=new THREE.PlaneGeometry(size,size,seg,seg);tg.rotateX(-Math.PI/2);
 const pos=tg.attributes.position!,colors=new Float32Array(pos.count*3),c=new THREE.Color();
 for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),h=sceneryHeight(-x,z);pos.setY(i,h-.6);
  const rock=Math.min(1,Math.max(0,(h-380)/300)),snow=Math.min(1,Math.max(0,(h-950)/150));
  c.setRGB(.36,.47,.22).lerp(new THREE.Color(.45,.43,.38),rock).lerp(new THREE.Color(.94,.95,.97),snow);colors.set([c.r,c.g,c.b],i*3)}
 tg.setAttribute("color",new THREE.BufferAttribute(colors,3));tg.computeVertexNormals();
 const terrain=new THREE.Mesh(tg,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,flatShading:false}));terrain.receiveShadow=true;scene.add(terrain);
 // --- Lake and river (reflective water picks up the sky environment)
 const water=new THREE.MeshStandardMaterial({color:0x2f5f78,roughness:.06,metalness:.35,envMapIntensity:1.3});
 const lake=new THREE.Mesh(new THREE.CircleGeometry(420,64),water);lake.rotation.x=-Math.PI/2;lake.position.copy(toThree(-900,.15,1150));lake.scale.set(1.5,1,1);scene.add(lake);
 const river=new THREE.Mesh(new THREE.PlaneGeometry(55,5200),water);river.rotation.x=-Math.PI/2;river.rotation.z=.35;river.position.copy(toThree(1300,.12,300));scene.add(river);
 // --- Airport: grass strip, runway with markings, taxiway, apron, hangars, tower, windsock, edge lights
 const len=RUNWAY.zEnd-RUNWAY.zStart,mid=(RUNWAY.zEnd+RUNWAY.zStart)/2;
 const grass=new THREE.Mesh(new THREE.PlaneGeometry(260,len+300),new THREE.MeshStandardMaterial({color:0x6f9a45,roughness:1}));grass.rotation.x=-Math.PI/2;grass.position.copy(toThree(-40,.04,mid));grass.receiveShadow=true;scene.add(grass);
 const rw=canvas(256,4096,g=>{g.fillStyle="#3b3e43";g.fillRect(0,0,256,4096);
  for(let i=0;i<9000;i++){g.fillStyle=`rgba(${rand(0,255)|0},${rand(0,255)|0},${rand(0,255)|0},.05)`;g.fillRect(rand(0,256),rand(0,4096),2,2)}
  g.fillStyle="#f2f2ee";g.fillRect(6,0,5,4096);g.fillRect(245,0,5,4096);
  for(let y=380;y<3700;y+=120)g.fillRect(124,y,8,64);
  for(const top of [true,false]){const y0=top?20:4096-20-120;for(let i=0;i<8;i++)g.fillRect(20+i*28+(i>=4?12:0),y0,16,120);
   g.save();g.font="bold 150px sans-serif";g.textAlign="center";g.translate(128,top?330:4096-330);if(!top)g.rotate(Math.PI);g.fillText(top?"18":"36",0,0);g.restore();
   for(const dy of [480,560])for(const x of [40,190])g.fillRect(x,top?dy:4096-dy-50,26,50)}
  g.fillStyle="rgba(20,20,20,.35)";for(let i=0;i<40;i++)g.fillRect(110+rand(-20,20),rand(300,700),rand(4,12),rand(40,140));
 });
 const runway=new THREE.Mesh(new THREE.PlaneGeometry(RUNWAY.width,len),new THREE.MeshStandardMaterial({map:texture(rw,1,renderer),roughness:.85}));
 runway.material.map!.repeat.set(1,1);runway.rotation.x=-Math.PI/2;runway.position.copy(toThree(RUNWAY.x,.08,mid));runway.receiveShadow=true;scene.add(runway);
 const asphalt=new THREE.MeshStandardMaterial({color:0x4a4d52,roughness:.9});
 const taxi=new THREE.Mesh(new THREE.PlaneGeometry(14,len-120),asphalt);taxi.rotation.x=-Math.PI/2;taxi.position.copy(toThree(-70,.07,mid));taxi.receiveShadow=true;scene.add(taxi);
 for(const z of [RUNWAY.zStart+80,RUNWAY.zEnd-80]){const t=new THREE.Mesh(new THREE.PlaneGeometry(70,12),asphalt);t.rotation.x=-Math.PI/2;t.position.copy(toThree(-35,.07,z));scene.add(t)}
 const apron=new THREE.Mesh(new THREE.PlaneGeometry(90,180),asphalt);apron.rotation.x=-Math.PI/2;apron.position.copy(toThree(-125,.06,120));apron.receiveShadow=true;scene.add(apron);
 const shadowed=(m:THREE.Mesh)=>{m.castShadow=true;m.receiveShadow=true;scene.add(m);return m};
 const hangarMat=new THREE.MeshStandardMaterial({color:0xb9c0c7,roughness:.5,metalness:.4}),roofMat=new THREE.MeshStandardMaterial({color:0x8a2d25,roughness:.6});
 for(const [i,z] of [[0,60],[1,120],[2,180]] as const){const h=shadowed(new THREE.Mesh(new THREE.BoxGeometry(34,9,30),hangarMat));h.position.copy(toThree(-185,4.5,z));
  const roof=shadowed(new THREE.Mesh(new THREE.CylinderGeometry(17.5,17.5,30,24,1,false,0,Math.PI).rotateX(Math.PI/2).rotateZ(Math.PI/2),i===1?roofMat:hangarMat));roof.scale.set(1,.35,1);roof.position.copy(toThree(-185,9,z));roof.rotation.y=Math.PI/2}
 const tower=shadowed(new THREE.Mesh(new THREE.CylinderGeometry(2.6,3.4,24,16),new THREE.MeshStandardMaterial({color:0xe7e2d6,roughness:.7})));tower.position.copy(toThree(-150,12,-40));
 const cab=shadowed(new THREE.Mesh(new THREE.CylinderGeometry(5,4.2,4.5,8),new THREE.MeshStandardMaterial({color:0x1f3140,roughness:.1,metalness:.7})));cab.position.copy(toThree(-150,26.2,-40));
 const cap=shadowed(new THREE.Mesh(new THREE.CylinderGeometry(5.6,5.6,.8,8),new THREE.MeshStandardMaterial({color:0xdddddd})));cap.position.copy(toThree(-150,28.8,-40));
 const pole=shadowed(new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,6,6),hangarMat));pole.position.copy(toThree(-30,3,-160));
 const sock=shadowed(new THREE.Mesh(new THREE.ConeGeometry(.7,3.2,12,1,true).rotateZ(Math.PI/2),new THREE.MeshStandardMaterial({color:0xff6a1a,side:THREE.DoubleSide})));sock.position.copy(toThree(-31.6,5.8,-160));
 const lampGeo=new THREE.SphereGeometry(.35,6,4),lamps=new THREE.InstancedMesh(lampGeo,new THREE.MeshBasicMaterial({color:0xfff3c4}),Math.ceil(len/40)*2+20);let li=0;const m4=new THREE.Matrix4();
 for(let z=RUNWAY.zStart;z<=RUNWAY.zEnd;z+=40)for(const x of [-RUNWAY.width/2-1,RUNWAY.width/2+1])lamps.setMatrixAt(li++,m4.makeTranslation(toThree(x,.4,z)));
 for(let x=-14;x<=14;x+=3.2){lamps.setMatrixAt(li++,m4.makeTranslation(toThree(x,.4,RUNWAY.zStart-3)))}
 lamps.count=li;scene.add(lamps);
 // --- Forests: instanced conifers and broadleaf trees, kept clear of the runway, approach corridor and lake.
 const clear=(x:number,z:number)=>(Math.abs(x)<220&&z>-700&&z<1600)||Math.hypot(x+900,(z-1150)/1)<700||Math.hypot(x,z)<350||Math.abs((x-1300)*Math.cos(.35)+(z-300)*Math.sin(.35))<60;
 const N=3200,conifer=new THREE.InstancedMesh(new THREE.ConeGeometry(3.2,11,7).translate(0,7.5,0),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9}),N);
 const broad=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(4.6,1).translate(0,7,0),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9,flatShading:true}),N);
 const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.35,.5,3,5).translate(0,1.5,0),new THREE.MeshStandardMaterial({color:0x5a4330,roughness:1}),N*2);
 let nc=0,nb=0,nt=0;const q=new THREE.Quaternion(),s=new THREE.Vector3(),col=new THREE.Color();
 for(let f=0;f<70;f++){const cx=rand(-3000,3000),cz=rand(-2800,3000),rad=rand(80,320),n=Math.floor(rand(25,90));
  for(let i=0;i<n;i++){const a=rand(0,Math.PI*2),r=rad*Math.sqrt(rand()),x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;if(clear(x,z)||Math.hypot(x,z)>FLAT_RADIUS-50)continue;
   const sc=rand(.7,1.5);s.set(sc,sc*rand(.85,1.25),sc);q.setFromAxisAngle(new THREE.Vector3(0,1,0),rand(0,6.28));m4.compose(toThree(x,0,z),q,s);
   if(rand()<.55&&nc<N){conifer.setMatrixAt(nc,m4);conifer.setColorAt(nc++,col.setHSL(rand(.27,.33),rand(.35,.5),rand(.17,.26)))}else if(nb<N){broad.setMatrixAt(nb,m4);broad.setColorAt(nb++,col.setHSL(rand(.2,.3),rand(.35,.55),rand(.24,.34)))}
   if(nt<N*2)trunks.setMatrixAt(nt++,m4)}}
 conifer.count=nc;broad.count=nb;trunks.count=nt;for(const m of [conifer,broad]){m.castShadow=true;m.receiveShadow=true;scene.add(m)}scene.add(trunks);
 // --- Farm buildings scattered over the countryside
 const barn=new THREE.InstancedMesh(new THREE.BoxGeometry(14,7,22).translate(0,3.5,0),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8}),120);let nbarn=0;
 for(let i=0;i<400&&nbarn<120;i++){const x=rand(-3000,3000),z=rand(-3000,3000);if(clear(x,z)||Math.hypot(x,z)>FLAT_RADIUS-80)continue;q.setFromAxisAngle(new THREE.Vector3(0,1,0),rand(0,3));m4.compose(toThree(x,0,z),q,s.set(1,1,1));barn.setMatrixAt(nbarn,m4);barn.setColorAt(nbarn++,col.set(rand()<.5?0x9c3b2e:0xd9d2c3))}
 barn.count=nbarn;barn.castShadow=true;scene.add(barn);
 // --- Clouds: soft billboards grouped into cumulus clusters above the circuit altitude
 const puff=texture(canvas(128,128,g=>{const gr=g.createRadialGradient(64,64,4,64,64,62);gr.addColorStop(0,"rgba(255,255,255,1)");gr.addColorStop(.45,"rgba(250,250,252,.85)");gr.addColorStop(1,"rgba(255,255,255,0)");g.fillStyle=gr;g.fillRect(0,0,128,128)}));
 const clouds=new THREE.Group();scene.add(clouds);
 for(let k=0;k<55;k++){const cx=rand(-9000,9000),cz=rand(-9000,9000),cy=rand(420,760),n=Math.floor(rand(6,14));
  for(let i=0;i<n;i++){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:puff,color:new THREE.Color().setHSL(.6,.1,rand(.88,1)),transparent:true,opacity:rand(.55,.85),depthWrite:false,fog:true}));
   const sz=rand(160,380);sp.scale.set(sz,sz*.62,1);sp.position.copy(toThree(cx+rand(-260,260),cy+rand(-35,45),cz+rand(-200,200)));clouds.add(sp)}}
 return {sun,sunDirection,update(_camera,focus,time){
  // Keep the shadow frustum centred on the aircraft so shadows stay crisp wherever it flies.
  sun.position.copy(focus).addScaledVector(sunDirection,500);sun.target.position.copy(focus);sun.target.updateMatrixWorld();
  clouds.position.x=(time*1.2)%4000;sock.rotation.y=Math.sin(time*.7)*.15;
 }};
}
