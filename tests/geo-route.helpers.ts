import {gunzipSync} from "node:zlib";
import {readFileSync} from "node:fs";
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
import {steerTo} from "@flight/controller";
import {AirportIndex,GeoWorld,TerrainTile,decodeCatalog,tileBounds,type TileSource} from "@flight/geospatial";

/** The shipped OurAirports catalogue (~27k airports). */
export const catalogIndex=()=>new AirportIndex(decodeCatalog(JSON.parse(gunzipSync(readFileSync(new URL("../packages/geospatial/data/airports-catalog.json.gz",import.meta.url))).toString("utf8"))));
/** Synthetic DEM rising inland: ~40 m at Chennai, ~790 m at Bengaluru (0.3% grade), with a gentle ripple. */
export const inland=(lat:number,lon:number)=>Math.max(0,Math.min(900,(80.3-lon)*300))+20*Math.sin(lat*40)*Math.sin(lon*40);
export function demSource(dem:(lat:number,lon:number)=>number,delayMs=()=>0):TileSource<TerrainTile>{
 return {layer:"terrain",maxZoom:15,sizeOf:t=>t.byteLength,load:async(tile,signal)=>{const d=delayMs();if(d)await Bun.sleep(d);if(signal.aborted)throw new Error("aborted");
  const n=16,b=tileBounds(tile),h=new Float32Array(n*n);
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const f=(k:number)=>(k+.5)/n;h[j*n+i]=dem(b.north+(b.south-b.north)*f(j),b.west+(b.east-b.west)*f(i))}
  return new TerrainTile(tile,n,n,h)}};
}
/**
 * Flies the route autopilot from `from` to `to` the way the worker does: hold whenever terrain is missing, steer to
 * the route target, re-anchor the frame on long flights and complete the flight on arrival.
 */
export async function flyRoute(o:{airports:AirportIndex;from:string;runway?:string;to:string;toRunway?:string;delayMs?:()=>number;maxTicks?:number;log?:(w:any,g:GeoWorld)=>void}){
 const g=new GeoWorld({airports:o.airports,airport:o.from,runway:o.runway,destination:o.to,destinationRunway:o.toRunway,terrain:demSource(inland,o.delayMs)});
 await g.prepare();
 const sim=new DeterministicSimulation();sim.setGround(g.ground,g.landable);
 let w=sim.reset(defaultScenario(1n)),holds=0,rebases=0,phases:string[]=[];
 try{
  for(let t=0;t<(o.maxTicks??600_000);t++){
   const wait=g.ensureAround(w.aircraft.position.x,w.aircraft.position.z);if(wait){holds++;await wait;t--;continue}
   const target=g.routeTarget(w)!;if(phases.at(-1)!==target.mode)phases.push(target.mode);
   w=sim.step(steerTo(w,target));
   const moved=g.maybeRebase(w);if(moved){sim.restore(moved);w=moved;rebases++}
   if(w.objective.phase!=="COMPLETE"&&g.arrived(w)){w={...w,objective:{phase:"COMPLETE",checkpointReached:true}};sim.restore(w)}
   if(t%1200===0)o.log?.(w,g);
   if(w.objective.phase==="COMPLETE"||w.objective.phase==="FAILED")break;
  }
  return {w,g,holds,rebases,phases,checksum:await sim.checksum(),status:g.status({position:w.aircraft.position,velocity:w.aircraft.velocity,heading:w.aircraft.heading},w)};
 }finally{g.dispose()}
}
