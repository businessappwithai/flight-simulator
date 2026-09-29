// Regression: buildings and airport surfaces vanished along the flight path — above 900 m AGL the planner asked for
// them at the ring's z12 (vector features exist only at z14, so every request was dropped) and above 1,500 m AGL the
// layer was switched off. Found by /qa on 2026-09-29.
// Report: .gstack/qa-reports/qa-report-appwithai-org-2026-09-29.md
import {expect,test} from "bun:test";
import {GreatCircleRoute,destinationPoint,haversineDistance,lonLatToTile,planTiles,tileCenter,type TileRequest} from "@flight/geospatial";

const chennai={lat:13.06,lon:80.25,altMsl:0},v={groundSpeedMps:85,trackDeg:270,verticalSpeedMps:0};
const of=(r:TileRequest[],layer:string)=>r.filter(q=>q.layer===layer);
test("buildings and airport surfaces are requested at their own zoom (z14) at any height they are shown",()=>{
 for(const agl of [150,1200,2500]){
  const r=planTiles({position:chennai,velocity:v,aglM:agl,layers:["terrain","buildings","airports"]}),b=of(r,"buildings"),a=of(r,"airports");
  expect(b.length).toBeGreaterThan(20);expect(a.length).toBeGreaterThan(b.length);
  for(const q of [...b,...a])expect(q.tile.z).toBe(14);
  // Within reach: buildings 6 km, airports 10 km (plus the tile under and ahead of the aircraft).
  for(const q of b.filter(q=>q.priority<90))expect(q.distanceM).toBeLessThanOrEqual(6000);
  // Terrain keeps its ring zooms.
  expect(new Set(of(r,"terrain").map(q=>q.tile.z)).size).toBeGreaterThan(2);
 }
 // Airliner heights: no buildings (the altitude policy), airport surfaces still at z14.
 const high=planTiles({position:chennai,velocity:v,aglM:3500,layers:["terrain","buildings","airports"]});
 expect(of(high,"buildings")).toHaveLength(0);for(const q of of(high,"airports"))expect(q.tile.z).toBe(14);
});
test("the destination's runways are requested in full detail through the whole approach",()=>{
 const dest={lat:13.07,lon:79.69,altMsl:0},route=new GreatCircleRoute([chennai,dest],10_000);
 for(const out of [25_000,8000]){
  const p={...destinationPoint(dest,80,out),altMsl:0},r=planTiles({position:p,velocity:v,aglM:900,layers:["terrain","airports"],route});
  const near=of(r,"airports").filter(q=>haversineDistance(tileCenter(q.tile),dest)<3000);
  expect(near.length).toBeGreaterThanOrEqual(4);for(const q of near)expect(q.tile.z).toBe(14);
  const home=lonLatToTile(dest.lon,dest.lat,14);expect(of(r,"airports").some(q=>q.tile.x===home.x&&q.tile.y===home.y)).toBe(true);
 }
});
