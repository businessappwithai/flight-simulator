import {expect,test} from "bun:test";
import {EvidenceArchive} from "@flight/research";
import {runId} from "@flight/benchmark";
import {DEFAULT_BUDGETS,budgetViolations} from "@flight/runtime";
import {encodeInspectorBundle,decodeInspectorBundle} from "../apps/control-room/src/bundle.ts";
test("evidence archive",()=>{const a=new EvidenceArchive();a.append({pilotId:"p",baselinePilotId:"b",experimentId:"e",decision:"HOLD",recordedAt:"x",evidence:{reproducible:true,hardRegressions:0,episodes:10,completionDelta:0,failureDelta:0,safetyOverrideDelta:0,meanRegretDelta:0}});expect(a.forPilot("p")).toHaveLength(1)});
test("run ids deterministic",async()=>{const x={pilotId:"p",scenarioId:"s",seed:"1",configHash:"h"};expect(await runId(x)).toBe(await runId(x))});
test("budget violations",()=>expect(budgetViolations([{subsystem:"decision",milliseconds:DEFAULT_BUDGETS.decisionMs+1}])).toHaveLength(1));
test("inspector bundle roundtrip",()=>{const x:any={version:1,episodeId:"e",decisions:[],benchmarks:[],telemetry:[{tick:2n}]};expect((decodeInspectorBundle(encodeInspectorBundle(x)).telemetry[0] as any).tick).toBe(2n)});
