import {expect,test} from "bun:test";
import {entropy} from "@flight/benchmark";
import {situationFingerprint} from "@flight/experience";
import {providerMemoryMatrix} from "@flight/experiments";
import {clusterFailures} from "@flight/failure-analysis";
test("R3 research primitives",()=>{
 expect(entropy([.5,.5])).toBeCloseTo(1);
 const fp=situationFingerprint({tick:1n,speed:30,altitude:50,heading:0,objectivePhase:"OUTBOUND",nearestObstacle:{distance:80,bearing:.5}});
 expect(fp).toContain("THREAT_NEAR");
 expect(providerMemoryMatrix()).toHaveLength(10);
 expect(clusterFailures([{type:"COLLISION",situationFingerprint:"A",recentActions:[],providerDisagreement:.2}])).toHaveLength(1);
});
