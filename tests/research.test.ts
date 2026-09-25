import {expect,test} from "bun:test";
import {prioritizeResearch,standardAblations,sha256} from "@flight/research";
test("research scheduler and ablations deterministic",async()=>{
 const x=prioritizeResearch([
  {id:"a",severity:1,novelty:1,uncertainty:1,providerDisagreement:1,worldModelError:1,estimatedCost:1},
  {id:"b",severity:.1,novelty:.1,uncertainty:.1,providerDisagreement:.1,worldModelError:.1,estimatedCost:.1}
 ]);
 expect(x[0]?.id).toBe("a");
 expect(standardAblations({temporalMemory:true,experience:true,worldModel:true,skills:true,provider:"jev"})).toHaveLength(6);
 expect(await sha256(new TextEncoder().encode("x"))).toHaveLength(64);
});
