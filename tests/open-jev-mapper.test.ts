import { expect, test } from "bun:test";
import { ScriptedDecisionEngine } from "@flight/decision-core";

test("scripted engine provides deterministic candidate distribution", async () => {
  const e = new ScriptedDecisionEngine(["CLIMB"]);
  const r = await e.decide({
    id: "d1",
    context: {
      schemaVersion: 1,
      observation: { tick: 1n, speed: 20, altitude: 10, heading: 0, objectivePhase: "OUTBOUND" },
      temporal: { recentActions: [] }
    },
    question: "Choose maneuver",
    candidates: ["HOLD","CLIMB"] as const,
    timeoutMs: 100
  });
  expect(r.candidates.find(x => x.value === "CLIMB")?.probability).toBe(1);
});
