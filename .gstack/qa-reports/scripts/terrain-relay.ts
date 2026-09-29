// Tile relay for browser QA in containers where Chromium cannot reach the data hosts directly:
//  - Terrarium terrain: fetches s3.amazonaws.com/elevation-tiles-prod tiles (through the environment's proxy),
//    cached on disk; open the simulator with &terrain=http://localhost:3300/{z}/{x}/{y}.png
//  - Baked features (scripts/bake-features.ts): serves *.pmtiles from --features-dir with HTTP Range and CORS;
//    open the simulator with &features=http://localhost:3300/features/<name>.pmtiles
//   bun .gstack/qa-reports/scripts/terrain-relay.ts [--port 3300] [--cache /tmp/terrarium] [--features-dir /tmp]
import {mkdir} from "node:fs/promises";
import {basename} from "node:path";
const arg=(k:string,d:string)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]!:d};
const port=Number(arg("--port","3300")),cache=arg("--cache","/tmp/terrarium"),featuresDir=arg("--features-dir","");let fetched=0,hits=0,ranges=0;
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"range","access-control-expose-headers":"content-range, content-length"};
const server=Bun.serve({port,async fetch(req){
 const path=new URL(req.url).pathname;
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 const f=/^\/features\/([\w.-]+\.pmtiles)$/.exec(path);
 if(f&&featuresDir){
  const file=Bun.file(`${featuresDir}/${basename(f[1]!)}`);if(!await file.exists())return new Response("not found",{status:404,headers:cors});
  const r=/^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range")??"");if(!r)return new Response(file,{headers:{...cors,"content-type":"application/octet-stream"}});
  const start=+r[1]!,end=Math.min(file.size-1,r[2]?+r[2]:file.size-1);ranges++;
  return new Response(file.slice(start,end+1),{status:206,headers:{...cors,"content-range":`bytes ${start}-${end}/${file.size}`,"content-type":"application/octet-stream"}});
 }
 const m=/^\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(path);if(!m)return new Response("not found",{status:404,headers:cors});
 const file=Bun.file(`${cache}/${m[1]}-${m[2]}-${m[3]}.png`),headers={...cors,"content-type":"image/png"};
 if(await file.exists()){hits++;return new Response(file,{headers})}
 const res=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${m[1]}/${m[2]}/${m[3]}.png`);
 if(!res.ok)return new Response(`upstream ${res.status}`,{status:res.status,headers});
 const body=new Uint8Array(await res.arrayBuffer());await mkdir(cache,{recursive:true});await Bun.write(file,body);fetched++;return new Response(body,{headers});
}});
console.log(`relay on http://localhost:${server.port}: terrain /{z}/{x}/{y}.png (cache ${cache})${featuresDir?`, features /features/*.pmtiles from ${featuresDir}`:""}`);
setInterval(()=>console.log(`relay: ${fetched} terrain fetched, ${hits} cached, ${ranges} feature ranges`),30000);
