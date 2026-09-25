// Dev/preview server for the 3D simulator: serves the page (Bun HTML bundler) and the simulation worker as a
// separately bundled module at ./sim.worker.js. Usage: bun apps/simulator/serve.ts [--port 3200]
import index from "./index.html";
import {buildWorker} from "./build.ts";
const arg=process.argv.indexOf("--port"),port=Number(arg>0?process.argv[arg+1]:process.env.PORT??3200);
const server=Bun.serve({port,development:process.env.NODE_ENV!=="production",routes:{
 "/":index,
 // Rebuilt per request so edits to the simulation are picked up without restarting.
 "/sim.worker.js":async()=>{try{return new Response(await buildWorker(),{headers:{"content-type":"text/javascript; charset=utf-8","cache-control":"no-store"}})}
  catch(e){console.error(e);return new Response(`postMessage({type:"ERROR",message:${JSON.stringify(`worker build failed: ${e instanceof Error?e.message:String(e)}`)}})`,{headers:{"content-type":"text/javascript"}})}}
}});
console.log(`Flight World simulator: ${server.url}`);
