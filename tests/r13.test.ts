import {expect,test} from "bun:test";
import {parseScenarioConfig} from "@flight/scenarios";
test("scenario config validates at boundary",()=>{
 const x=parseScenarioConfig({id:"s",seed:"4",aircraftStart:{x:0,y:50,z:0},checkpoint:{x:0,y:50,z:500},obstacleStart:{x:10,y:50,z:200},obstacleVelocity:{x:0,y:0,z:-1}});
 expect(x.seed).toBe(4n);
});
