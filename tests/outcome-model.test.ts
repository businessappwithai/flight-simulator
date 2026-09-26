import {expect,test} from "bun:test";
import {OutcomeModel,auc,evaluateScores,sigmoid,ACTIONS,type BestPracticeExample} from "@flight/experience";
const ex=(features:number[],action:BestPracticeExample["action"],ok:boolean,catastrophic=false):BestPracticeExample=>({features,action,reward:ok?1:-5,regret:ok?0:5,success:ok,safetyOverride:false,catastrophic});
function data(n=160,seed=1){const out:BestPracticeExample[]=[];let s=seed;const r=()=>(s=(s*16807)%2147483647)/2147483647;
 for(let i=0;i<n;i++){const alt=r()*100,obs=r()*300;out.push(ex([alt,obs,r()],"DESCEND",alt>30&&obs>60,alt<15),ex([alt,obs,r()],"CLIMB",obs>20),ex([alt,obs,r()],"HOLD",obs>60))}return out}
test("AUC and metrics are computed correctly",()=>{expect(auc([.1,.4,.35,.8],[0,0,1,1])).toBe(.75);expect(auc([.5,.5],[0,1])).toBe(.5);expect(Number.isNaN(auc([1,2],[1,1]))).toBe(true);
 const e=evaluateScores([.9,.1],[1,0]);expect(e.accuracy).toBe(1);expect(e.logloss).toBeCloseTo(-Math.log(.9),6)});
test("trace reproduces XGBoost's own prediction exactly; contributions are additive",async()=>{
 const m=await OutcomeModel.create();try{m.train(data(),{maxDepth:3,rounds:25,eta:.3});
  for(const f of [[5,200,.5],[60,40,.1],[80,250,.9]])for(const a of ["DESCEND","CLIMB","HOLD"] as const){
   const tr=m.explain(f,a),p=m.predictActions(f).find(x=>x.action===a)!.probability;
   expect(tr.probability).toBeCloseTo(p,5);expect(tr.baseMargin+tr.contributions.reduce((x,y)=>x+y,0)).toBeCloseTo(tr.margin,9);expect(sigmoid(tr.margin)).toBeCloseTo(p,5);
   expect(tr.trees).toHaveLength(25);for(const t of tr.trees)expect(t.steps.length).toBeLessThanOrEqual(3)}
 }finally{m.dispose()}
},30_000);
test("depth and rounds parameters are honoured; importance ranks the informative feature",async()=>{
 const m=await OutcomeModel.create();try{
  m.train(data(),{maxDepth:1,rounds:10});expect(Math.max(...m.depths())).toBe(1);expect(m.treeCount).toBe(10);
  m.train(data(),{maxDepth:6,rounds:40});expect(Math.max(...m.depths())).toBeGreaterThan(2);expect(m.treeCount).toBe(40);
  const imp=m.importance();expect(imp).toHaveLength(3+ACTIONS.length);const noise=imp[2]!.gain,signal=Math.max(imp[0]!.gain,imp[1]!.gain);expect(signal).toBeGreaterThan(noise);
  const held=m.evaluate(data(80,99));expect(held.n).toBe(240);expect(held.auc).toBeGreaterThan(.8);
 }finally{m.dispose()}
},30_000);
test("out-of-range parameters are clamped, and an untrained model refuses to predict",async()=>{const m=await OutcomeModel.create();expect(()=>m.predictActions([1,2,3])).toThrow("not trained");m.train(data(20),{maxDepth:99,rounds:-5,eta:7});expect(m.params).toMatchObject({maxDepth:12,rounds:1,eta:1});m.dispose()});
