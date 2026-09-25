import {expect,test} from "bun:test";
import {LiveDashboardModel} from "../apps/control-room/src/live-dashboard.ts";
import {dashboardAlerts} from "../apps/control-room/src/alerts.ts";
import {TelemetryBuffer} from "../apps/control-room/src/telemetry-buffer.ts";
test("canonical DecisionFrame is understood",()=>{const m=new LiveDashboardModel();m.ingest({type:"DECISION",frame:{id:"d",startTick:1n,requestedIntent:"CLIMB",executedIntent:"CLIMB",provider:"jev",probability:.8}});expect(m.latest()?.decisionId).toBe("d");expect(m.latest()?.confidence).toBe(.8)});
test("telemetry buffer is bounded",()=>{const b=new TelemetryBuffer(2);for(let i=0;i<3;i++)b.push({type:"EPISODE_END",tick:String(i),phase:"x",checksum:"x"});expect(b.size).toBe(2)});
test("high override rate raises alert",()=>{const a=dashboardAlerts({decisions:20,overrides:10,overrideRate:.5,episodes:1,providerDisagreements:0,meanConfidence:.8});expect(a.some(x=>x.id==="override-rate"&&x.severity==="CRITICAL")).toBe(true)});
