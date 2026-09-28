// Fly a great-circle route between two airports through the geospatial layer and report what streams.
//
//   bun scripts/geo-flight.ts VOMM VIDP            # synthetic tile source (offline, instant)
//   bun scripts/geo-flight.ts VOMM VIDP --live     # real Mapzen Terrarium tiles from AWS Open Data
//
// Airports come from the bundled OurAirports-format sample (sample-airports.ts) unless GEO_AIRPORTS / GEO_RUNWAYS point at the full CSVs.
import {inflateSync} from "node:zlib";
import {
 AirportIndex,FloatingOrigin,SAMPLE_AIRPORTS_CSV,SAMPLE_RUNWAYS_CSV,SIM_ZOOM,SimulationWorld,TerrainTile,WorldStreamer,attributionFor,decodePng,extractSimulationTile,geoSituation,
 initialBearing,lonLatToTile,parseOurAirports,planAirportRoute,terrariumSource,tileKey,type TileSource,
} from "@flight/geospatial";

const [fromCode="VOMM",toCode="VIDP"]=process.argv.slice(2).filter(a=>!a.startsWith("--")),live=process.argv.includes("--live");
const index=new AirportIndex(parseOurAirports(process.env.GEO_AIRPORTS?await Bun.file(process.env.GEO_AIRPORTS).text():SAMPLE_AIRPORTS_CSV,process.env.GEO_RUNWAYS?await Bun.file(process.env.GEO_RUNWAYS).text():SAMPLE_RUNWAYS_CSV));
const from=index.require(fromCode),to=index.require(toCode),route=planAirportRoute(from,to);

const decode=(png:Uint8Array)=>decodePng(png,d=>new Uint8Array(inflateSync(d)));
const synthetic:TileSource<TerrainTile>={layer:"terrain",maxZoom:15,sizeOf:t=>t.byteLength,
 load:async tile=>new TerrainTile(tile,32,32,new Float32Array(32*32).fill(100))};
const terrain:TileSource<TerrainTile>=live?terrariumSource({decode}):synthetic;
const buildings:TileSource<null>={layer:"buildings",maxZoom:14,minZoom:12,load:async()=>null,sizeOf:()=>64*1024};

const streamer=new WorldStreamer({sources:[terrain,buildings],maxConcurrent:live?8:64,cacheBytes:256*1024*1024,onError:(r,e)=>console.warn(`  ! ${r.key}: ${e}`)});
const origin=new FloatingOrigin(from.position),world=new SimulationWorld();
const speedAt=(alt:number)=>alt<3000?90:alt<8000?180:231;
console.log(`${from.ident} → ${to.ident}: ${(route.totalM/1000).toFixed(0)} km great circle, ${route.waypoints.length} waypoints, terrain ${live?"live (Mapzen Terrarium)":"synthetic"}`);
let t=0,along=0,rebases=0,maxWanted=0,buildingsSeen=0;
const t0=performance.now();
while(along<route.totalM){
 const p=route.pointAt(along),next=route.pointAt(Math.min(route.totalM,along+1000)),speed=speedAt(p.altMsl),track=initialBearing(p,next);
 const ground=world.elevationAt(p.lat,p.lon)??0;
 const u=streamer.update(p,{groundSpeedMps:speed,trackDeg:track,verticalSpeedMps:0},route,p.altMsl-ground);
 maxWanted=Math.max(maxWanted,u.wanted);buildingsSeen+=streamer.wanted().filter(r=>r.layer==="buildings").length?1:0;
 if(origin.update(p).rebased)rebases++;
 await streamer.idle();
 // Simulation world: the z12 tile under the aircraft, down-sampled from whatever terrain tile covers it.
 const simTile=lonLatToTile(p.lon,p.lat,SIM_ZOOM);
 // Deepest streamed DEM covering it: z14 near the ground, z10/z8 at cruise (coarser, but never guessed).
 if(!world.has(simTile))for(const z of [14,12,10,8]){const dem=streamer.get<TerrainTile>("terrain",lonLatToTile(p.lon,p.lat,z));if(dem){world.add(extractSimulationTile(simTile,dem));break}}
 if(t%600===0){
  const s=geoSituation(world,index,p,{groundSpeedMps:speed,trackDeg:track,verticalSpeedMps:0},route);
  console.log(`t=${String(t).padStart(5)}s ${(along/1000).toFixed(0).padStart(5)} km alt ${p.altMsl.toFixed(0).padStart(5)} m  terrain ${s.terrainElevationM?.toFixed(0)??"?"} m  wanted ${u.wanted} tiles  cache ${(streamer.stats().cache.bytes/1e6).toFixed(1)} MB  alternates ${s.alternates.map(a=>`${a.ident} ${(a.distanceM/1000).toFixed(0)}km`).join(", ")}`);
 }
 t+=30;along+=speed*30;
}
const st=streamer.stats();
console.log(`\nflight ${(t/3600).toFixed(2)} h simulated in ${((performance.now()-t0)/1000).toFixed(1)} s; floating-origin rebases ${rebases}; max wanted set ${maxWanted}`);
console.log(`tiles loaded ${st.loaded}, failed ${st.failed}, aborted ${st.aborted}, evicted ${st.cache.evictions}; cache ${st.cache.entries} tiles / ${(st.cache.bytes/1e6).toFixed(1)} MB`);
console.log(`buildings requested on ${buildingsSeen} of ${t/30} updates (low altitude only)`);
console.log(`simulation world: ${world.size} z${SIM_ZOOM} tiles, checksum ${(await world.checksum()).slice(0,16)}…`);
console.log(`attribution: ${attributionFor(live?["terrain","airports"]:["airports"]).join(" | ")}`);
streamer.dispose();
