import {gunzipSync} from "node:zlib";
import {readFileSync} from "node:fs";
import {AirportIndex,TerrainTile,decodeCatalog,tileBounds,type TileSource} from "@flight/geospatial";

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
