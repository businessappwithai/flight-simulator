import {expect,test} from "bun:test";
import {terrainHeight,generateEnvironment} from "@flight/world";
import {disagreementObjective,worldModelErrorObjective,skillBoundaryObjective,ddmin} from "@flight/scenario-generator";
import {summarizeMetric} from "@flight/benchmark";
import {PilotRegistry} from "@flight/pilot-registry";
test("environment is deterministic",()=>{expect(generateEnvironment({seed:5n,terrainAmplitude:50,weatherCells:2,traffic:2,hazards:2})).toEqual(generateEnvironment({seed:5n,terrainAmplitude:50,weatherCells:2,traffic:2,hazards:2}));expect(terrainHeight(5n,10,20)).toBe(terrainHeight(5n,10,20))});
test("search objectives finite",()=>{expect(disagreementObjective(.5,.2)).toBeGreaterThan(0);expect(worldModelErrorObjective(.4,.3)).toBeGreaterThan(0);expect(skillBoundaryObjective(.5,.8)).toBeGreaterThan(1)});
test("ddmin preserves failure",async()=>{const r=await ddmin({a:true,b:true},[{id:"a",remove:x=>({...x,a:false})},{id:"b",remove:x=>({...x,b:false})}],async x=>x.a||x.b);expect(r.removed.length).toBe(1)});
test("benchmark and registry",()=>{expect(summarizeMetric("x",[1,2,3]).mean).toBe(2);const r=new PilotRegistry();r.add({id:"p1",status:"CANDIDATE",decisionProvider:"open-jev",decisionModel:"x",temporalStrategy:"OUTCOME_AWARE",experienceVersion:"1",skills:[],controllerVersion:"1",safetyVersion:"1",rewardVersion:"1",createdAt:"now"});r.activate("p1");expect(r.active?.status).toBe("ACTIVE")});
