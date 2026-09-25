import { expect, test } from "bun:test";
import { SplitMix64 } from "@flight/simulation";

test("SplitMix64 is reproducible and restorable", () => {
  const a = new SplitMix64(42n);
  const first = [a.nextUint64(), a.nextUint64(), a.nextUint64()];
  const b = new SplitMix64(42n);
  expect([b.nextUint64(), b.nextUint64(), b.nextUint64()]).toEqual(first);

  const c = new SplitMix64(9n);
  c.nextUint64();
  const state = c.snapshot();
  const x = c.nextUint64();
  c.restore(state);
  expect(c.nextUint64()).toBe(x);
});
