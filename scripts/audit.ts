import {readdir} from "node:fs/promises";import {join} from "node:path";
async function walk(d:string):Promise<string[]>{const out:string[]=[];for(const x of await readdir(d,{withFileTypes:true})){if(x.name==="node_modules"||x.name===".git")continue;const p=join(d,x.name);x.isDirectory()?out.push(...await walk(p)):out.push(p)}return out}
const files=(await walk(".")).filter(x=>x.endsWith(".ts"));
const forbidden=[];for(const f of files){const t=await Bun.file(f).text();if(/Math\.random\s*\(/.test(t)&&/(packages\/simulation|packages\/world|packages\/sensors|packages\/scenario-generator)/.test(f))forbidden.push(f)}
if(forbidden.length){console.error("Forbidden Math.random:",forbidden);process.exit(1)}
console.log(JSON.stringify({typescriptFiles:files.length,forbiddenRandom:0},null,2));
