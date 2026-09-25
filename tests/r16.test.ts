import {expect,test} from "bun:test";
import {withTimeout} from "@flight/decision-core";
import {manifestHash} from "@flight/experiments";
import {encodeTelemetry,decodeTelemetry} from "@flight/runtime";
test("decision timeout returns fast work",async()=>expect(await withTimeout(Promise.resolve(7),50)).toBe(7));
test("canonical experiment hash ignores object key order",async()=>expect(await manifestHash({a:1,b:2})).toBe(await manifestHash({b:2,a:1})));
test("telemetry codec preserves bigint",()=>{const x:any={type:"EPISODE_END",tick:9n};expect((decodeTelemetry(encodeTelemetry(x)) as any).tick).toBe(9n)});
