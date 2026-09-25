// Architecture boundary audit (run by CI: `bun run audit:deps`).
//
//   simulation / packages ──X──> React, React DOM, React Three Fiber, Three.js, apps/*
//   presentation apps (React / R3F / Three.js) ──> @flight/protocol only
//   simulation Web Workers ──> any @flight package, but never React or Three.js
//
// With this rule the renderer can be replaced without touching the AI pilot, physics, learning,
// replay or world model: presentation code only ever sees protocol snapshots and telemetry.
import {readdir,readFile} from "node:fs/promises";import {existsSync} from "node:fs";import {join,relative,sep} from "node:path";
export const PRESENTATION_APPS=["apps/simulator","apps/control-room"];
const RENDER=/^(react|react-dom|three|@react-three\/.+|@types\/(react|react-dom|three))(\/.*)?$/;
// Legacy boundary: the core loop must not depend on decision providers or the world model.
const PROTECTED=["simulation","aircraft","safety"],PROTECTED_FORBIDDEN=["@flight/decision-open-jev","@flight/decision-jev","@flight/world-model"];
export interface Violation{file:string;rule:string;detail:string}
async function walk(d:string):Promise<string[]>{if(!existsSync(d))return[];const o:string[]=[];for(const x of await readdir(d,{withFileTypes:true})){if(x.name==="node_modules"||x.name===".git"||x.name==="dist")continue;const p=join(d,x.name);x.isDirectory()?o.push(...await walk(p)):o.push(p)}return o}
/** Module specifiers of static imports, re-exports, side-effect imports, dynamic import() and require(). */
export function importsOf(src:string):string[]{
 const code=src.replace(/\/\*[\s\S]*?\*\//g,"").replace(/(^|[^:"'`])\/\/.*$/gm,"$1");
 const out:string[]=[];const re=/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;let m;
 while((m=re.exec(code)))out.push(m[1]!);return out;
}
const source=(f:string)=>/\.(ts|tsx|mts|js|jsx|mjs)$/.test(f)&&!f.endsWith(".d.ts");
export async function auditDependencies(root:string):Promise<Violation[]>{
 const v:Violation[]=[],rel=(f:string)=>relative(root,f).split(sep).join("/");
 for(const f of (await walk(join(root,"packages"))).filter(source)){
  const r=rel(f);
  for(const s of importsOf(await readFile(f,"utf8"))){
   if(RENDER.test(s))v.push({file:r,rule:"core-no-renderer",detail:`imports ${s}`});
   if(s.includes("/apps/")||s.startsWith("apps/"))v.push({file:r,rule:"core-no-apps",detail:`imports ${s}`});
   const pkg=r.split("/")[1]!;if(PROTECTED.includes(pkg)&&PROTECTED_FORBIDDEN.some(x=>s===x||s.startsWith(x+"/")))v.push({file:r,rule:"protected-core",detail:`imports ${s}`});
  }
 }
 for(const m of (await walk(join(root,"packages"))).filter(f=>f.endsWith("package.json"))){
  const j=JSON.parse(await readFile(m,"utf8"));for(const k of ["dependencies","devDependencies","peerDependencies","optionalDependencies"])for(const d of Object.keys(j[k]??{}))if(RENDER.test(d))v.push({file:rel(m),rule:"core-no-renderer",detail:`declares ${d}`});
 }
 for(const app of PRESENTATION_APPS)for(const f of (await walk(join(root,app,"src"))).filter(source)){
  const r=rel(f),worker=/\.worker\.(ts|js)$/.test(f);
  for(const s of importsOf(await readFile(f,"utf8"))){
   if(worker){if(RENDER.test(s))v.push({file:r,rule:"worker-no-renderer",detail:`imports ${s}`});continue}
   if(s.startsWith("@flight/")&&s!=="@flight/protocol")v.push({file:r,rule:"presentation-protocol-only",detail:`imports ${s} (presentation code may only use @flight/protocol; run simulation in the worker)`});
   if(/(^|\/)packages\//.test(s))v.push({file:r,rule:"presentation-protocol-only",detail:`imports ${s} by path`});
  }
 }
 return v;
}
if(import.meta.main){
 const v=await auditDependencies(process.cwd());
 if(v.length){console.error("Dependency boundary violations:");for(const x of v)console.error(`  [${x.rule}] ${x.file}: ${x.detail}`);process.exit(1)}
 console.log("Dependency boundary OK (core ⟂ React/R3F/Three.js; presentation → @flight/protocol only)");
}
