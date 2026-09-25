import {expect,test} from "bun:test";
import {splitScenarioSeed} from "@flight/world-model";
import {verifyReplay} from "@flight/replay";
import {provenanceKey} from "@flight/research";
test("seed split stable",()=>expect(splitScenarioSeed("12345")).toBe(splitScenarioSeed("12345")));
test("replay verifier detects mismatch",()=>expect(verifyReplay([{tick:"1",checksum:"a"}],[{tick:"1",checksum:"b"}]).ok).toBe(false));
test("provenance key stable",()=>{const p={pilotId:"p",scenarioId:"s",scenarioSeed:"1",simulatorVersion:"1",controllerVersion:"1",safetyVersion:"1",decisionProvider:"open-jev",decisionModel:"x",rewardVersion:"1",startedAt:"now"};expect(provenanceKey(p)).toBe(provenanceKey(p))});
