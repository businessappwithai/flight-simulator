// Test fixture: a stand-in for the Jev service, for tests and the Pages smoke test (CI has no Jev key or endpoint).
//
// It answers the TypeSafe `POST /v1/systemone` call the real Jev transport makes (and the browser's CORS preflight),
// choosing a manoeuvre from the observation alone, as Jev must. It is a test double, not part of the simulator: the
// simulator has no built-in pilot and flies whatever Jev and the learned model decide. Plain JavaScript (node:http), so
// Bun tests and the Node smoke script share it.
import {createServer} from "node:http";

const TAN3=Math.tan(3*Math.PI/180);
/**
 * A plain visual pilot working from the observation: roll and climb out, turn towards the objective, keep to the planned
 * path, and inside 2 km of the threshold keep the wings level and let down onto the runway, then idle to a stop.
 */
export function standInPolicy(o){
 const g=o.objective;if(!g)return "HOLD";
 if(o.grounded)return o.objectivePhase==="RETURN"&&g.distance<6000?"SLOW":"CLIMB";
 const turn=g.bearing>0?"TURN_RIGHT":"TURN_LEFT";
 if(Math.abs(g.bearing)>.6)return turn;
 if(o.objectivePhase==="RETURN"&&g.distance<12_000){
  // Final: track the 3° path (turns hold height, so heading is corrected only for real errors), then let down.
  const aboveRunway=g.heightAbove+g.distance*TAN3;
  if(g.heightAbove<-15)return "CLIMB";
  // A short turn, then wait for the wings to level (descending meanwhile) before judging the heading again.
  if(aboveRunway>10&&Math.abs(o.attitude?.roll??0)<.05&&Math.abs(g.bearing)>.008)return turn;
  return g.heightAbove>0?"DESCEND":"HOLD";
 }
 // Turns hold height, so a large height error comes first; small heading errors wait for it.
 if(g.heightAbove<-40)return "CLIMB";
 if(g.heightAbove>40)return "DESCEND";
 if(Math.abs(g.bearing)>.08)return turn;
 if(g.heightAbove<-15)return "CLIMB";
 if(g.heightAbove>15)return "DESCEND";
 return "HOLD";
}
/**
 * Serves the stand-in on localhost (a free port unless `port` is given). `delayMs()` delays each answer, `fail` answers
 * HTTP 503, `confidence` is the probability given to the chosen intent. Resolves once listening.
 */
export async function serveStandInJev(o={}){
 const s={url:"",calls:0,observations:[],stop:()=>{server.closeAllConnections?.();return new Promise(r=>server.close(()=>r()))}};
 const cors={"access-control-allow-origin":"*","access-control-allow-methods":"GET, POST, OPTIONS","access-control-max-age":"600"};
 const server=createServer((req,res)=>{
  const path=new URL(req.url??"/","http://x").pathname,json=(status,body)=>{res.writeHead(status,{...cors,"content-type":"application/json"});res.end(JSON.stringify(body))};
  if(req.method==="OPTIONS"){res.writeHead(204,{...cors,"access-control-allow-headers":req.headers["access-control-request-headers"]??"*"});res.end();return}
  if(path==="/v1/models")return json(200,{data:[{name:"jev-stand-in"}]});
  if(path!=="/v1/systemone"||req.method!=="POST")return json(404,{error:{message:"not found"}});
  let body="";req.on("data",c=>body+=c);req.on("end",async()=>{
   s.calls++;const q=JSON.parse(body),d=o.delayMs?.();if(d)await new Promise(r=>setTimeout(r,d));
   if(o.fail)return json(503,{error:{message:"stand-in Jev is down"}});
   const obs=q.state.observation;s.observations.push(obs);
   const chosen=(o.policy??standInPolicy)(obs),c=o.confidence??.9,labels=Object.keys(q.questions?.maneuver?.criteria??{HOLD:""});
   json(200,{model:"jev-stand-in",answers:{maneuver:{probabilities:Object.fromEntries(labels.map(l=>[l,l===chosen?c:(1-c)/Math.max(1,labels.length-1)]))}},usage:{}});
  });
 });
 await new Promise(r=>server.listen(o.port??0,"127.0.0.1",r));
 s.url=`http://127.0.0.1:${server.address().port}`;
 return s;
}
