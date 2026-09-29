// gstack /qa pass (diff-aware, PR #7 + Phase 1): exploratory checks of the real-world flow as a user would do them.
// Needs: bun apps/simulator/serve.ts --port 3200 and terrain-relay.ts --features-dir <dir with vomm.pmtiles>.
import {chromium} from "playwright";
const OUT=process.env.OUT||".",BASE=process.env.BASE||"http://localhost:3200/",RELAY=process.env.RELAY||"http://localhost:3300";
const T=encodeURIComponent(`${RELAY}/{z}/{x}/{y}.png`),F=encodeURIComponent(`${RELAY}/features/vomm.pmtiles`);
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const log=(...a)=>console.log(...a);
async function open(q,{vp={width:1280,height:800},key=true,touch=false}={}){const ctx=await b.newContext({viewport:vp,hasTouch:touch,isMobile:touch});
 if(key)await ctx.addInitScript(()=>{try{localStorage.setItem("flightWorld.jevKey","qa-dummy-key-0001")}catch{}});
 const p=await ctx.newPage();p.errs=[];p.on("console",m=>{if(m.type()==="error")p.errs.push(m.text().slice(0,240))});p.on("pageerror",e=>p.errs.push("uncaught: "+e.message));
 await p.goto(BASE+q);await p.waitForFunction(()=>globalThis.flightSim?.world,null,{timeout:30000});return p}
const geo=p=>p.evaluate(()=>{const g=flightSim.geo,w=flightSim.world;if(!w)return {geo:null,phase:"(resetting)",t:0,y:0,z:0};return {geo:g&&{state:g.state,detail:g.detail,features:g.features.state,fdetail:g.features.detail,buildings:g.features.buildings,surveyed:g.surveyed,hdg:+g.headingDeg.toFixed(1),runway:g.runway,airport:g.airport,agl:g.aglM===null?null:Math.round(g.aglM),holding:g.holding},
 phase:w.objective.phase,t:+(Number(w.tick)/120).toFixed(1),y:+w.aircraft.position.y.toFixed(1),z:Math.round(w.aircraft.position.z),crashed:w.aircraft.crashed,terrain:flightSim.terrainTiles,patches:flightSim.featurePatches}});
async function until(p,pred,ms){const t0=Date.now();let s;while(Date.now()-t0<ms){s=await geo(p);if(s.phase!=="(resetting)"&&pred(s))return s;await p.waitForTimeout(500)}return s}
const text=(p,sel)=>p.locator(sel).first().innerText().catch(()=>"<none>");
const shot=(p,n)=>p.screenshot({path:`${OUT}/${n}.png`});
const errors=(p,label)=>{log(`CONSOLE_ERRORS[${label}]=`+JSON.stringify(p.errs))};

// A) Default page: picker, help text.
let p=await open("?quality=low");await p.waitForTimeout(1500);
log("A start card:",(await text(p,"[data-testid=start-panel]")).replace(/\n/g," | "));
log("A airports in picker:",await p.locator("[data-testid=world-airport] option").count());
await p.keyboard.press("KeyH");await p.waitForTimeout(400);log("A help mentions real world:",(await text(p,".help")).includes("Real world"));await shot(p,"qa-a-help");await p.keyboard.press("Escape");
errors(p,"A");

// B) Real-user path: pick Kathmandu with the default data sources (AWS terrain, OpenFreeMap features).
await p.getByTestId("world-airport").selectOption("VNKT");
let s=await until(p,s=>s.geo&&s.geo.state!=="LOADING"&&s.geo.features!=="LOADING",60000);log("B defaults VNKT:",JSON.stringify(s));
log("B start card:",(await text(p,"[data-testid=start-panel]")).replace(/\n/g," | "));log("B badge:",(await text(p,"[data-testid=geo-badge]")).replace(/\n/g," "));
await shot(p,"qa-b-vnkt-defaults");
// Start while the world is whatever state it is in: does the flight run?
await p.getByTestId("start-manual").click();await p.keyboard.down("KeyW");await p.waitForTimeout(3000);await p.keyboard.up("KeyW");
s=await geo(p);log("B after 3 s of W:",JSON.stringify(s));await shot(p,"qa-b-vnkt-flying");
errors(p,"B");await p.context().close();

