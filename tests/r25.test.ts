import {expect,test} from "bun:test";
import {ReplayController} from "../apps/control-room/src/replay-controller.ts";
import {watchdog} from "../apps/control-room/src/watchdog.ts";
import {explanationIntegrity} from "../apps/control-room/src/explanation-integrity.ts";
test("replay preserves bigint and event order",()=>{const got:any[]=[];const r=new ReplayController(e=>got.push(e));r.loadJsonl('{"type":"EPISODE_END","tick":"2n","phase":"x","checksum":"x"}\n');expect(r.step()).toBe(true);expect(got[0].tick).toBe(2n)});
test("watchdog catches override storm",()=>{const recent:any[]=Array.from({length:10},(_,i)=>({decisionId:String(i),requested:"DESCEND",executed:i<5?"CLIMB":"DESCEND",outcomes:{},provider:"p",model:"m",confidence:.5,alternatives:[{intent:"DESCEND",probability:.5}],temporalPatterns:[],experienceIds:[],disagreement:0}));expect(watchdog({decisions:10,overrides:5,overrideRate:.5,episodes:0,providerDisagreements:0,meanConfidence:.5},recent).some(x=>x.code==="OVERRIDE_STORM")).toBe(true)});
test("explanation integrity reports missing evidence",()=>expect(explanationIntegrity({decisionId:"x",requested:"HOLD",executed:"HOLD",provider:"unknown",model:"unknown",confidence:.5,alternatives:[],temporalPatterns:[],experienceIds:[],disagreement:0,outcomes:{}}).complete).toBe(false));
