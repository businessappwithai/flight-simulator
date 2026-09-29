// Writes a tiny OGC 3D Tiles 1.1 tileset (tileset.json + one glTF box) standing on the ground at a WGS84 point,
// for checking the simulator's 3D Tiles layer (&tiles3d=<url of tileset.json>) without an API key.
//   bun scripts/make-test-tileset.ts <outDir> [lat lon groundMsl] [widthM heightM]
// Default: a 120 m magenta block 1.5 km past the VOMM runway 07 threshold, 60 m tall.
import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import {destinationPoint,geodeticToEcef} from "@flight/geospatial";
const [out="/tmp/tileset",la,lo,gm,wm,hm]=process.argv.slice(2);
const at=la&&lo?{lat:+la,lon:+lo}:destinationPoint({lat:12.9855,lon:80.1545,altMsl:0},68.7,1500),ground=gm?+gm:15,w=wm?+wm:120,h=hm?+hm:60;

/** One box, glTF Y-up, base on y = 0: 24 vertices (flat normals), 36 indices. */
function boxGlb(w:number,h:number,d:number,rgba:[number,number,number,number]){
 const x=w/2,z=d/2,faces:[number[],number[][]][]=[
  [[1,0,0],[[x,0,-z],[x,h,-z],[x,h,z],[x,0,z]]],[[-1,0,0],[[-x,0,z],[-x,h,z],[-x,h,-z],[-x,0,-z]]],
  [[0,1,0],[[-x,h,-z],[-x,h,z],[x,h,z],[x,h,-z]]],[[0,-1,0],[[-x,0,z],[-x,0,-z],[x,0,-z],[x,0,z]]],
  [[0,0,1],[[-x,0,z],[x,0,z],[x,h,z],[-x,h,z]]],[[0,0,-1],[[x,0,-z],[-x,0,-z],[-x,h,-z],[x,h,-z]]]];
 const pos:number[]=[],nor:number[]=[],idx:number[]=[];
 faces.forEach(([n,q],f)=>{for(const v of q){pos.push(...v);nor.push(...n)}idx.push(f*4,f*4+1,f*4+2,f*4,f*4+2,f*4+3)});
 const P=new Float32Array(pos),N=new Float32Array(nor),I=new Uint16Array(idx),bin=new Uint8Array(P.byteLength+N.byteLength+I.byteLength);
 bin.set(new Uint8Array(P.buffer),0);bin.set(new Uint8Array(N.buffer),P.byteLength);bin.set(new Uint8Array(I.buffer),P.byteLength+N.byteLength);
 const json={asset:{version:"2.0",generator:"flight-world make-test-tileset"},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
  meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:rgba,metallicFactor:0,roughnessFactor:.8}}],
  buffers:[{byteLength:bin.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:P.byteLength,target:34962},{buffer:0,byteOffset:P.byteLength,byteLength:N.byteLength,target:34962},{buffer:0,byteOffset:P.byteLength+N.byteLength,byteLength:I.byteLength,target:34963}],
  accessors:[{bufferView:0,componentType:5126,count:pos.length/3,type:"VEC3",min:[-x,0,-z],max:[x,h,z]},{bufferView:1,componentType:5126,count:nor.length/3,type:"VEC3"},{bufferView:2,componentType:5123,count:idx.length,type:"SCALAR"}]};
 const pad=(b:Uint8Array,fill:number)=>{const n=Math.ceil(b.length/4)*4,o=new Uint8Array(n).fill(fill);o.set(b);return o};
 const J=pad(new TextEncoder().encode(JSON.stringify(json)),0x20),B=pad(bin,0),total=12+8+J.length+8+B.length,glb=new Uint8Array(total),dv=new DataView(glb.buffer);
 dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);dv.setUint32(8,total,true);
 dv.setUint32(12,J.length,true);dv.setUint32(16,0x4e4f534a,true);glb.set(J,20);
 dv.setUint32(20+J.length,B.length,true);dv.setUint32(24+J.length,0x004e4942,true);glb.set(B,28+J.length);
 return glb;
}
// ENU → ECEF at the point (column-major): columns east, north, up, origin.
const R=Math.PI/180,φ=at.lat*R,λ=at.lon*R,o=geodeticToEcef({lat:at.lat,lon:at.lon,altMsl:ground});
const e=[-Math.sin(λ),Math.cos(λ),0],n=[-Math.sin(φ)*Math.cos(λ),-Math.sin(φ)*Math.sin(λ),Math.cos(φ)],u=[Math.cos(φ)*Math.cos(λ),Math.cos(φ)*Math.sin(λ),Math.sin(φ)];
const transform=[...e,0,...n,0,...u,0,o.x,o.y,o.z,1];
// Tile frame is Z-up (glTF Y-up content is rotated by the renderer): the box spans z ∈ [0, h].
const tileset={asset:{version:"1.1"},geometricError:500,root:{transform,boundingVolume:{box:[0,0,h/2,w/2,0,0,0,w/2,0,0,0,h/2]},geometricError:0,refine:"ADD",content:{uri:"box.glb"}}};
await mkdir(out,{recursive:true});
await Bun.write(join(out,"box.glb"),boxGlb(w,h,w,[1,.2,.85,1]));
await Bun.write(join(out,"tileset.json"),JSON.stringify(tileset,null,1));
console.log(`wrote ${out}/tileset.json: ${w}×${h} m box at ${at.lat.toFixed(5)}, ${at.lon.toFixed(5)} (ground ${ground} m)`);
