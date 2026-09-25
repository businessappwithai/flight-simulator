import {expect,test} from "bun:test";
import {trainingWeight,promoteBestPracticeModel,ACTIONS} from "@flight/experience";
test("bad outcomes receive stronger learning weight",()=>{const good=trainingWeight({features:[1],action:"CLIMB",reward:1,regret:0,success:true,safetyOverride:false,catastrophic:false});const bad=trainingWeight({features:[1],action:"DESCEND",reward:-5,regret:10,success:false,safetyOverride:true,catastrophic:true});expect(bad).toBeGreaterThan(good)});
test("best practice model promotion is gated",()=>{expect(promoteBestPracticeModel({validationExamples:1000,accuracy:.9,baselineAccuracy:.85,hardRegressions:0,catastrophicFalsePositiveRate:0})).toBe(true);expect(promoteBestPracticeModel({validationExamples:1000,accuracy:.95,baselineAccuracy:.85,hardRegressions:0,catastrophicFalsePositiveRate:.001})).toBe(false)});
test("action vocabulary stable",()=>expect(ACTIONS).toContain("REROUTE"));
