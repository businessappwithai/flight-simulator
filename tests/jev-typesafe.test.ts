import {expect,test} from "bun:test";
import {TypeSafeJevTransport,INTENT_CRITERIA} from "@flight/decision-jev";
import {JevDecisionEngine} from "@flight/decision-jev";
import {DecisionEngineManager} from "@flight/decision-core";
import {CognitivePilot,NoMemoryStrategy} from "@flight/cognition";
import {InMemoryExperienceRepository} from "@flight/experience";
import type {Observation} from "@flight/protocol";
const KEY="test_key_not_real_0000";
const obs:Observation={tick:240n,speed:32,altitude:45,heading:.1,objectivePhase:"OUTBOUND",nearestObstacle:{distance:180,bearing:-.3},attitude:{pitch:.05,roll:0,verticalSpeed:1.2}};
/** A fake Jev server behind the real SDK client: records the request, answers like /v1/systemone. */
function server(probabilities:Record<string,number>,status=200){
 const seen:{url:string;headers:Headers;body:any}[]=[];
 const fetch=async(url:string,init?:RequestInit)=>{seen.push({url,headers:new Headers(init?.headers),body:init?.body?JSON.parse(String(init.body)):undefined});
  if(url.endsWith("/v1/models"))return Response.json({models:[{name:"jev-latest",description:"",release_date:"2026-01-01"}]});
  if(status!==200)return Response.json({error:{message:"invalid api key"}},{status});
  const top=Object.entries(probabilities).sort((a,b)=>b[1]-a[1])[0]!;
  return Response.json({model:"jev-test-1",answers:{maneuver:{type:"choice",choice:top[0],confidence:top[1],probabilities}},usage:{input_tokens:10,output_tokens:1}})};
 return {seen,fetch:fetch as any};
}
const request=(t:TypeSafeJevTransport)=>t.invoke({id:"d-1",context:{schemaVersion:1,observation:obs,temporal:{recentActions:["CLIMB"]}},question:"Choose the safest useful maneuver.",candidates:["HOLD","CLIMB","TURN_LEFT"],timeoutMs:800});
test("asks Jev one choice question over the intents and returns its probabilities",async()=>{
 const s=server({HOLD:.2,CLIMB:.7,TURN_LEFT:.1}),t=new TypeSafeJevTransport({apiKey:KEY,fetch:s.fetch});
 const r=await request(t);
 expect(r.engine).toMatchObject({provider:"jev",model:"jev-test-1"});
 expect(r.candidates).toEqual([{value:"CLIMB",probability:.7},{value:"HOLD",probability:.2},{value:"TURN_LEFT",probability:.1}]);
 const req=s.seen[0]!;expect(req.url).toBe("https://api.typesafe.ai/v1/systemone");
 expect([...req.headers.values()].some(v=>v.includes(KEY))).toBe(true); // the key is sent as a credential header
 expect(req.body.questions.maneuver).toEqual({type:"choice",instructions:"Choose the safest useful maneuver.",criteria:{HOLD:INTENT_CRITERIA.HOLD,CLIMB:INTENT_CRITERIA.CLIMB,TURN_LEFT:INTENT_CRITERIA.TURN_LEFT}});
 expect(req.body.state.observation).toMatchObject({tick:"240",altitude:45,objectivePhase:"OUTBOUND"}); // bigint → string
 expect(JSON.stringify(req.body)).not.toContain(KEY);
});
test("rejected keys and server errors surface as errors, with no retries",async()=>{
 const s=server({},401),t=new TypeSafeJevTransport({apiKey:KEY,fetch:s.fetch});
 await expect(request(t)).rejects.toThrow();expect(s.seen).toHaveLength(1);
 expect(()=>new TypeSafeJevTransport({apiKey:"  "})).toThrow("Jev API key is required");
});
test("health lists the account's models",async()=>{
 const s=server({}),t=new TypeSafeJevTransport({apiKey:KEY,fetch:s.fetch});
 expect(await new JevDecisionEngine(t).health()).toEqual({healthy:true,detail:"1 models: jev-latest"});
 const down=new TypeSafeJevTransport({apiKey:KEY,fetch:(async()=>{throw new TypeError("fetch failed")}) as any});
 expect((await down.health()).healthy).toBe(false);
});
test("through CognitivePilot: confident Jev decides; unsure Jev hands the decision to XGBoost",async()=>{
 const pilot=(p:Record<string,number>)=>new CognitivePilot(new DecisionEngineManager(new JevDecisionEngine(new TypeSafeJevTransport({apiKey:KEY,fetch:server(p).fetch}))),new NoMemoryStrategy(),new InMemoryExperienceRepository(),
  {bestPractice:{source:"xgb-v1",predict:async()=>[{action:"TURN_LEFT",probability:.88}]}});
 const sure=await pilot({HOLD:.1,CLIMB:.85,TURN_LEFT:.05,TURN_RIGHT:0,DESCEND:0,SLOW:0,REROUTE:0,ABORT:0}).decide(obs);
 expect(sure).toMatchObject({intent:"CLIMB",provider:"jev",evidence:{model:"jev-test-1",selection:{source:"PROVIDER"}}});
 const unsure=await pilot({HOLD:.3,CLIMB:.28,TURN_LEFT:.22,TURN_RIGHT:.2,DESCEND:0,SLOW:0,REROUTE:0,ABORT:0}).decide(obs);
 expect(unsure).toMatchObject({intent:"TURN_LEFT",provider:"xgb-v1",evidence:{selection:{source:"BEST_PRACTICE",providerConfidence:.3}}});
});
