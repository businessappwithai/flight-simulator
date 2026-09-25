import { providerMemoryMatrix } from "@flight/experiments";
import { standardAblations } from "@flight/research";
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const [k,v]=x.replace(/^--/,"").split("=");return [k,v??true]}));
const seeds=Number(args.seeds??100);
const provider=(args.provider==="jev"?"jev":"open-jev") as "jev"|"open-jev";
const manifest={
 id:String(args.id??"research-local"),createdAt:new Date().toISOString(),seedCount:seeds,
 matrix:providerMemoryMatrix(),ablations:standardAblations({temporalMemory:true,experience:true,worldModel:true,skills:true,provider}),
 policy:{physicsMutable:false,safetyMutable:false,rewardMutable:false,promotionRulesMutable:false}
};
console.log(JSON.stringify(manifest,null,2));
