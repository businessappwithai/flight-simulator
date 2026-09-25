import {providerMemoryMatrix} from "@flight/experiments";
import {defaultScenario,DeterministicSimulation} from "@flight/simulation";
const count=Number(Bun.argv[2]??"100");
const variants=providerMemoryMatrix();
const seeds=Array.from({length:count},(_,i)=>BigInt(i+1));
const manifest={id:`matrix-${count}`,createdAt:new Date().toISOString(),variants,seeds:seeds.map(String)};
await Bun.write(`experiments/${manifest.id}.json`,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({experiment:manifest.id,variants:variants.length,seeds:seeds.length,plannedRuns:variants.length*seeds.length},null,2));
