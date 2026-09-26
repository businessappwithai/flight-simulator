// Dev/preview server for the 3D simulator: serves the page (Bun HTML bundler) and the simulation worker as a
// separately bundled module at ./sim.worker.js. Usage: bun apps/simulator/serve.ts [--port 3200]
// The Control Room is served at /control-room/ (as on GitHub Pages) so the simulator's Learning Lab button works here too.
import index from "./index.html";
import controlRoom from "../control-room/index.html";
import {buildWorker,buildXgbWorker} from "./build.ts";
import {buildLabWorker} from "../control-room/build.ts";
let lab:{at:number;js:string}|undefined;
// The XGBoost worker is large (WebAssembly) and does not change with the simulation: build it once.
let xgb:Promise<string>|undefined;
const arg=process.argv.indexOf("--port"),port=Number(arg>0?process.argv[arg+1]:process.env.PORT??3200);
const server=Bun.serve({port,development:process.env.NODE_ENV!=="production",routes:{
 "/":index,
 "/control-room":Response.redirect("/control-room/",301),
 "/control-room/":controlRoom,
 "/control-room/lab.worker.js":async()=>{try{if(!lab||Date.now()-lab.at>2000)lab={at:Date.now(),js:await buildLabWorker()};return new Response(lab.js,{headers:{"content-type":"text/javascript; charset=utf-8","cache-control":"no-store"}})}
  catch(e){console.error(e);return new Response(`postMessage({type:"ERROR",message:${JSON.stringify(`lab worker build failed: ${e instanceof Error?e.message:String(e)}`)}})`,{headers:{"content-type":"text/javascript"}})}},
 // Rebuilt per request so edits to the simulation are picked up without restarting.
 "/xgb.worker.js":async()=>{try{return new Response(await (xgb??=buildXgbWorker()),{headers:{"content-type":"text/javascript; charset=utf-8"}})}
  catch(e){xgb=undefined;console.error(e);return new Response(`postMessage({type:"ERROR",message:${JSON.stringify(`xgboost worker build failed: ${e instanceof Error?e.message:String(e)}`)}})`,{headers:{"content-type":"text/javascript"}})}},
 "/sim.worker.js":async()=>{try{return new Response(await buildWorker(),{headers:{"content-type":"text/javascript; charset=utf-8","cache-control":"no-store"}})}
  catch(e){console.error(e);return new Response(`postMessage({type:"ERROR",message:${JSON.stringify(`worker build failed: ${e instanceof Error?e.message:String(e)}`)}})`,{headers:{"content-type":"text/javascript"}})}}
}});
console.log(`Flight World simulator: ${server.url}  ·  Learning Lab: ${server.url}control-room/#lab`);
