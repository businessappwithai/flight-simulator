import {readdir} from "node:fs/promises";import {existsSync} from "node:fs";import {join} from "node:path";
async function walk(d:string):Promise<string[]>{const o:string[]=[];for(const x of await readdir(d,{withFileTypes:true})){const p=join(d,x.name);x.isDirectory()?o.push(...await walk(p)):o.push(p)}return o}
const protectedPkgs=["simulation","aircraft","safety"];
const forbidden=["decision-open-jev","decision-jev","world-model"];
const bad:string[]=[];
for(const pkg of protectedPkgs.filter(p=>existsSync(`packages/${p}`)))for(const f of (await walk(`packages/${pkg}`)).filter(x=>x.endsWith(".ts"))){const t=await Bun.file(f).text();if(forbidden.some(x=>t.includes(x)))bad.push(f)}
if(bad.length){console.error(bad);process.exit(1)}console.log("Dependency boundary OK");
