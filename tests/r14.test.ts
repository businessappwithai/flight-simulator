import {expect,test} from "bun:test";
import {parseFlightConfig} from "@flight/config";
import {allowedAuthority} from "@flight/world-model";
import {provenanceComplete} from "@flight/skills";
import {GoldenCorpus} from "@flight/research";
test("config parses",()=>expect(parseFlightConfig({decision:{primary:{provider:"scripted",model:"x"}}}).decision.mode).toBe("SINGLE"));
test("world model authority evidence gate",()=>expect(allowedAuthority({hardRegressions:0,shadowEpisodes:1000,cells:[{situationFamily:"x",horizonSeconds:1,samples:100,meanError:.1,meanUncertainty:.1,trust:.9}]})).toBe("ACTIVE"));
test("skill provenance and golden corpus",()=>{expect(provenanceComplete({discoveredFromEpisodes:["e"],scenarioFamilies:["f"],pilotVersion:"p",counterfactualRuns:1,shadowRuns:1,createdAt:"x"})).toBe(true);const g=new GoldenCorpus();g.add({scenarioId:"s",seed:"1",tags:["failure"]});expect(g.byTag("failure")).toHaveLength(1)});
