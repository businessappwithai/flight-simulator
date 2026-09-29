// Builds packages/geospatial/data/airports-catalog.json.gz from the public-domain OurAirports CSVs.
//   bun scripts/build-airport-catalog.ts [airports.csv runways.csv]   (default: download from GitHub)
// The simulator serves it next to sim.worker.js; the worker loads it in the background for airport search.
import {gzipSync} from "node:zlib";
import {catalogFilter,encodeCatalog,parseOurAirports} from "@flight/geospatial";
const SRC="https://raw.githubusercontent.com/davidmegginson/ourairports-data/main";
const [aPath,rPath]=process.argv.slice(2);
const text=async(path:string|undefined,name:string)=>path?Bun.file(path).text():(await fetch(`${SRC}/${name}`).then(r=>{if(!r.ok)throw new Error(`${name}: HTTP ${r.status}`);return r.text()}));
const airports=parseOurAirports(await text(aPath,"airports.csv"),await text(rPath,"runways.csv")).filter(a=>catalogFilter(a));
airports.sort((a,b)=>a.ident<b.ident?-1:1);
const json=JSON.stringify(encodeCatalog(airports,"OurAirports (public domain) — https://ourairports.com/data/",new Date().toISOString().slice(0,10)));
const out=new URL("../packages/geospatial/data/airports-catalog.json.gz",import.meta.url).pathname;
await Bun.write(out,gzipSync(json,{level:9}));
console.log(`${out}: ${airports.length} airports, ${(json.length/1e6).toFixed(1)} MB JSON, ${(gzipSync(json,{level:9}).length/1e6).toFixed(2)} MB gzipped`);
