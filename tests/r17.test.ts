import {expect,test} from "bun:test";
import {releaseGate,validateReleaseManifest} from "@flight/research";
import {benchmarkSeeds,partitionSeeds} from "@flight/benchmark";
test("release gate requires evidence",()=>{expect(releaseGate({reproducible:true,hardRegressions:0,episodes:1000,completionDelta:0,failureDelta:0,safetyOverrideDelta:0,meanRegretDelta:0})).toBe("PROMOTE");expect(releaseGate({reproducible:true,hardRegressions:1,episodes:1000,completionDelta:1,failureDelta:0,safetyOverrideDelta:0,meanRegretDelta:0})).toBe("REJECT")});
test("benchmark seed sharding is deterministic",()=>{const s=benchmarkSeeds(10);expect(partitionSeeds(s,2,0)).toEqual([1n,3n,5n,7n,9n])});
test("release manifest validates hashes",()=>expect(validateReleaseManifest({releaseId:"r",pilotId:"p",createdAt:"x",artifacts:[{path:"a",sha256:"0".repeat(64),kind:"PILOT"}]})).toHaveLength(0));
