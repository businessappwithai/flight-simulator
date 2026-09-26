// Control Room builds. The Learning Lab worker runs XGBoost (WASM) in the browser: @wlearn/xgboost is resolved to its
// self-contained browser build (dist/xgboost.mjs) because the default entry pulls in Node-only modules.
import {join,dirname} from "node:path";
const root=join(import.meta.dir,"../..");
const xgboostBrowser={name:"xgboost-browser",setup(b:any){
 b.onResolve({filter:/^@wlearn\/xgboost$/},()=>({path:join(dirname(Bun.resolveSync("@wlearn/xgboost/package.json",root)),"dist/xgboost.mjs")}));
 // The SQLite experience store is Bun-only; the lab uses the in-memory store. Fail loudly if anything tries to use it here.
 b.onResolve({filter:/^bun:sqlite$/},()=>({path:"bun-sqlite-stub",namespace:"stub"}));
 b.onLoad({filter:/.*/,namespace:"stub"},()=>({contents:'export class Database{constructor(){throw new Error("SQLite experience storage is not available in the browser")}}',loader:"js"}));
}};
export async function buildLabWorker():Promise<string>{
 const r=await Bun.build({entrypoints:[join(import.meta.dir,"src/lab.worker.ts")],target:"browser",format:"esm",minify:true,plugins:[xgboostBrowser]});
 if(!r.success)throw new AggregateError(r.logs,"lab worker build failed");
 return r.outputs[0]!.text();
}
if(import.meta.main){
 const out=join(root,"dist/control-room");
 const page=await Bun.build({entrypoints:[join(import.meta.dir,"index.html")],outdir:out,minify:true,target:"browser"});
 if(!page.success){console.error(page.logs);process.exit(1)}
 await Bun.write(join(out,"lab.worker.js"),await buildLabWorker());
 console.log(`built ${page.outputs.length+1} files into ${out}`);
}
