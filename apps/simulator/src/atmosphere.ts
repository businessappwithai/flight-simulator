import * as THREE from "three";
import {curvatureDrop,type LandscapeInfo} from "@flight/protocol";
/*
 * Sky, water and atmosphere of the simulated planet, all driven by the camera's altitude:
 *  - the sky fades from blue to black space (stars appear) as the camera climbs; the horizon dips with altitude;
 *  - aerial haze (scene fog) fades out between 3.5 and 18 km, so the planet does not turn to milk on the climb;
 *  - the ocean is a camera-centred polar grid placed exactly on the sphere (accurate near and to the horizon),
 *    coloured by depth: transparent at the shore, a turquoise shelf, deep navy; the eye lakes use the same shader;
 *  - from orbit a thin blue rim lights the limb and a light disc haze (0.18) sits over the planet.
 * The page draws these from the LANDSCAPE info alone (presentation code only reads @flight/protocol).
 */
const LOGDEPTH_V="\n#include <common>\n#include <logdepthbuf_pars_vertex>\n",LOGDEPTH_F="\n#include <logdepthbuf_pars_fragment>\n";
export interface Atmosphere{group:THREE.Group;
 /** Per frame: camera, the water rise (0 dry → 1 full), the eye-lakes' openness (1 open, 0 shut), extra exposure and haze scale. */
 update(camera:THREE.Camera,o:{water:number;eyes:number;time:number}):{altitude:number;space:number;fogDensity:number};
 dispose():void}

/** Depth texture: R = sea depth, G = lake depth (√-encoded, so the shallow shelf keeps its detail). */
function depthTexture(info:LandscapeInfo){
 const n=info.size,data=new Uint8Array(n*n*4);
 const inLake=(x:number,z:number)=>info.lakes.some(([x0,z0,x1,z1])=>x>=x0&&x<=x1&&z>=z0&&z<=z1);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){const k=j*n+i,h=info.heights[k]!,x=info.x0+i*info.cell,z=info.z0+j*info.cell;
  data[k*4]=Math.round(Math.sqrt(Math.min(1,Math.max(0,-h)/3000))*255);
  data[k*4+1]=inLake(x,z)?Math.round(Math.sqrt(Math.min(1,Math.max(0,info.lakeLevelM-h)/80))*255):0;
  data[k*4+2]=0;data[k*4+3]=255}
 const t=new THREE.DataTexture(data,n,n,THREE.RGBAFormat,THREE.UnsignedByteType);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearFilter;t.needsUpdate=true;return t;
}

const WATER_VERT=/* glsl */`
uniform vec2 uCam;uniform float uSeaY;uniform float uRadius;uniform float uLake;
varying vec3 vWorld;varying vec3 vNormalW;
${LOGDEPTH_V}
#include <fog_pars_vertex>
void main(){
 vec3 p;
 if(uLake>.5){p=(modelMatrix*vec4(position,1.)).xyz;vNormalW=vec3(0,1,0);}
 else{
  // Polar offset from the camera, wrapped onto the sphere about the runway (azimuthal equidistant).
  vec2 q=uCam+position.xz;float d=max(length(q),1e-3),th=min(d/uRadius,1.45);
  vec2 dir=q/d;float s=sin(th*.5),h=uRadius*sin(th);
  p=vec3(dir.x*h,uSeaY-uRadius*2.*s*s,dir.y*h);
  vNormalW=normalize(vec3(dir.x*sin(th),cos(th),dir.y*sin(th)));
 }
 vWorld=p;
 vec4 mvPosition=viewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;
 #include <logdepthbuf_vertex>
 #include <fog_vertex>
}`;
const WATER_FRAG=/* glsl */`
uniform sampler2D uDepth;uniform vec4 uDomain;uniform float uRise;uniform float uLake;uniform vec3 uSun;uniform vec3 uSky;uniform float uTime;
varying vec3 vWorld;varying vec3 vNormalW;
${LOGDEPTH_F}
#include <fog_pars_fragment>
float wHash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float wNoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(wHash(i),wHash(i+vec2(1,0)),u.x),mix(wHash(i+vec2(0,1)),wHash(i+vec2(1,1)),u.x),u.y);}
void main(){
 #include <logdepthbuf_fragment>
 vec2 uv=(vWorld.xz-uDomain.xy)/uDomain.zw;
 float raw=(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)?1.:(uLake>.5?texture2D(uDepth,uv).g:texture2D(uDepth,uv).r);
 float depth=raw*raw*(uLake>.5?80.:3000.)-uRise;
 if(depth<=0.)discard;
 vec3 shallow=vec3(.03,.36,.36),shelf=vec3(.012,.16,.24),deep=vec3(.003,.018,.06);
 vec3 c=mix(shallow,shelf,smoothstep(2.,40.,depth));c=mix(c,deep,smoothstep(60.,900.,depth));
 if(uLake>.5)c=mix(vec3(.02,.2,.22),vec3(.006,.05,.09),smoothstep(3.,40.,depth));
 vec3 v=normalize(cameraPosition-vWorld),n=normalize(vNormalW);
 float dist=length(cameraPosition-vWorld);
 // Ripples near the camera only.
 float r=(1.-smoothstep(200.,3000.,dist));
 n=normalize(n+r*.06*vec3(wNoise(vWorld.xz/9.+uTime*.3)-.5,0.,wNoise(vWorld.zx/7.-uTime*.27)-.5));
 float fres=pow(1.-max(dot(n,v),0.),5.)*.9+.04;
 vec3 h=normalize(v+uSun);float spec=pow(max(dot(n,h),0.),240.)*3.*(1.-smoothstep(5000.,60000.,dist));
 float diffuse=max(dot(n,uSun),0.)*.85+.15;
 vec3 col=mix(c*diffuse,uSky,fres)+vec3(1.,.95,.85)*spec;
 float alpha=mix(.25,.97,smoothstep(.5,30.,depth));
 gl_FragColor=vec4(col,max(alpha,fres));
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 #include <fog_fragment>
}`;

