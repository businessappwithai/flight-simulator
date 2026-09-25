import {expect,test} from "bun:test";
import {XGBoostBestPracticeClient,buildOutcomeDataset,candidateRows,rankOutcomes,outcomeLabel,ACTIONS,type BestPracticeExample} from "@flight/experience";
const ex=(features:number[],action:BestPracticeExample["action"],ok:boolean,catastrophic=false):BestPracticeExample=>({features,action,reward:ok?1:-5,regret:ok?0:5,success:ok,safetyOverride:false,catastrophic});
test("failures are negative labels, not imitation targets",()=>{expect(outcomeLabel(ex([0],"DESCEND",false,true))).toBe(0);expect(outcomeLabel(ex([0],"CLIMB",true))).toBe(1);expect(outcomeLabel({...ex([0],"CLIMB",true),safetyOverride:true})).toBe(0)});
test("dataset one-hot encodes the action and carries weights",()=>{const d=buildOutcomeDataset([ex([5,6],"CLIMB",true),ex([1,2],"DESCEND",false,true),ex([Number.NaN,1],"HOLD",true),ex([1],"HOLD",true)]);expect(d.rows).toBe(2);expect(d.skipped).toBe(2);expect(d.cols).toBe(2+ACTIONS.length);expect([...d.labels]).toEqual([1,0]);expect(d.weights[1]).toBe(12);expect(d.data[2+ACTIONS.indexOf("CLIMB")]).toBe(1)});
test("candidate rows cover every action once and rank is stable",()=>{const c=candidateRows([1,2]);expect(c.rows).toBe(ACTIONS.length);expect(rankOutcomes(ACTIONS.map(()=>.5)).map(x=>x.action)).toEqual([...ACTIONS]);expect(()=>rankOutcomes([1])).toThrow();expect(()=>candidateRows([Infinity])).toThrow()});
test("real XGBoost learns to avoid the catastrophic action",async()=>{
 const c=new XGBoostBestPracticeClient();try{
  const rows:BestPracticeExample[]=[];for(let i=0;i<120;i++){const low=[-1-(i%7)/10,i%5/5],high=[1+(i%7)/10,i%5/5];rows.push(ex(low,"DESCEND",false,true),ex(low,"CLIMB",true),ex(high,"HOLD",true),ex(high,"DESCEND",true))}
  const m=await c.train("t1",rows,60);expect(m.rows).toBe(480);expect(m.featureCount).toBe(2);expect(m.bytes.byteLength).toBeGreaterThan(100);
  const low=await c.predict([-1.3,.4]),p=(r:typeof low,a:string)=>r.find(x=>x.action===a)!.probability;
  expect(p(low,"CLIMB")).toBeGreaterThan(.8);expect(p(low,"DESCEND")).toBeLessThan(.2);expect(low[0]!.action).not.toBe("DESCEND");
  expect(p(await c.predict([1.3,.4]),"DESCEND")).toBeGreaterThan(.8);
  // persisted model reloads into a fresh worker with identical predictions
  const d=new XGBoostBestPracticeClient();try{await d.load(m);expect(await d.predict([-1.3,.4])).toEqual(low);expect(d.activeVersion).toBe("t1")}finally{d.dispose()}
  await expect(c.predict([1])).rejects.toThrow("expected 2 features");
 }finally{c.dispose()}
},60_000);
test("sample weights reach XGBoost",async()=>{
 const c=new XGBoostBestPracticeClient();try{
  const rows=[...Array.from({length:40},()=>ex([0,0],"CLIMB",true)),...Array.from({length:40},()=>ex([0,0],"CLIMB",false,true))];
  await c.train("w",rows,80);const pr=(await c.predict([0,0])).find(x=>x.action==="CLIMB")!.probability;
  // unweighted this is ~0.5; with weights 4 (success) vs 12 (catastrophe) it is ~0.25
  expect(pr).toBeLessThan(.35);expect(pr).toBeGreaterThan(.15);
 }finally{c.dispose()}
},60_000);
test("requests are serialized: predict issued during training sees the new model",async()=>{
 const c=new XGBoostBestPracticeClient();try{const t=c.train("s",[ex([0],"CLIMB",true),ex([1],"HOLD",true)],5);const p=c.predict([0]);await t;expect((await p).length).toBe(ACTIONS.length)}finally{c.dispose()}
},60_000);
test("dispose settles pending calls",async()=>{const c=new XGBoostBestPracticeClient();const p=c.predict([0]);c.dispose();await expect(p).rejects.toThrow("disposed");await expect(c.predict([0])).rejects.toThrow("disposed")});
