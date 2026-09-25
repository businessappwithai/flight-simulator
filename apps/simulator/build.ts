// Static production build: dist/simulator/{index.html, assets…, sim.worker.js}. Usage: bun apps/simulator/build.ts
import {join} from "node:path";
export async function buildWorker():Promise<string>{
 const r=await Bun.build({entrypoints:[join(import.meta.dir,"src/sim.worker.ts")],target:"browser",format:"esm",minify:true});
 if(!r.success)throw new AggregateError(r.logs,"simulation worker build failed");
 return r.outputs[0]!.text();
}
if(import.meta.main){
 const out=join(import.meta.dir,"../../dist/simulator");
 const page=await Bun.build({entrypoints:[join(import.meta.dir,"index.html")],outdir:out,minify:true,target:"browser"});
 if(!page.success){console.error(page.logs);process.exit(1)}
 await Bun.write(join(out,"sim.worker.js"),await buildWorker());
 console.log(`built ${page.outputs.length+1} files into ${out}`);
}
