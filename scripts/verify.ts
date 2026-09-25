import {spawn} from "bun";
const commands=[["bun","run","audit"],["bun","test"],["bun","run","benchmark","100"],["bun","run","research"]];
for(const cmd of commands){
 const p=spawn(cmd,{stdout:"inherit",stderr:"inherit"});const code=await p.exited;
 if(code!==0){console.error(`FAILED: ${cmd.join(" ")}`);process.exit(code)}
}
console.log("Flight World verification complete.");
