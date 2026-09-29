// Browser QA for cross-country flights: airport search, From/To, route autopilot at ×32, re-anchoring, arrival,
// rejected airports (ISSUE-003) and crash causes (ISSUE-002).
// Needs: bun apps/simulator/serve.ts (port 3200) and terrain-relay.ts (port 3300).
import {chromium} from "playwright";
const OUT=process.env.OUT||".",BASE=process.env.BASE||"http://localhost:3200/",RELAY=process.env.RELAY||"http://localhost:3300";
const T=encodeURIComponent(`${RELAY}/{z}/{x}/{y}.png`);
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const log=(...a)=>console.log(...a);
async function open(q,{vp={width:1280,height:800}}={}){const ctx=await b.newContext({viewport:vp});
 await ctx.addInitScript(()=>{try{localStorage.setItem("flightWorld.jevKey","qa-dummy-key-0001")}catch{}});
 const p=await ctx.newPage();p.errs=[];p.on("console",m=>{if(m.type()==="error")p.errs.push(m.text().slice(0,240))});p.on("pageerror",e=>p.errs.push("uncaught: "+e.message));
 await p.goto(BASE+q);await p.waitForFunction(()=>globalThis.flightSim?.world,null,{timeout:30000});return p}
const state=p=>p.evaluate(()=>{const g=flightSim.geo,w=flightSim.world;if(!w)return {phase:"(resetting)"};const r=g?.route;
 return {phase:w.objective.phase,t:Math.round(Number(w.tick)/120),crashed:w.aircraft.crashed,geo:g&&{state:g.state,airport:g.airport,epoch:g.frameEpoch,arrived:g.arrived,surface:g.surface,alt:Math.round(g.position.altMsl),agl:g.aglM===null?null:Math.round(g.aglM),holding:g.holding},
  route:r&&{to:r.destination,rwy:r.runway,km:+(r.distanceM/1000).toFixed(1),phase:r.phase,eta:r.etaS&&Math.round(r.etaS)},fps:flightSim.fps,terrain:flightSim.terrainTiles}});
async function until(p,pred,ms,every=1000){const t0=Date.now();let s;while(Date.now()-t0<ms){s=await state(p);if(s.phase!=="(resetting)"&&pred(s))return s;await p.waitForTimeout(every)}return s}
const text=(p,sel)=>p.locator(sel).first().innerText().catch(()=>"<none>");
const shot=(p,n)=>p.screenshot({path:`${OUT}/${n}.png`});
const errors=(p,label)=>log(`CONSOLE_ERRORS[${label}]=`+JSON.stringify(p.errs));

// A) Search from the start card: pick the departure and the destination from search results.
let p=await open(`?quality=low&terrain=${T}&features=off`);
await p.getByTestId("airport-search").fill("chennai");await p.getByTestId("from-VOMM").waitFor({timeout:15000});
log("A results for 'chennai':",(await text(p,"[data-testid=airport-results]")).replace(/\n/g," | ").slice(0,300));
log("A To disabled before a departure:",await p.getByTestId("to-VOMM").isDisabled());
await shot(p,"route-a-search");
await p.getByTestId("from-VOMM").click();
let s=await until(p,s=>s.geo?.state==="READY",90000);log("A from VOMM:",JSON.stringify(s));
await p.getByTestId("airport-search").fill("arakkonam");await p.getByTestId("to-VOAR").waitFor({timeout:15000});await p.getByTestId("to-VOAR").click();
s=await until(p,s=>s.route?.to==="VOAR"&&s.geo?.state==="READY",90000);log("A route:",JSON.stringify(s));
log("A route chip:",(await text(p,"[data-testid=route-chip]")).replace(/\n/g," "));log("A url:",new URL(p.url()).search);
await shot(p,"route-a-ready");errors(p,"A");

// B) Autopilot at ×32: take-off, climb, re-anchoring, approach, landing at Arakkonam.
await p.getByTestId("start-autopilot").click();for(let i=0;i<6;i++)await p.keyboard.press("Equal");
log("B rate:",(await text(p,"[data-testid=time]")));
const seen=new Set();let lastEpoch=0,shots=0;const t0=Date.now();
while(Date.now()-t0<25*60_000){s=await state(p);if(s.phase==="(resetting)"){await p.waitForTimeout(1000);continue}
 if(s.route)seen.add(s.route.phase);
 if(s.geo&&s.geo.epoch!==lastEpoch){lastEpoch=s.geo.epoch;log("B re-anchored:",JSON.stringify(s));if(shots<2){await shot(p,`route-b-epoch-${lastEpoch}`);shots++}}
 if(s.route?.phase==="FINAL"&&!seen.has("_final")){seen.add("_final");log("B final:",JSON.stringify(s));await shot(p,"route-b-final")}
 if(s.phase==="COMPLETE"||s.phase==="FAILED")break;await p.waitForTimeout(2000)}
log("B end:",JSON.stringify(s),"phases",[...seen].join(">"),"wall",Math.round((Date.now()-t0)/1000),"s");
log("B banner:",(await text(p,".banner")).replace(/\n/g," | "));log("B badge:",(await text(p,"[data-testid=geo-badge]")).replace(/\n/g," "));
await shot(p,"route-b-arrived");errors(p,"B");await p.context().close();

// C) Rejected airports (ISSUE-003): the URL is cleaned and the scenery is the procedural airfield again.
p=await open("?quality=low&airport=ZZZZ");await p.waitForTimeout(3000);
log("C error:",await text(p,"[role=alert]"),"url:",new URL(p.url()).search,"geo:",JSON.stringify((await state(p)).geo));
await shot(p,"route-c-bad-airport");
p=await open(`?quality=low&airport=VOMM&to=ZZZZ&terrain=${T}&features=off`);await p.waitForTimeout(3000);
s=await until(p,s=>s.geo?.state==="READY",60000);
log("C bad destination:",await text(p,"[role=alert]"),"url:",new URL(p.url()).search,"state:",JSON.stringify(s));
errors(p,"C");await p.context().close();

// D) Crash cause (ISSUE-002): fly manually into the ground beyond the airfield.
p=await open(`?quality=low&airport=VOMM&runway=07&terrain=${T}&features=off&pilot=manual`);
s=await until(p,s=>s.geo?.state==="READY",60000);
await p.getByTestId("start-manual").click({force:true});for(let i=0;i<3;i++)await p.keyboard.press("Equal");
await p.keyboard.down("KeyW");s=await until(p,s=>s.geo?.agl>60,120000,500);await p.keyboard.up("KeyW");
s=await until(p,s=>Math.hypot(0,1)&&s.t>70,240000,1000);
await p.keyboard.down("KeyS");s=await until(p,s=>s.phase==="FAILED",120000,500);await p.keyboard.up("KeyS");
log("D crash:",JSON.stringify(s),"banner:",(await text(p,".banner")).replace(/\n/g," | "));await shot(p,"route-d-crash");errors(p,"D");
await b.close();
