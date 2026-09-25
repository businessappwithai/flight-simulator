import { expect, test } from "bun:test";
import type { DecisionFrame } from "@flight/protocol";
import {
  NoMemoryStrategy, PreviousActionStrategy, SequenceStrategy,
  OutcomeAwareStrategy, ShuffledHistoryStrategy
} from "@flight/cognition";

const frames: DecisionFrame[] = [
  { id:"1", startTick:1n, requestedIntent:"TURN_RIGHT", executedIntent:"TURN_RIGHT",
    provider:"scripted", probability:1, outcome:{immediate:{survival:1,separation:-2,objective:0,stability:0,efficiency:0}} },
  { id:"2", startTick:2n, requestedIntent:"CLIMB", executedIntent:"CLIMB",
    provider:"scripted", probability:1, outcome:{immediate:{survival:1,separation:2,objective:1,stability:0,efficiency:0}} }
];

test("temporal strategies remain deterministic", () => {
  expect(new NoMemoryStrategy().summarize(frames).recentActions).toEqual([]);
  expect(new PreviousActionStrategy().summarize(frames).recentActions).toEqual(["CLIMB"]);
  expect(new SequenceStrategy().summarize(frames).recentActions).toEqual(["TURN_RIGHT","CLIMB"]);
  expect(new ShuffledHistoryStrategy().summarize(frames).recentActions).toEqual(["CLIMB","TURN_RIGHT"]);
  expect(new OutcomeAwareStrategy().summarize(frames).effectiveActions).toContain("CLIMB");
});
