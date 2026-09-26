// Dev/preview server for the 3D simulator: serves the page (Bun HTML bundler) and the simulation worker as a
// separately bundled module at ./sim.worker.js. Usage: bun apps/simulator/serve.ts [--port 3200]
import index from "./index.html";
import {buildWorker,buildXgbWorker} from "./build.ts";
// The XGBoost worker is large (WebAssembly) and does not change with the simulation: build it once.
let xgb:Promise<string>|undefined;
const arg=process.argv.indexOf("--port"),port=Number(arg>0?process.argv[arg+1]:process.env.PORT??3200);
const server=Bun.serve({port,development:process.env.NODE_ENV!=="production",routes:{
 "/":index,
 // Rebuilt per request so edits to the simulation are picked up without restarting.
 "/xgb.worker.js":async()=>{try{return new Response(await (xgb??=buildXgbWorker()),{headers:{"content-type":"text/javascript; charset=utf-8"}})}
  catch(e){xgb=undefined;console.error(e);return new Response(`postMessage({type:"ERROR",message:${JSON.stringify(`xgboost worker build failed: ${e instanceof Error?e.message:String(e)}`)}})`,{headers:{"content-type":"text/javascript"}})}},
 "/sim.worker.js":async()=>{try{return new Response(await buildWorker(),{headers:{"content-type":"text/javascript; charset=utf-8","cache-control":"no-store"}})}
  catch(e){console.error(e);return new Response(`postMessage({type:"ERROR",message:${JSON.stringify(`worker build failed: ${e instanceof Error?e.message:String(e)}`)}})`,{headers:{"content-type":"text/javascript"}})}}
}});
console.log(`Flight World simulator: ${server.url}`);
