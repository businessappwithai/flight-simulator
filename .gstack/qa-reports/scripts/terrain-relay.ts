// Terrarium tile relay for browser QA in containers where Chromium cannot reach AWS directly: fetches
// s3.amazonaws.com/elevation-tiles-prod tiles (through the environment's proxy) and caches them on disk.
//   bun .gstack/qa-reports/scripts/terrain-relay.ts [--port 3300] [--cache /tmp/terrarium]
// Then open the simulator with &terrain=http://localhost:3300/{z}/{x}/{y}.png
import {mkdir} from "node:fs/promises";
const arg=(k:string,d:string)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]!:d};
const port=Number(arg("--port","3300")),cache=arg("--cache","/tmp/terrarium");let fetched=0,hits=0;
const server=Bun.serve({port,async fetch(req){
 const m=/^\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(new URL(req.url).pathname);if(!m)return new Response("not found",{status:404});
 const file=Bun.file(`${cache}/${m[1]}-${m[2]}-${m[3]}.png`),headers={"content-type":"image/png","access-control-allow-origin":"*"};
 if(await file.exists()){hits++;return new Response(file,{headers})}
 const res=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${m[1]}/${m[2]}/${m[3]}.png`);
 if(!res.ok)return new Response(`upstream ${res.status}`,{status:res.status,headers});
 const body=new Uint8Array(await res.arrayBuffer());await mkdir(cache,{recursive:true});await Bun.write(file,body);fetched++;return new Response(body,{headers});
}});
console.log(`terrain relay on http://localhost:${server.port}/{z}/{x}/{y}.png (cache ${cache})`);
setInterval(()=>console.log(`relay: ${fetched} fetched, ${hits} cached`),30000);
