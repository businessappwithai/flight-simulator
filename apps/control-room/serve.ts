// Control Room dev/preview server: the page plus the Learning Lab worker at ./lab.worker.js. bun apps/control-room/serve.ts [--port 3100]
import index from "./index.html";
import {buildLabWorker} from "./build.ts";
const arg=process.argv.indexOf("--port"),port=Number(arg>0?process.argv[arg+1]:process.env.PORT??3100);
let cache:{at:number;js:string}|undefined;
const server=Bun.serve({port,development:process.env.NODE_ENV!=="production",routes:{
 "/":index,
 "/lab.worker.js":async()=>{try{if(!cache||Date.now()-cache.at>2000)cache={at:Date.now(),js:await buildLabWorker()};return new Response(cache.js,{headers:{"content-type":"text/javascript; charset=utf-8","cache-control":"no-store"}})}
  catch(e){console.error(e);return new Response(`postMessage({type:"ERROR",message:${JSON.stringify(`lab worker build failed: ${e instanceof Error?e.message:String(e)}`)}})`,{headers:{"content-type":"text/javascript"}})}}
}});
console.log(`Flight World Control Room: ${server.url}`);
