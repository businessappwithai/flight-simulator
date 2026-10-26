import * as THREE from "three";
/*
 * The terrain look, shared by the simulated planet and real-world terrain: a MeshStandardMaterial extended in its
 * shader (onBeforeCompile) so lights, shadows, fog and tone mapping stay three.js's own.
 *
 *  - Rock by slope: terracotta sandstone on steep faces, the vertex colour (soil, forest tint, shore) elsewhere.
 *  - Strata (prompt pack follow-up 4): bands 41 → 96 m thick with a 140 m warp, only on slopes steeper than
 *    0.32 (1 − cos) and only inside noise patches, the cream band toned down to (0.50, 0.26, 0.13).
 *  - Rivers (follow-up 6): a mask on the drainage log-area, revealed sources first as its threshold rises.
 *  - Build fronts: one distance field from the build origin: editor grid → clay (with a scan line on its edge)
 *    → full material; the uplift front heaves the flat grid into the mountains.
 *  - From orbit the land albedo is tinted (1.5, 0.9, 0.66) so the continent measures as its brand colour.
 *  - Level cut: a coarse level discards itself inside the box where the next finer level is drawn.
 */
export interface TerrainUniforms{
 uOrigin:{value:THREE.Vector2};uClayR:{value:number};uPbrR:{value:number};uRiverReveal:{value:number};uOrbit:{value:number};
 uPad:{value:number};uRadius:{value:number};uFeatures:{value:number};uTime:{value:number};uWater:{value:number};
 /** Rock on steep faces (linear RGB): terracotta sandstone on the planet, grey-brown on real terrain. */
 uRockColor:{value:THREE.Color};
}
export const createTerrainUniforms=():TerrainUniforms=>({uOrigin:{value:new THREE.Vector2()},uClayR:{value:1e9},uPbrR:{value:1e9},uRiverReveal:{value:99},uOrbit:{value:0},
 uPad:{value:0},uRadius:{value:400_000},uFeatures:{value:1},uTime:{value:0},uWater:{value:1},uRockColor:{value:new THREE.Color(.24,.095,.05)}});
/** Feature bits: 1 rock by slope, 2 strata, 4 rivers, 8 build fronts and curvature-aware heave (planet only). */
export const TERRAIN_FEATURES={ROCK:1,STRATA:2,RIVERS:4,FRONTS:8,PLANET:15} as const;

const NOISE=/* glsl */`
float tHash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float tNoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
 return mix(mix(tHash(i),tHash(i+vec2(1,0)),u.x),mix(tHash(i+vec2(0,1)),tHash(i+vec2(1,1)),u.x),u.y);}
float tDrop(vec2 xz,float R){float r=length(xz);float t=clamp((r-3200.)/2600.,0.,1.);return t*t*(3.-2.*t)*r*r/(2.*R);}
`;

export interface TerrainMaterialOptions{uniforms:TerrainUniforms;
 /** River thresholds (log10 m²) for this level: the channel starts at `lo` and is full at `hi`. */
 river?:[number,number];
 /** Shared box uniform: discard inside it (x0, z0, x1, z1); w < x means off. */
 cut?:{value:THREE.Vector4}}

