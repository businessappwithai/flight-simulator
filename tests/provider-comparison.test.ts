import { expect, test } from "bun:test";
import { compareResponses } from "@flight/decision-core";

test("provider comparison detects distribution disagreement", () => {
  const identity = {provider:"a",model:"m",version:"1"};
  const a = {requestId:"x",engine:identity,latencyMs:1,candidates:[
    {value:"CLIMB" as const,probability:.9},{value:"HOLD" as const,probability:.1}
  ]};
  const b = {requestId:"x",engine:{...identity,provider:"b"},latencyMs:1,candidates:[
    {value:"HOLD" as const,probability:.8},{value:"CLIMB" as const,probability:.2}
  ]};
  const c = compareResponses(a,b);
  expect(c.sameTopChoice).toBe(false);
  expect(c.probabilityDistance).toBeGreaterThan(.5);
});
