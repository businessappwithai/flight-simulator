import {expect,test} from "bun:test";
import {LiveDashboardModel} from "../apps/inspector/src/live-dashboard.ts";
import {inspectorHealth} from "../apps/inspector/src/health.ts";
test("dashboard explains safety override",()=>{const m=new LiveDashboardModel();m.ingest({type:"DECISION",frame:{decisionId:"d1",provider:"jev",model:"m",candidates:[{intent:"DESCEND",probability:.9}],temporalPatterns:["repetition"],retrievedExperienceIds:["e1"],requested:"DESCEND",executed:"DESCEND",providerDisagreement:.4} as any});m.ingest({type:"SAFETY_OVERRIDE",decisionId:"d1",requested:"DESCEND",executed:"CLIMB",reason:"terrain"});expect(m.explain("d1")?.join(" ")).toContain("Safety changed DESCEND to CLIMB")});
test("stale telemetry is unhealthy",()=>expect(inspectorHealth(0,5000,1000).healthy).toBe(false));
