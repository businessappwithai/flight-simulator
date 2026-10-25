/**
 * Hillshade of the simulated landscape before any mesh exists (PDF: "read the hillshade PNG before going on").
 *   bun run landscape:hillshade [--seed 7] [--out .gstack/qa-reports/landscape]
 * Writes the global field (513²) and the L1 / L0 tiles under the home airfield and the city, and prints the numbers.
 */
import {deflateSync} from "node:zlib";
import {mkdirSync,writeFileSync} from "node:fs";
import {Landscape,encodePngRgb,globalHillshade,landscapeStats,tileHillshade,GLOBAL_NODES,TILE_NODES} from "@flight/landscape";
const arg=(k:string,d:string)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]!:d};
const seed=BigInt(arg("--seed","7")),out=arg("--out",".gstack/qa-reports/landscape");mkdirSync(out,{recursive:true});
const t0=performance.now();const l=new Landscape({seed});const ms=Math.round(performance.now()-t0);
const png=(name:string,rgb:Uint8Array,n:number)=>{const f=`${out}/${name}.png`;writeFileSync(f,encodePngRgb(rgb,n,n,b=>deflateSync(b)));return f};
console.log(JSON.stringify({seed:String(seed),generateMs:ms,...landscapeStats(l)}));
console.log(png(`global-seed${seed}`,globalHillshade(l),GLOBAL_NODES));
const [cx,cz]=l.unitToWorld(l.brand.city.x,l.brand.city.y),[px,pz]=l.unitToWorld(l.brand.passes[0]![0],l.brand.passes[0]![1]);
for(const [name,x,z] of [["airfield",0,-6000],["pass",px,pz],["city",cx,cz]] as const){
 for(const level of ["L1","L0"] as const){const [i,j]=l.tileIndex(level,x,z),t=l.tile(level,i,j);console.log(png(`${name}-${level}-seed${seed}`,tileHillshade(l,t,level==="L1"?7.3:6.9),TILE_NODES))}}
