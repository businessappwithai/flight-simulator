// Static production build: dist/simulator/{index.html, assets…, sim.worker.js, xgb.worker.js, airports-catalog.json.gz, sw.js}. Usage: bun apps/simulator/build.ts
import {join,relative} from "node:path";
import type {BunPlugin} from "bun";
async function bundle(entry:string,plugins:BunPlugin[]=[]):Promise<string>{
 const r=await Bun.build({entrypoints:[join(import.meta.dir,entry)],target:"browser",format:"esm",minify:true,plugins});
 if(!r.success)throw new AggregateError(r.logs,`${entry} build failed`);
 return r.outputs[0]!.text();
}
export const buildWorker=()=>bundle("src/sim.worker.ts");
/** The app-shell service worker (sw.js), with the files it precaches and a version that retires older caches. */
export async function buildServiceWorker(precache:string[],version:string){
 const r=await Bun.build({entrypoints:[join(import.meta.dir,"src/app-shell.sw.ts")],target:"browser",format:"esm",minify:true,define:{PRECACHE:JSON.stringify(precache),VERSION:JSON.stringify(version)}});
 if(!r.success)throw new AggregateError(r.logs,"service worker build failed");
 return r.outputs[0]!.text();
}
// The XGBoost WebAssembly glue has a Node-only `require("ws")` that browsers never reach; bundle it as empty.
const nodeOnly:BunPlugin={name:"node-only-stubs",setup(b){b.onResolve({filter:/^ws$/},a=>({path:a.path,namespace:"node-only"}));b.onLoad({filter:/.*/,namespace:"node-only"},()=>({contents:"module.exports={}",loader:"js"}))}};
/** The in-browser XGBoost best-practice worker (WebAssembly), loaded by the simulation worker only when the copilot needs it. */
export const buildXgbWorker=()=>bundle("../../packages/experience/src/xgboost.worker.ts",[nodeOnly]);
if(import.meta.main){
 const out=join(import.meta.dir,"../../dist/simulator");
 const page=await Bun.build({entrypoints:[join(import.meta.dir,"index.html")],outdir:out,minify:true,target:"browser"});
 if(!page.success){console.error(page.logs);process.exit(1)}
 await Bun.write(join(out,"sim.worker.js"),await buildWorker());
 await Bun.write(join(out,"xgb.worker.js"),await buildXgbWorker());
 await Bun.write(join(out,"airports-catalog.json.gz"),Bun.file(join(import.meta.dir,"../../packages/geospatial/data/airports-catalog.json.gz")));
 // Precache the page, its bundles, the simulation worker and the airport catalogue (the 6 MB XGBoost worker is cached on first use).
 const files=["./",...page.outputs.map(o=>relative(out,o.path)).filter(f=>f!=="index.html"),"sim.worker.js","airports-catalog.json.gz"];
 const version=Bun.hash(files.join("|")+(await Bun.file(join(out,"sim.worker.js")).text()).length).toString(36);
 await Bun.write(join(out,"sw.js"),await buildServiceWorker(files,version));
 console.log(`built ${page.outputs.length+4} files into ${out}`);
}
