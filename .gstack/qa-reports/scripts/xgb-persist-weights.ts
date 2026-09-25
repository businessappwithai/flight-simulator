import {XGBoostBestPracticeClient} from "@flight/experience";
const waitFor=(c:XGBoostBestPracticeClient,t:string)=>new Promise<any>(r=>c.worker.addEventListener("message",(e:any)=>{if(e.data.type===t)r(e.data)}));
// 1) persistence: train → bytes → LOAD into a fresh worker → predict
const a=new XGBoostBestPracticeClient();
const ex=Array.from({length:200},(_,i)=>({features:[i%2?1:-1,0],action:(i%2?"CLIMB":"SLOW") as any,reward:1,regret:0,success:true,safetyOverride:false,catastrophic:false}));
const trained=waitFor(a,"TRAINED");a.train("v1",ex);const {bytes}=await trained;
const pa=await a.predict([1,0]);a.dispose();
const b=new XGBoostBestPracticeClient();const loaded=waitFor(b,"LOADED");b.load("v1",bytes);await loaded;
const pb=await b.predict([1,0]);b.dispose();
console.log(`persist: bundle=${bytes.byteLength}B original=${pa[0].action}@${pa[0].probability.toFixed(4)} reloaded=${pb[0].action}@${pb[0].probability.toFixed(4)} activeVersion=${b.activeVersion}`);
// 2) sample weights: identical features, 10 CLIMB successes (w≈4) vs 10 DESCEND catastrophes (w=12)
const c=new XGBoostBestPracticeClient();
const mix=[...Array.from({length:10},()=>({features:[0,0],action:"CLIMB" as any,reward:1,regret:0,success:true,safetyOverride:false,catastrophic:false})),
 ...Array.from({length:10},()=>({features:[0,0],action:"DESCEND" as any,reward:-5,regret:10,success:false,safetyOverride:true,catastrophic:true}))];
const t2=waitFor(c,"TRAINED");c.train("w",mix);await t2;const pc=await c.predict([0,0]);c.dispose();
console.log("weights: top2 =",pc.slice(0,2).map(x=>`${x.action}@${x.probability.toFixed(3)}`).join(", "),"(if trainingWeight were applied, DESCEND would dominate ~12:4)");
process.exit(0);