export function createTerrainMaterial(o:TerrainMaterialOptions):THREE.MeshStandardMaterial{
 const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,metalness:0});
 const u=o.uniforms,cut=o.cut??{value:new THREE.Vector4(1,1,0,0)},river=o.river??[99,100];
 m.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,u,{uCut:cut,uRiver:{value:new THREE.Vector2(river[0],river[1])}});
  shader.vertexShader=shader.vertexShader.replace("#include <common>",`#include <common>
uniform vec2 uOrigin;uniform float uClayR;uniform float uPad;uniform float uRadius;uniform float uFeatures;
attribute vec2 attrs;varying vec3 vWorld;varying vec3 vWorldN;varying vec2 vAttrs;varying float vHeave;
${NOISE}`).replace("#include <begin_vertex>",`#include <begin_vertex>
 vec3 tw=(modelMatrix*vec4(transformed,1.)).xyz;
 vHeave=1.;
 if(mod(floor(uFeatures/8.),2.)>.5){
  // Before the uplift front arrives the land is the flat editor grid (on the curved planet).
  float d=distance(tw.xz,uOrigin);vHeave=smoothstep(uClayR,uClayR-1800.,d);
  float flatY=-tDrop(tw.xz,uRadius)-modelMatrix[3].y;
  transformed.y=mix(flatY,transformed.y,vHeave);tw=(modelMatrix*vec4(transformed,1.)).xyz;
 }
 vWorld=tw;vWorldN=normalize(mat3(modelMatrix)*objectNormal);vAttrs=attrs;`);
  shader.fragmentShader=shader.fragmentShader.replace("#include <common>",`#include <common>
uniform vec2 uOrigin;uniform float uClayR;uniform float uPbrR;uniform float uRiverReveal;uniform float uOrbit;uniform float uPad;uniform float uRadius;
uniform float uFeatures;uniform vec4 uCut;uniform vec2 uRiver;uniform float uWater;uniform vec3 uRockColor;
varying vec3 vWorld;varying vec3 vWorldN;varying vec2 vAttrs;varying float vHeave;
${NOISE}
bool tOn(float bit){return mod(floor(uFeatures/bit),2.)>.5;}
vec3 tStrata(float hs,vec2 xz){
 float warp=(tNoise(xz/1400.)-.5)*280.;
 float thick=mix(41.,96.,tNoise(xz/9000.+7.));
 float t=(hs+warp)/thick,idx=floor(t),f=fract(t);
 float k=tHash(vec2(idx,3.7));
 vec3 c=k<.34?vec3(.30,.12,.06):k<.67?vec3(.36,.22,.12):vec3(.20,.08,.045);
 return c*(.85+.3*smoothstep(.0,.15,f)*smoothstep(1.,.85,f));
}`).replace("#include <clipping_planes_fragment>",`#include <clipping_planes_fragment>
 if(uCut.z>uCut.x&&vWorld.x>uCut.x&&vWorld.x<uCut.z&&vWorld.z>uCut.y&&vWorld.z<uCut.w)discard;`).replace("#include <color_fragment>",`#include <color_fragment>
 vec3 tn=normalize(vWorldN);float slope=1.-clamp(tn.y,0.,1.);
 float tRiver=0.;
 if(tOn(1.)){
  float rock=smoothstep(.18,.42,slope);
  vec3 rockC=uRockColor*(.85+.3*tNoise(vWorld.xz/220.));
  if(tOn(2.)){
   float hs=vWorld.y+uPad+tDrop(vWorld.xz,uRadius);
   float pmask=smoothstep(.42,.58,tNoise(vWorld.xz/3200.+3.1));
   rockC=mix(rockC,tStrata(hs,vWorld.xz),smoothstep(.32,.4,slope)*pmask);
  }
  diffuseColor.rgb=mix(diffuseColor.rgb,rockC,rock);
 }
 if(tOn(4.)){
  float la=vAttrs.x;
  tRiver=smoothstep(uRiver.x,uRiver.y,la)*step(la,uRiverReveal)*(1.-smoothstep(.25,.45,slope))*uWater;
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.025,.075,.09),tRiver);
 }
 if(tOn(8.)){
  float d=distance(vWorld.xz,uOrigin);
  // Clay between the two fronts, the editor grid beyond the clay front.
  vec3 clay=vec3(.42,.40,.37);
  diffuseColor.rgb=mix(diffuseColor.rgb,clay,smoothstep(uPbrR-120.,uPbrR,d));
  if(d>uClayR-40.){
   vec2 g=abs(fract(vWorld.xz/100.-.5)-.5)/fwidth(vWorld.xz/100.),G=abs(fract(vWorld.xz/1000.-.5)-.5)/fwidth(vWorld.xz/1000.);
   float line=max(1.-min(g.x,g.y),0.)*.35+max(1.-min(G.x,G.y),0.)*.6;
   diffuseColor.rgb=mix(vec3(.16),vec3(.42),line);
  }
 }
 diffuseColor.rgb*=mix(vec3(1.),vec3(2.85,1.9,1.72),uOrbit);`).replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
 roughnessFactor=mix(roughnessFactor,.18,tRiver);`).replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
 if(tOn(8.)){float d=distance(vWorld.xz,uOrigin);
  totalEmissiveRadiance+=vec3(.55,.85,1.)*(1.-smoothstep(0.,60.,abs(d-uClayR)))*step(uClayR,1e8)*1.5+vec3(1.,.8,.55)*(1.-smoothstep(0.,40.,abs(d-uPbrR)))*step(uPbrR,1e8)*.6;}`);
 };
 m.customProgramCacheKey=()=>"terrain-v1";
 return m;
}

/** Trees (and buildings): instanced, grown by a front from an origin, hidden inside a cut box and far from the camera. */
export function createGrowingMaterial(base:THREE.MeshStandardMaterial,o:{front:{value:number};origin:{value:THREE.Vector2};cut?:{value:THREE.Vector4};far:{value:number};vertical?:boolean;ramp?:number}){
 const cut=o.cut??{value:new THREE.Vector4(1,1,0,0)};
 base.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,{uFront:o.front,uGrowOrigin:o.origin,uCut:cut,uFar:o.far});
  shader.vertexShader=shader.vertexShader.replace("#include <common>",`#include <common>
uniform float uFront;uniform vec2 uGrowOrigin;uniform vec4 uCut;uniform float uFar;`).replace("#include <begin_vertex>",`#include <begin_vertex>
 vec3 ip=vec3(instanceMatrix[3]);
 float grow=smoothstep(uFront,uFront-${(o.ramp??700).toFixed(1)},distance(ip.xz,uGrowOrigin));
 if(uCut.z>uCut.x&&ip.x>uCut.x&&ip.x<uCut.z&&ip.z>uCut.y&&ip.z<uCut.w)grow=0.;
 if(distance(ip,cameraPosition)>uFar)grow=0.;
 ${o.vertical?"transformed.y*=grow;if(grow<=0.)transformed*=0.;":"transformed*=grow;"}`);
 };
 base.customProgramCacheKey=()=>`grow-${o.vertical?1:0}-${o.ramp??700}`;
 return base;
}
