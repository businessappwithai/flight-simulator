/**
 * The camera clearance table (PDF: "print the clearance over the FINAL terrain for every frame, not the grid it starts as").
 *   bun run landscape:clearance [--seed 7] [--every 30]
 * Clearance = camera altitude − the highest ground (or water) within 160 m below it, on the 10 m field for the low
 * flight (L0) and the 80 m field once above 6 km; the planned minimum is 350 m.
 */
import {Planet,REVEAL_MIN_CLEARANCE_M} from "@flight/landscape";
import {REVEAL,revealFrame,revealLens,revealPoint} from "@flight/protocol";
const arg=(k:string,d:string)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]!:d};
const seed=BigInt(arg("--seed","7")),every=Number(arg("--every","30"));
const p=new Planet({seed}),l=p.land,frames=revealFrame(REVEAL.duration);
let min=Infinity,at=0;const rows:string[]=[];
for(let f=1;f<=frames;f++){const t=(f-1)/REVEAL.fps,c=revealPoint(p.info.camera,t);
 let ground=-Infinity;const r=c.alt<6000?160:0;
 for(let b=-r;b<=r;b+=40)for(let a=-r;a<=r;a+=40){const x=c.x+a,z=c.z+b,h=Math.max(c.alt<6000?l.height(x,z):l.levelHeight("L1",x,z),l.waterLevel(x,z));if(h>ground)ground=h}
 const clear=c.alt-ground;if(clear<min){min=clear;at=f}
 if(f%every===1||f===frames)rows.push(`f${String(f).padStart(4)}  t=${t.toFixed(2).padStart(5)}s  x=${(c.x/1000).toFixed(2).padStart(7)} km  z=${(c.z/1000).toFixed(2).padStart(7)} km  alt=${Math.round(c.alt).toString().padStart(6)} m  ground=${Math.round(ground).toString().padStart(5)} m  clearance=${Math.round(clear).toString().padStart(6)} m  lens=${revealLens(t).toFixed(1)} mm`)}
console.log(rows.join("\n"));
console.log(`minimum clearance ${Math.round(min)} m at frame ${at} (t=${((at-1)/REVEAL.fps).toFixed(2)} s); planned minimum ${REVEAL_MIN_CLEARANCE_M} m: ${min>=REVEAL_MIN_CLEARANCE_M-40?"OK":"TOO LOW"}`);
process.exit(min>=REVEAL_MIN_CLEARANCE_M-40?0:1);
