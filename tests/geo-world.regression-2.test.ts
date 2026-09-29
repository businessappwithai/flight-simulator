// Regression: ISSUE-008 — one slow or failed building tile before the flight switched buildings and airport surfaces
// off for the whole flight ("unavailable"), although the source was up. Found by /qa on 2026-09-29.
// Report: .gstack/qa-reports/qa-report-appwithai-org-2026-09-29.md
import {expect,test} from "bun:test";
import {GeoWorld,tileKey,type TileId,type VectorFeatures,type VectorSources} from "@flight/geospatial";
import {catalogIndex,demSource,inland} from "./geo-route.helpers.ts";

const catalog=catalogIndex();
function flakySource(fail:(t:TileId,n:number)=>boolean):VectorSources&{calls:Map<string,number>}{
 const calls=new Map<string,number>();
 const load=async(t:TileId):Promise<VectorFeatures>=>{const k=tileKey(t),n=(calls.get(k)??0)+1;calls.set(k,n);
  if(fail(t,n))throw new Error(`HTTP 503 for ${k}`);return {tile:t,buildings:[],aeroways:[],byteLength:0}};
 const layer=(l:"buildings"|"airports")=>({layer:l,maxZoom:14,minZoom:13,load,sizeOf:()=>2048});
 return {load,buildings:layer("buildings"),airports:layer("airports"),url:"https://example.test/tiles",calls};
}
test("a building tile that fails before the flight does not switch buildings off; it is retried when needed",async()=>{
 let first:string|undefined;
 const src=flakySource((t,n)=>{const k=tileKey(t);first??=k;return k===first&&n===1});
 const g=new GeoWorld({airports:catalog,airport:"VOMM",runway:"07",terrain:demSource(inland),features:src,surveyTimeoutMs:5000});
 await g.prepare();
 expect(g.featuresState).toBe("READY");expect(g.featuresDetail).toBeUndefined();
 g.dispose();
});
test("a source that answers nothing is still reported unavailable",async()=>{
 const g=new GeoWorld({airports:catalog,airport:"VOMM",runway:"07",terrain:demSource(inland),features:flakySource(()=>true),surveyTimeoutMs:5000});
 await g.prepare();
 expect(g.featuresState).toBe("UNAVAILABLE");expect(g.featuresDetail).toContain("HTTP 503");
 g.dispose();
});
