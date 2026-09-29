import {expect,test} from "bun:test";
import {AirportIndex,GeoWorld,SAMPLE_AIRPORTS_CSV,SAMPLE_RUNWAYS_CSV,parseOurAirports,type TerrainTile,type TileSource} from "@flight/geospatial";
// Regression: ISSUE-001 — with terrain unreachable, tiles that were still retrying after prepare() gave up overwrote
// "Real terrain unavailable…" with "Terrain tile … unavailable; treated as sea level" on the start card.
// Found by /qa on 2026-09-29
// Report: .gstack/qa-reports/qa-report-flight-world-2026-09-29.md
test("unreachable terrain keeps the whole-world explanation and adds no sea-level tiles",async()=>{
 let calls=0;
 // The first tile fails at once; the others fail only after prepare() has already given up.
 const terrain:TileSource<TerrainTile>={layer:"terrain",maxZoom:15,sizeOf:()=>1,load:async()=>{const n=calls++;await Bun.sleep(n===0?0:30);throw new Error("offline")}};
 const g=new GeoWorld({airports:new AirportIndex(parseOurAirports(SAMPLE_AIRPORTS_CSV,SAMPLE_RUNWAYS_CSV)),airport:"VNKT",terrain,simRetries:1});
 await g.prepare();expect(g.state).toBe("ERROR");
 await Bun.sleep(150);
 expect(calls).toBeGreaterThan(1);
 expect(g.detail).toStartWith("Real terrain unavailable");
 expect(g.simulationWorld.size).toBe(0);
 g.dispose();
});
