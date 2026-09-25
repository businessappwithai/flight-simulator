import {expect,test} from "bun:test";
import {decisionRegret} from "@flight/benchmark";
import {shouldCounterfactuallyEvaluate} from "@flight/counterfactual";
import {promotionDecision} from "@flight/experiments";
import {canPromoteSkill} from "@flight/skills";
const r=(objective:number)=>({survival:1,separation:1,objective,stability:1,efficiency:1});
test("regret and research gates",()=>{
 const x=decisionRegret(r(0),[{action:"CLIMB",reward:r(2)}]);
 expect(x.bestCounterfactual).toBe("CLIMB");expect(x.regret).toBeGreaterThan(0);
 expect(shouldCounterfactuallyEvaluate({collision:false,safetyOverride:false,providerDisagreement:.5,providerEntropy:.2,novelty:.1})).toBe(true);
 expect(promotionDecision({scenarios:1000,baselineFailures:2,candidateFailures:1,baselineCompletionRate:.8,candidateCompletionRate:.85,newHardRegressions:0,reproducible:true})).toBe("PROMOTE");
 expect(canPromoteSkill({id:"s",version:1,name:"x",steps:[],status:"SHADOW",evidence:{observations:100,actualExecutions:50,counterfactualExecutions:50,successes:100,failures:0,meanRegret:0,safetyOverrideRate:0}})).toBe(true);
});
