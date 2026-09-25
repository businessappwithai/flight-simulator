import {expect,test} from "bun:test";
import {LiveDashboardModel} from "../apps/inspector/src/live-dashboard.ts";
test("latest decision advances while history remains inspectable",()=>{const m=new LiveDashboardModel();for(const id of ["a","b"])m.ingest({type:"DECISION",frame:{decisionId:id,provider:"scripted",model:"test",candidates:[{intent:"HOLD",probability:1}],requested:"HOLD",executed:"HOLD"} as any});expect(m.latest()?.decisionId).toBe("b");expect(m.decisions().map(x=>x.decisionId)).toEqual(["b","a"])});
