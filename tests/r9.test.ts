import {expect,test} from "bun:test";
import {generateObstacles} from "@flight/world";
import {mineSequences} from "@flight/skill-discovery";
import {shouldConsolidate} from "@flight/experience";
test("procedural world deterministic",()=>expect(generateObstacles({seed:8n,obstacles:3,width:100,depth:500,altitudeMin:20,altitudeMax:100})).toEqual(generateObstacles({seed:8n,obstacles:3,width:100,depth:500,altitudeMin:20,altitudeMax:100})));
test("experience consolidation gates",()=>expect(shouldConsolidate({frame:{id:"d",startTick:1n,requestedIntent:"HOLD",executedIntent:"HOLD",provider:"x",probability:.5},fingerprint:"x",novelty:.8,providerDisagreement:0,safetyOverride:false})).toBe(true));
test("sequence miner finds repeated skills",()=>{const f=(a:any)=>({id:a,startTick:1n,requestedIntent:a,executedIntent:a,provider:"x",probability:1});expect(mineSequences([[f("CLIMB"),f("TURN_LEFT")],[f("CLIMB"),f("TURN_LEFT")]] as any).length).toBeGreaterThan(0)});