// C) Runway change with the relay and baked features: VOMM 07 → 25.
p=await open(`?quality=low&airport=VOMM&runway=07&terrain=${T}&features=${F}`);
s=await until(p,s=>s.geo?.state==="READY"&&s.geo.features==="READY",90000);log("C VOMM 07:",JSON.stringify(s));
await p.getByTestId("world-runway").selectOption("25");
s=await until(p,s=>s.geo?.runway==="25"&&s.geo.state==="READY"&&s.geo.features!=="LOADING",90000);log("C VOMM 25:",JSON.stringify(s),"url",new URL(p.url()).search);
log("C start card:",(await text(p,"[data-testid=start-panel]")).replace(/\n/g," | "));await shot(p,"qa-c-vomm-25");

// E) Manual low pass towards the city (runway 25 points west-south-west; turn around to the city north-east).
await p.getByTestId("world-runway").selectOption("07");s=await until(p,s=>s.geo?.runway==="07"&&s.geo.state==="READY"&&s.geo.features==="READY",90000);
await p.getByTestId("start-manual").click();await p.keyboard.down("KeyW");await p.waitForTimeout(2500);await p.keyboard.up("KeyW");
s=await until(p,s=>s.z>4200||s.phase==="FAILED",90000);log("E over the city edge:",JSON.stringify(s));await p.keyboard.press("3");await p.waitForTimeout(2000);await shot(p,"qa-e-city-pass");
await p.keyboard.down("KeyS");s=await until(p,s=>s.phase==="FAILED"||s.t>200,60000);await p.keyboard.up("KeyS");await p.waitForTimeout(800);
log("E descend into the city:",JSON.stringify(s));log("E banner:",(await text(p,".banner")).replace(/\n/g," | "));await shot(p,"qa-e-crash");
// F) Back to the procedural airfield after a real-world flight.
await p.keyboard.press("KeyR");await p.waitForTimeout(800);await p.getByTestId("world-airport").selectOption("");await p.waitForTimeout(2500);
s=await geo(p);log("F procedural again:",JSON.stringify(s),"url",new URL(p.url()).search);await p.keyboard.press("1");await p.waitForTimeout(1500);await shot(p,"qa-f-procedural");
errors(p,"C/E/F");await p.context().close();

// D) Bad URL options.
for(const q of ["?quality=low&airport=ZZZZ","?quality=low&airport=VOMM&runway=99",`?quality=low&airport=VOMM&terrain=${T}&features=javascript:alert(1)`,"?quality=low&airport=VOMM&terrain=http://example.invalid/tiles.png"]){
 p=await open(q);await p.waitForTimeout(3500);s=await geo(p);
 log("D",q.replace(/terrain=[^&]*/,"terrain=…"),"→",JSON.stringify({geo:s.geo&&{state:s.geo.state,airport:s.geo.airport,detail:s.geo.detail}}),"| error box:",(await text(p,".error")).slice(0,160),"| card:",(await text(p,"[data-testid=start-panel]")).split("\n")[0]);
 errors(p,"D");await p.context().close();
}

// G) Phone, anchored with buildings, in flight.
p=await open(`?quality=low&airport=VOMM&terrain=${T}&features=${F}`,{vp:{width:390,height:844},touch:true});
s=await until(p,s=>s.geo?.state==="READY"&&s.geo.features==="READY",90000);await shot(p,"qa-g-phone-parked");
await p.getByTestId("start-manual").click();await p.waitForTimeout(3000);await shot(p,"qa-g-phone-flying");
log("G overflow:",await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
const boxes=await p.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return b.width&&b.height?{x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}:null};return {badge:r(".geo"),attribution:r(".attribution"),pad:r(".pad"),dock:r(".dock"),top:r(".top")}});
log("G boxes:",JSON.stringify(boxes));errors(p,"G");await p.context().close();

// H) Control Room still loads.
p=await open("control-room/",{key:false}).catch(async()=>{const ctx=await b.newContext();const pg=await ctx.newPage();pg.errs=[];pg.on("console",m=>{if(m.type()==="error")pg.errs.push(m.text())});await pg.goto(BASE+"control-room/");await pg.waitForTimeout(3000);return pg});
await shot(p,"qa-h-control-room");log("H title:",await p.title());errors(p,"H");
await b.close();