const SKY_VERT=/* glsl */`varying vec3 vDir;${LOGDEPTH_V}
void main(){vDir=normalize(position);vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
 #include <logdepthbuf_vertex>
}`;
const SKY_FRAG=/* glsl */`uniform vec3 uSun;uniform float uSpace;uniform float uDip;varying vec3 vDir;${LOGDEPTH_F}
float sHash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
void main(){
 #include <logdepthbuf_fragment>
 vec3 d=normalize(vDir);float e=d.y-uDip;
 vec3 zen=mix(vec3(.16,.42,1.15),vec3(0.),uSpace),hor=mix(vec3(1.1,1.3,1.55),vec3(.3,.6,1.3),uSpace);
 float band=exp(-max(e,0.)*mix(3.,40.,uSpace));
 vec3 c=mix(zen,hor,band);
 float sd=max(dot(d,uSun),0.);c+=vec3(1.,.9,.7)*(pow(sd,1800.)*40.+pow(sd,12.)*.25*(1.-uSpace*.7));
 if(e<0.)c=mix(c,hor*.35,smoothstep(0.,-.03,e));
 vec3 cell=floor(d*420.);float st=step(.9985,sHash(cell))*uSpace;c+=vec3(st)*.9;
 gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
const RIM_VERT=/* glsl */`varying vec3 vN;varying vec3 vW;${LOGDEPTH_V}
void main(){vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;
 #include <logdepthbuf_vertex>
}`;
const RIM_FRAG=/* glsl */`uniform float uSpace;uniform float uHaze;varying vec3 vN;varying vec3 vW;${LOGDEPTH_F}
void main(){
 #include <logdepthbuf_fragment>
 vec3 v=normalize(cameraPosition-vW);float f=1.-abs(dot(normalize(vN),v));
 float rim=pow(f,6.)*1.6;
 gl_FragColor=vec4(vec3(.32,.56,1.)*(rim+uHaze*.6),(rim*.9+uHaze)*uSpace);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

export function createAtmosphere(info:LandscapeInfo,sunDirection:THREE.Vector3):Atmosphere{
 const group=new THREE.Group();group.name="atmosphere";
 const R=info.planetRadiusM,P=info.padElevationM,depth=depthTexture(info);
 const domain=new THREE.Vector4(info.x0,info.z0,(info.size-1)*info.cell,(info.size-1)*info.cell);
 // --- Sky dome (follows the camera)
 const skyMat=new THREE.ShaderMaterial({vertexShader:SKY_VERT,fragmentShader:SKY_FRAG,side:THREE.BackSide,depthWrite:false,fog:false,
  uniforms:{uSun:{value:sunDirection.clone()},uSpace:{value:0},uDip:{value:0}}});
 const sky=new THREE.Mesh(new THREE.SphereGeometry(1,64,32),skyMat);sky.frustumCulled=false;sky.renderOrder=-10;sky.name="sky";group.add(sky);
 // --- Ocean: polar grid, log-spaced rings from 2 m to 1,500 km.
 const rings=230,segs=160,pos:number[]=[],idx:number[]=[];
 pos.push(0,0,0);
 for(let r=0;r<rings;r++){const rad=2*Math.pow(1.06,r);for(let s=0;s<segs;s++){const a=s/segs*Math.PI*2;pos.push(Math.cos(a)*rad,0,Math.sin(a)*rad)}}
 for(let s=0;s<segs;s++)idx.push(0,1+(s+1)%segs,1+s);
 for(let r=0;r<rings-1;r++)for(let s=0;s<segs;s++){const a=1+r*segs+s,b=1+r*segs+(s+1)%segs,c=a+segs,d=b+segs;idx.push(a,b,c,b,d,c)}
 const og=new THREE.BufferGeometry();og.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));og.setIndex(idx);
 const water=(lake:boolean)=>new THREE.ShaderMaterial({vertexShader:WATER_VERT,fragmentShader:WATER_FRAG,transparent:true,depthWrite:!lake,fog:true,
  uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{uCam:{value:new THREE.Vector2()},uSeaY:{value:-P},uRadius:{value:R},uLake:{value:lake?1:0},
   uDepth:{value:null},uDomain:{value:domain},uRise:{value:0},uSun:{value:sunDirection.clone()},uSky:{value:new THREE.Color(.45,.6,.8)},uTime:{value:0}}])});
 const oceanMat=water(false);oceanMat.uniforms.uDepth!.value=depth;
 const ocean=new THREE.Mesh(og,oceanMat);ocean.frustumCulled=false;ocean.name="ocean";ocean.renderOrder=1;group.add(ocean);
 // --- Eye lakes: dense curved grids at the lake level (the blink squashes them about their centre line).
 const lakeMat=water(true);lakeMat.uniforms.uDepth!.value=depth;
 const lakes=info.lakes.map(([x0,z0,x1,z1],i)=>{const n=48,g=new THREE.PlaneGeometry(x1-x0+800,z1-z0+800,n,n).rotateX(-Math.PI/2),p=g.attributes.position!;
  const cx=(x0+x1)/2,cz=(z0+z1)/2;for(let k=0;k<p.count;k++){const x=p.getX(k)+cx,z=p.getZ(k)+cz;p.setY(k,info.lakeLevelM-P-curvatureDrop(x,z))}
  g.computeBoundingSphere();const m=new THREE.Mesh(g,lakeMat);m.position.set(cx,0,cz);m.name=`lake:${i}`;m.renderOrder=2;group.add(m);return m});
 // --- Limb rim and disc haze, seen from high up.
 const rimMat=new THREE.ShaderMaterial({vertexShader:RIM_VERT,fragmentShader:RIM_FRAG,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false,
  uniforms:{uSpace:{value:0},uHaze:{value:.1}}});
 const rim=new THREE.Mesh(new THREE.SphereGeometry(R+60_000,192,96),rimMat);rim.position.set(0,-P-R,0);rim.renderOrder=3;rim.name="limb";group.add(rim);
 const v=new THREE.Vector3();
 return {group,update(camera,o){
  camera.getWorldPosition(v);
  const alt=Math.sqrt(v.x*v.x+(v.y+P+R)**2+v.z*v.z)-R,space=THREE.MathUtils.smoothstep(alt,8000,45_000);
  sky.position.copy(v);sky.scale.setScalar(Math.max(1000,Math.min(5e6,(camera as THREE.PerspectiveCamera).far*.9)));
  skyMat.uniforms.uSpace!.value=space;skyMat.uniforms.uDip!.value=-Math.sqrt(Math.max(0,1-(R/(R+Math.max(alt,1)))**2));
  oceanMat.uniforms.uCam!.value.set(v.x,v.z);
  const rise=(1-o.water)*420;oceanMat.uniforms.uRise!.value=rise;lakeMat.uniforms.uRise!.value=(1-o.water)*70;
  oceanMat.uniforms.uTime!.value=o.time;lakeMat.uniforms.uTime!.value=o.time;
  const skyCol=new THREE.Color(.45,.6,.8).lerp(new THREE.Color(.05,.1,.25),space);oceanMat.uniforms.uSky!.value.copy(skyCol);lakeMat.uniforms.uSky!.value.copy(skyCol);
  for(const l of lakes)l.scale.z=Math.max(.02,o.eyes);
  rimMat.uniforms.uSpace!.value=THREE.MathUtils.smoothstep(alt,10_000,40_000);
  // Aerial haze: full below 3.5 km, gone by 18 km.
  const fogDensity=1.5e-5*(1-THREE.MathUtils.smoothstep(alt,3500,18_000));
  return {altitude:alt,space,fogDensity};
 },dispose(){group.traverse(x=>{const m=x as THREE.Mesh;m.geometry?.dispose();(m.material as THREE.Material|undefined)?.dispose()});depth.dispose()}};
}
