import {expect,test} from "bun:test";
import {SkillStateMachine} from "@flight/skills";
import {validatedForActive} from "@flight/skill-discovery";
import {nextCurriculumLevel} from "@flight/scenario-generator";
import {buildTrustMap} from "@flight/world-model";
import {RegressionSuite} from "@flight/research";
test("skill machine advances by semantic condition",()=>{const s=new SkillStateMachine([{intent:"CLIMB",until:{kind:"ALTITUDE_AT_LEAST",value:50},timeoutTicks:100},{intent:"HOLD",until:{kind:"TICKS",value:5},timeoutTicks:5}]);expect(s.current()).toBe("CLIMB");s.update({tick:1n,speed:20,altitude:60,heading:0,objectivePhase:"OUTBOUND"});expect(s.current()).toBe("HOLD")});
test("validation curriculum trust regression",()=>{expect(validatedForActive({scenarioCount:1000,successes:1000,failures:0,safetyOverrides:0,meanRegret:0})).toBe(true);expect(nextCurriculumLevel([{level:"C0_STRAIGHT",episodes:100,completionRate:.99,hardFailures:0}])).toBe("C1_ALTITUDE");expect(buildTrustMap([{situationFamily:"A",horizonSeconds:1,error:.1,uncertainty:.1}])[0]?.trust).toBeCloseTo(.9);const r=new RegressionSuite();r.addFailure("f","s",1n);expect(r.all()).toHaveLength(1)});
