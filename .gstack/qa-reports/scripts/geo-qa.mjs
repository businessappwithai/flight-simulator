// Browser QA for real-world anchoring (Phase 1): real terrain streams around a real runway, the autopilot mission
// still lands, airports appear, the world picker re-anchors, and the phone layout holds.
// Needs: bun apps/simulator/serve.ts --port 3200 and bun .gstack/qa-reports/scripts/terrain-relay.ts (port 3300).
import {chromium} from "playwright";
const OUT=process.env.OUT||".",BASE=process.env.BASE||"http://localhost:3200/",TERRAIN=encodeURIComponent(process.env.TERRAIN||"http://localhost:3300/{z}/{x}/{y}.png");
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const log=(...a)=>console.log(...a);let failures=0;const check=(ok,what)=>{log(ok?"PASS":"FAIL",what);if(!ok)failures++};
async function open(q,vp={width:1280,height:800}){const ctx=await b.newContext({viewport:vp});
 // The autopilot needs a saved Jev key; a dummy one is enough (the copilot just reports Jev unreachable).
 await ctx.addInitScript(()=>{try{localStorage.setItem("flightWorld.jevKey","qa-dummy-key-0001")}catch{}});
 const p=await ctx.newPage();p.errs=[];
 p.on("console",m=>{if(m.type()==="error")p.errs.push(m.text().slice(0,200))});p.on("pageerror",e=>p.errs.push("uncaught: "+e.message));
 await p.goto(BASE+q);await p.waitForFunction(()=>globalThis.flightSim?.world,null,{timeout:30000});return p}
const geo=p=>p.evaluate(()=>{const g=flightSim.geo,w=flightSim.world;return g&&{state:g.state,airport:g.airport,runway:g.runway,lat:+g.position.lat.toFixed(4),lon:+g.position.lon.toFixed(4),msl:Math.round(g.position.altMsl),agl:g.aglM===null?null:Math.round(g.aglM),
 elev:g.anchor.elevationM,tiles:flightSim.terrainTiles,simTiles:g.simTiles,holding:g.holding,airports:g.airports.map(a=>a.ident),phase:w.objective.phase,t:(Number(w.tick)/120).toFixed(1)}});
async function until(p,pred,ms){const t0=Date.now();let s;while(Date.now()-t0<ms){s=await geo(p);if(s&&pred(s))return s;await p.waitForTimeout(500)}return s}
const errs=[];
// 1) Chennai runway 07, autopilot mission over real terrain.
let p=await open(`?quality=low&rate=4&airport=VOMM&runway=07&terrain=${TERRAIN}`);
let s=await until(p,s=>s.state==="READY"&&s.tiles>20,90000);log("ready",JSON.stringify(s));
check(s.state==="READY"&&s.airport==="VOMM"&&s.runway==="07","VOMM 07 anchored, terrain ready");check(s.tiles>20,`terrain patches shown (${s.tiles})`);
check(Math.abs(s.lat-12.99)<.03&&Math.abs(s.lon-80.17)<.05,"aircraft placed at Chennai");check(s.elev>=0&&s.elev<60,`runway elevation from DEM ${s.elev} m`);
check((await p.getByTestId("start-panel").innerText()).includes("Ready on VOMM runway 07"),"start panel names the real runway");
check(await p.getByTestId("attribution").isVisible(),"data attribution visible");
await p.screenshot({path:`${OUT}/geo-1-vomm-parked.png`});
await p.getByTestId("start-autopilot").click();
s=await until(p,s=>s.agl>40,90000);log("climb",JSON.stringify(s));check(s.agl>40&&s.phase!=="FAILED",`climbing over real terrain (AGL ${s.agl} m)`);await p.keyboard.press("3");await p.waitForTimeout(2500);await p.screenshot({path:`${OUT}/geo-2-vomm-climb-orbit.png`});
await p.keyboard.press("1");
s=await until(p,s=>s.phase==="COMPLETE"||s.phase==="FAILED",240000);log("end",JSON.stringify(s));check(s.phase==="COMPLETE","autopilot mission lands at VOMM");
check(s.airports.includes("VOMM"),"airport markers include VOMM");
await p.waitForTimeout(800);await p.screenshot({path:`${OUT}/geo-3-vomm-landed.png`});
log("badge:",(await p.getByTestId("geo-badge").innerText()).replace(/\n/g," "));
// 2) World picker: back to the procedural airfield, then Kathmandu 02 (mountains).
await p.keyboard.press("KeyR");await p.waitForTimeout(800);
await p.getByTestId("world-airport").selectOption("");await p.waitForTimeout(1500);
check(await p.evaluate(()=>!flightSim.geo&&flightSim.terrainTiles===0),"procedural airfield: no geo, terrain cleared");check(!new URL(p.url()).searchParams.has("airport"),"URL drops airport");
await p.getByTestId("world-airport").selectOption("VNKT");
s=await until(p,s=>s.airport==="VNKT"&&s.state==="READY"&&s.tiles>20,90000);log("kathmandu",JSON.stringify(s));
check(s.airport==="VNKT"&&s.elev>1200&&s.elev<1500,`Kathmandu valley elevation ${s.elev} m`);check(new URL(p.url()).searchParams.get("airport")==="VNKT","URL keeps the airport");
await p.getByTestId("start-autopilot").click();s=await until(p,s=>s.agl>40,90000);await p.screenshot({path:`${OUT}/geo-4a-vnkt-climb-chase.png`});await p.keyboard.press("3");await p.waitForTimeout(3000);
await p.screenshot({path:`${OUT}/geo-4-vnkt-orbit.png`});await p.keyboard.press("2");await p.waitForTimeout(2500);await p.screenshot({path:`${OUT}/geo-5-vnkt-cockpit.png`});
s=await until(p,s=>s.phase==="COMPLETE"||s.phase==="FAILED",240000);log("vnkt end",JSON.stringify(s));check(s.phase==="COMPLETE","autopilot mission lands at Kathmandu");
errs.push(...p.errs);await p.context().close();
// 3) Phone layout, anchored.
p=await open(`?quality=low&airport=VABB&terrain=${TERRAIN}`,{width:390,height:844});
s=await until(p,s=>s.state==="READY"&&s.tiles>10,90000);check(s.airport==="VABB","VABB on a phone");
const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);check(!overflow,"no horizontal overflow on a phone");
await p.screenshot({path:`${OUT}/geo-6-vabb-phone.png`});errs.push(...p.errs);await p.context().close();
// Jev is unreachable here by design (dummy key); anything else in the console is a failure.
const real=errs.filter(e=>!/jev|typesafe|copilot|ERR_TUNNEL|ERR_NAME|Failed to fetch|net::/i.test(e));log("CONSOLE_ERRORS",JSON.stringify(real));check(real.length===0,"no console errors");
await b.close();log(failures?`${failures} FAILED`:"ALL PASSED");process.exit(failures?1:0);
