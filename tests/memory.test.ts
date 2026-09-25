import { expect, test } from "bun:test";
import { RingBuffer } from "@flight/memory";

test("ring buffer retains latest values in order", () => {
  const q = new RingBuffer<number>(3);
  q.push(1); q.push(2); q.push(3); q.push(4);
  expect(q.snapshot()).toEqual([2,3,4]);
  expect(q.recent(2)).toEqual([3,4]);
});
