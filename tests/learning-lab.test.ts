import {expect,test} from "bun:test";
import {LearningLab,validateLabConfig,advisorWeightFor,navigationCost,DEFAULT_LAB_CONFIG,LAB_FEATURE_NAMES} from "@flight/lab";
import type {LabEvent} from "@flight/protocol";
const small={generations:3,episodesPerGeneration:2,maxSeconds:25};
test("config is validated and clamped; schedule ramps the advisor weight",()=>{
 const c=validateLabConfig({generations:999,maxSeconds:-3,model:{maxDepth:40} as any,advisor:{weight:7} as any,provider:{kind:"bogus"} as any,horizon:"9S" as any});
 expect(c).toMatchObject({generations:50,maxSeconds:10,horizon:"1S"});expect(c.model.maxDepth).toBe(12);expect(c.advisor.weight).toBe(1);expect(c.provider.kind).toBe("local-rules");
 const r=validateLabConfig({generations:5,advisor:{...DEFAULT_LAB_CONFIG.advisor,weight:.8,schedule:"ramp"}});expect([0,1,2,3,4].map(g=>advisorWeightFor(r,g))).toEqual([0,.2,.4,.6000000000000001,.8]);
});
test("navigation cost rewards getting closer, aligning and matching height",()=>{expect(navigationCost({objective:{distance:100,bearing:.1,heightAbove:-10}})).toBeCloseTo(135);expect(navigationCost({})).toBe(0)});
test("a lab run emits the protocol events, labels decisions, holds out and retrains each generation",async()=>{
 const ev:LabEvent[]=[];const lab=new LearningLab(e=>ev.push(e));const gens=await lab.run(small);
 expect(ev[0]).toMatchObject({type:"STARTED"});expect((ev[0] as any).featureNames).toEqual(LAB_FEATURE_NAMES);expect(ev.at(-1)).toEqual({type:"DONE",stopped:false});
 expect(gens).toHaveLength(3);expect(gens[0]!.modelFrom).toBeNull();expect(gens[0]!.holdout).toBeUndefined();expect(gens[1]!.modelFrom).toBe(0);expect(gens[1]!.holdout!.n).toBeGreaterThan(50);
 for(const g of gens){expect(g.training!.rows).toBeGreaterThan(0);expect(g.training!.maxDepthReached).toBeLessThanOrEqual(4);expect(g.training!.importance[0]!.gain).toBeGreaterThan(0)}
 const d=lab.episode(1,0);expect(d.track.length).toBeGreaterThan(100);expect(d.decisions.filter(x=>x.label!==undefined).length).toBeGreaterThan(20);expect(d.decisions[5]!.advisor).toHaveLength(8);
},60_000);
test("runs are deterministic for the same config",async()=>{const a=await new LearningLab(()=>{}).run(small),b=await new LearningLab(()=>{}).run(small);expect(b.map(g=>g.metrics)).toEqual(a.map(g=>g.metrics));expect(b.map(g=>g.holdout)).toEqual(a.map(g=>g.holdout))},90_000);
test("explanations reproduce the advisor's recorded probability with the model that was flying",async()=>{
 const lab=new LearningLab(()=>{});await lab.run(small);const d=lab.episode(2,1).decisions.find(x=>x.advisor)!;
 for(const a of d.advisor!.slice(0,3)){const ex=lab.explain(2,1,d.id,a.action,"then");expect(ex.modelFrom).toBe(1);expect(ex.probability).toBeCloseTo(a.probability,5);expect(ex.trees).toHaveLength(60);expect(ex.maxDepth).toBeLessThanOrEqual(4)}
 expect(()=>lab.explain(0,0,lab.episode(0,0).decisions[0]!.id,"HOLD","then")).toThrow("generation 0 flies without one");
 expect(lab.explain(0,0,lab.episode(0,0).decisions[0]!.id,"HOLD","latest").modelFrom).toBe(2);
},60_000);
test("the depth setting reaches the trained trees",async()=>{const gens=await new LearningLab(()=>{}).run({...small,generations:1,model:{...DEFAULT_LAB_CONFIG.model,maxDepth:2,rounds:15}});expect(gens[0]!.training).toMatchObject({trees:15,maxDepthReached:2})},60_000);
test("stop ends the run after the current episode",async()=>{const ev:LabEvent[]=[];let lab!:LearningLab;lab=new LearningLab(e=>{ev.push(e);if(e.type==="PROGRESS"&&e.episode===1)lab.stop()});const g=await lab.run({...small,generations:5});expect(g.length).toBeLessThanOrEqual(1);expect(ev.at(-1)).toEqual({type:"DONE",stopped:true})},60_000);
