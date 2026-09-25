import {XGBoostBestPracticeClient,ACTIONS} from "@flight/experience";
const withTimeout=<T>(p:Promise<T>,ms:number)=>Promise.race([p,new Promise<string>(r=>setTimeout(()=>r(`TIMEOUT after ${ms}ms`),ms))]);
const c=new XGBoostBestPracticeClient();
const events:any[]=[];c.worker.addEventListener("message",(e:any)=>events.push(e.data.type+(e.data.message?`: ${e.data.message}`:"")));
console.log("predict-before-train:",JSON.stringify(await withTimeout(c.predict([0,0,0]).catch(e=>"REJECTED: "+e.message),3000)));events.length=0;
// synthetic data: feature[0] high → CLIMB, low → TURN_LEFT
const ex=Array.from({length:400},(_,i)=>{const hi=i%2===0;return {features:[hi?1+Math.random():-1-Math.random(),Math.random(),Math.random()],action:(hi?"CLIMB":"TURN_LEFT") as any,reward:1,regret:0,success:true,safetyOverride:false,catastrophic:false}});
const t0=performance.now();c.train("v1",ex);
while(!events.some(x=>x.startsWith("TRAINED")||x.startsWith("ERROR"))&&performance.now()-t0<60000)await Bun.sleep(50);
console.log("train:",events.at(-1),`${(performance.now()-t0).toFixed(0)}ms`);
const hi=await withTimeout(c.predict([1.5,.5,.5]),5000),lo=await withTimeout(c.predict([-1.5,.5,.5]),5000);
console.log("predict hi:",JSON.stringify((hi as any).slice?.(0,2)??hi));console.log("predict lo:",JSON.stringify((lo as any).slice?.(0,2)??lo));
console.log("events:",events.join(" | "));c.dispose();process.exit(0);
