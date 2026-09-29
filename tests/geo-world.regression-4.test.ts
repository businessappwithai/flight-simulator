// Regression: ISSUE-011 — one failed feature tile around the destination threw away the destination's surveyed runway
// (the route then aimed at the catalogue's runway position instead). Found by /qa on 2026-09-29.
// Report: .gstack/qa-reports/qa-report-appwithai-org-2026-09-29.md
import {expect,test} from "bun:test";
import {GeoWorld,haversineDistance,lonLatToTile,tileBounds,tileKey,type TileId,type VectorFeatures,type VectorSources} from "@flight/geospatial";
import {catalogIndex,demSource,inland} from "./geo-route.helpers.ts";

const catalog=catalogIndex(),voar=catalog.require("VOAR"),rw=voar.runways[0]!,le=rw.le.position!,he=rw.he.position!;
// The surveyed centreline of 06/24, 100 m north of where the catalogue puts it.
const shift=100/111_000,line:[number,number][]=[[le.lon,le.lat+shift],[he.lon,he.lat+shift]];
const tileCentre=(t:TileId)=>{const b=tileBounds(t);return {lat:(b.north+b.south)/2,lon:(b.east+b.west)/2}};
const home=tileKey(lonLatToTile(voar.position.lon,voar.position.lat,14));
function source():VectorSources{
 const load=async(t:TileId):Promise<VectorFeatures>=>{const k=tileKey(t);
  if(k===home)return {tile:t,buildings:[],aeroways:[{id:"rw",kind:"runway",ref:"06/24",line,widthM:45}],byteLength:1};
  // Every other tile around the destination fails (a flaky tile server); the departure's tiles load (empty).
  if(haversineDistance({lat:voar.position.lat,lon:voar.position.lon},tileCentre(t))<6000)throw new Error(`HTTP 503 for ${k}`);
  return {tile:t,buildings:[],aeroways:[],byteLength:0}};
 const layer=(l:"buildings"|"airports")=>({layer:l,maxZoom:14,minZoom:13,load,sizeOf:()=>2048});
 return {load,buildings:layer("buildings"),airports:layer("airports"),url:"https://example.test/tiles"};
}
test("failed feature tiles around the destination do not throw away its surveyed runway",async()=>{
 const g=new GeoWorld({airports:catalog,airport:"VOMM",runway:"07",destination:"VOAR",destinationRunway:"24",terrain:demSource(inland),features:source(),surveyTimeoutMs:5000});
 await g.prepare();
 const d=g.destinationRunway!;expect(d.runway).toBe("24");expect(d.synthesized).toBe(false);
 // The surveyed threshold (24 end of the shifted line), not the catalogue's.
 expect(haversineDistance(d.anchor,{lat:line[1]![1],lon:line[1]![0]})).toBeLessThan(5);
 g.dispose();
});
