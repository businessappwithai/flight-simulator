import {expect,test} from "bun:test";
import {ExperienceForest,InMemoryTreeIndex} from "@flight/experience";
import {fuseExperienceCandidates} from "@flight/cognition";
test("experience forest learns good continuation",()=>{const f=new ExperienceForest();for(let i=0;i<10;i++)f.observe("near-obstacle",["CLIMB","TURN_LEFT","HOLD"],{success:true,reward:{survival:1,separation:1,objective:1,stability:1,efficiency:1},regret:.1,safetyOverride:false});expect(f.candidates("near-obstacle")[0]?.action).toBe("CLIMB")});
test("catastrophic action becomes negative memory and is vetoed",()=>{const f=new ExperienceForest();f.observe("x",["DESCEND"],{success:false,regret:20,safetyOverride:true,catastrophic:true});const out=fuseExperienceCandidates("x",[{action:"DESCEND",score:.99,source:"provider"},{action:"CLIMB",score:.5,source:"provider"}],[],f);expect(out.some(x=>x.action==="DESCEND")).toBe(false)});
test("fast-tree baseline ranks nearby weighted examples",async()=>{const t=new InMemoryTreeIndex();await t.train([{features:[0,0],label:"CLIMB",weight:2},{features:[10,10],label:"DESCEND",weight:1}]);expect((await t.rank([0,0]))[0]?.action).toBe("CLIMB")});
