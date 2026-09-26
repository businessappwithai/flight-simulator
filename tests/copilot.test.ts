import {expect,test} from "bun:test";
import type {JevTransport} from "@flight/decision-jev";
import type {LearningBook,Observation,PilotIntent} from "@flight/protocol";
import {Copilot,ADVICE_EVERY_TICKS,ERROR_BACKOFF_TICKS,MIN_TRAINING_EXAMPLES} from "@flight/copilot";
import {XGBoostBestPracticeClient} from "@flight/experience/xgboost-client";
import {observationFeatures} from "@flight/cognition";
import {emptyBook} from "@flight/learning";
const obs:Observation={tick:120n,speed:30,altitude:40,heading:0,objectivePhase:"OUTBOUND",nearestObstacle:{distance:300,bearing:.2},attitude:{pitch:0,roll:0,verticalSpeed:0}};
/** Stand-in Jev: fixed probabilities, or an error. */
const jev=(p:Partial<Record<PilotIntent,number>>|Error,calls:{n:number}={n:0}):((k:string)=>JevTransport)=>()=>({invoke:async r=>{calls.n++;if(p instanceof Error)throw p;
 return {requestId:r.id,engine:{provider:"jev",model:"jev-test-1",version:"x"},latencyMs:1,candidates:r.candidates.map(value=>({value,probability:(p as any)[value]??0}))}}});
/** A book whose examples say: here CLIMB lands and DESCEND crashes. */
function book():LearningBook{const f=observationFeatures(obs),b=emptyBook();b.examples=[];
 for(let i=0;i<40;i++)for(const [a,ok] of [["CLIMB",1],["DESCEND",0],["TURN_LEFT",0]] as const)b.examples.push({f:f.map((v,k)=>k===0?v+(i%9)-4:v),a,ok});return b}
const next=(c:Copilot,tick:bigint,flown:PilotIntent="HOLD")=>new Promise<[any,any]>(res=>c.advise(tick,obs,flown,(a,f)=>res([a,f])));
const settle=async(c:Copilot)=>{for(let i=0;i<600&&!c.status.xgboost.trained&&!c.status.xgboost.detail?.startsWith("training failed");i++)await Bun.sleep(25)};
test("errors are described by HTTP status and message, not (minified) class names",async()=>{
 const c=new Copilot({xgboost:()=>{throw new Error("unused")},transport:jev(Object.assign(new Error("invalid api key"),{name:"q0",status:401}))});c.setKey("k");
 c.advise(0n,obs,"HOLD",()=>{});for(let i=0;i<50&&c.status.jev!=="ERROR";i++)await Bun.sleep(5);expect(c.status.detail).toBe("HTTP 401: invalid api key");
});
test("off without a key; confident Jev recommends; the recommendation is a trace frame",async()=>{
 const c=new Copilot({xgboost:()=>{throw new Error("unused")},transport:jev({CLIMB:.8,HOLD:.2})});
 c.advise(0n,obs,"HOLD",()=>{throw new Error("no key, no advice")});expect(c.enabled).toBe(false);expect(c.status.jev).toBe("OFF");
 c.setKey("k");expect(c.status.jev).toBe("READY");
 const [a,f]=await next(c,240n,"HOLD");
 expect(a).toMatchObject({tick:"240",intent:"CLIMB",flown:"HOLD",source:"JEV",provider:"jev",confidence:.8});
 expect(f).toMatchObject({id:"copilot:240",startTick:240n,requestedIntent:"CLIMB",executedIntent:"HOLD",provider:"jev",evidence:{model:"jev-test-1",selection:{source:"PROVIDER"}}});
 expect(c.status).toMatchObject({jev:"READY",model:"jev-test-1"});
 c.setKey(null);expect(c.enabled).toBe(false);
});
test("asks at most once a simulated second and never twice at the same time",async()=>{
 const calls={n:0},c=new Copilot({xgboost:()=>{throw new Error("unused")},transport:jev({HOLD:.9},calls)});c.setKey("k");
 const p=next(c,0n);c.advise(1n,obs,"HOLD",()=>{});await p;expect(calls.n).toBe(1);        // in flight → skipped
 c.advise(ADVICE_EVERY_TICKS-1n,obs,"HOLD",()=>{});await Bun.sleep(10);expect(calls.n).toBe(1); // too soon
 await next(c,ADVICE_EVERY_TICKS);expect(calls.n).toBe(2);
});
test("unsure Jev: the XGBoost model trained on this browser's flights decides",async()=>{
 const x=new XGBoostBestPracticeClient(),c=new Copilot({xgboost:()=>x,transport:jev({HOLD:.3,DESCEND:.28,TURN_LEFT:.22,CLIMB:.2})});
 try{
  c.setKey("k");c.learnFrom({...emptyBook(),examples:book().examples!.slice(0,MIN_TRAINING_EXAMPLES-1)});
  expect(c.status.xgboost).toMatchObject({trained:false,examples:MIN_TRAINING_EXAMPLES-1});expect(c.status.xgboost.detail).toMatch(/needs 20 examples/);
  const [before]=await next(c,0n);expect(before).toMatchObject({intent:"HOLD",source:"JEV"});expect(before.reason).toMatch(/best-practice model is unavailable/);
  c.learnFrom(book());await settle(c);expect(c.status.xgboost).toMatchObject({trained:true,examples:120,version:"bp-1"});
  const [a,f]=await next(c,ADVICE_EVERY_TICKS);
  expect(a).toMatchObject({intent:"CLIMB",source:"BEST_PRACTICE",provider:"xgboost:bp-1",jevConfidence:.3});expect(a.confidence).toBeGreaterThan(.8);
  expect(f.evidence.selection.reason).toMatch(/jev confidence 30% was below 50%/);
 }finally{c.dispose()}
},60_000);
test("Jev unreachable: status says why, requests back off, and a trained model still advises",async()=>{
 const x=new XGBoostBestPracticeClient(),calls={n:0},c=new Copilot({xgboost:()=>x,transport:jev(Object.assign(new Error("Connection error."),{name:"APIConnectionError"}),calls)});
 try{
  c.setKey("k");c.learnFrom(book());await settle(c);
  const [a]=await next(c,0n,"HOLD");
  expect(c.status).toMatchObject({jev:"ERROR",detail:"Connection error."});
  expect(a).toMatchObject({intent:"CLIMB",source:"BEST_PRACTICE",provider:"xgboost:bp-1"});expect(a.reason).toMatch(/Jev could not be reached/);
  c.advise(ADVICE_EVERY_TICKS,obs,"HOLD",()=>{});await Bun.sleep(20);expect(calls.n).toBe(1); // backing off
  c.advise(ERROR_BACKOFF_TICKS,obs,"HOLD",()=>{});await Bun.sleep(20);expect(calls.n).toBe(2);
 }finally{c.dispose()}
},60_000);
test("answers that arrive after a new flight began are dropped",async()=>{
 let release!:()=>void;const slow:JevTransport={invoke:r=>new Promise(res=>{release=()=>res({requestId:r.id,engine:{provider:"jev",model:"m",version:"1"},latencyMs:1,candidates:r.candidates.map(value=>({value,probability:value==="HOLD"?1:0}))})})};
 const c=new Copilot({xgboost:()=>{throw new Error("unused")},transport:()=>slow});c.setKey("k");
 let got=0;c.advise(0n,obs,"HOLD",()=>got++);await Bun.sleep(5);c.reset();release();await Bun.sleep(20);expect(got).toBe(0);
 const again=next(c,0n);await Bun.sleep(5);release();await again;
});
