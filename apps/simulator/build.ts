// Static production build: dist/simulator/{index.html, assets…, sim.worker.js, xgb.worker.js}. Usage: bun apps/simulator/build.ts
import {join} from "node:path";
import type {BunPlugin} from "bun";
async function bundle(entry:string,plugins:BunPlugin[]=[]):Promise<string>{
 const r=await Bun.build({entrypoints:[join(import.meta.dir,entry)],target:"browser",format:"esm",minify:true,plugins});
 if(!r.success)throw new AggregateError(r.logs,`${entry} build failed`);
 return r.outputs[0]!.text();
}
export const buildWorker=()=>bundle("src/sim.worker.ts");
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
 console.log(`built ${page.outputs.length+2} files into ${out}`);
}
