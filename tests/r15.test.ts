import {expect,test} from "bun:test";
import {ReplayTimeline} from "../apps/inspector/src/replay.ts";
import {compareRows} from "../apps/inspector/src/benchmark.ts";
test("replay timeline seeks",()=>{const r=new ReplayTimeline();r.load([{tick:"20",kind:"x",payload:{}},{tick:"10",kind:"x",payload:{}}]);expect(r.seek(15n)?.tick).toBe("20")});
test("benchmark derived rates",()=>expect(compareRows([{variant:"x",episodes:10,completionRate:.8,hardFailures:1,safetyOverrides:2,meanReward:1,meanRegret:.1}])[0]?.failureRate).toBe(.1));
