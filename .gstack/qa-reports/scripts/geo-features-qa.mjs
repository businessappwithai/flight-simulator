// Browser QA for Phases 2 and 3: real buildings and airport surfaces around a real runway, from PMTiles archives
// baked out of Overture (scripts/overture-extract.py + scripts/bake-features.ts) and served by terrain-relay.ts.
// Needs: bun apps/simulator/serve.ts --port 3200 and
//        bun .gstack/qa-reports/scripts/terrain-relay.ts --features-dir <dir with vomm.pmtiles [vnkt.pmtiles]>
import {chromium} from "playwright";
const OUT=process.env.OUT||".",BASE=process.env.BASE||"http://localhost:3200/",RELAY=process.env.RELAY||"http://localhost:3300";
const T=encodeURIComponent(`${RELAY}/{z}/{x}/{y}.png`),F=name=>encodeURIComponent(`${RELAY}/features/${name}.pmtiles`);
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const log=(...a)=>console.log(...a);let failures=0;const check=(ok,what)=>{log(ok?"PASS":"FAIL",what);if(!ok)failures++};const errs=[];
async function open(q,vp={width:1280,height:800}){const ctx=await b.newContext({viewport:vp});await ctx.addInitScript(()=>{try{localStorage.setItem("flightWorld.jevKey","qa-dummy-key-0001")}catch{}});
 const p=await ctx.newPage();p.errs=[];p.on("console",m=>{if(m.type()==="error")p.errs.push(m.text().slice(0,200))});p.on("pageerror",e=>p.errs.push("uncaught: "+e.message));
 await p.goto(BASE+q);await p.waitForFunction(()=>globalThis.flightSim?.world,null,{timeout:30000});return p}
const st=p=>p.evaluate(()=>{const g=flightSim.geo,w=flightSim.world;return g&&{state:g.state,features:g.features.state,buildings:g.features.buildings,surveyed:g.surveyed,hdg:+g.headingDeg.toFixed(2),
 patches:flightSim.featurePatches,terrain:flightSim.terrainTiles,agl:g.aglM===null?null:Math.round(g.aglM),phase:w.objective.phase,runwayBelow:g.runwayBelow}});
async function until(p,pred,ms){const t0=Date.now();let s;while(Date.now()-t0<ms){s=await st(p);if(s&&pred(s))return s;await p.waitForTimeout(500)}return s}
async function orbit(p,name,dx=-260,dy=-40){await p.keyboard.press("3");await p.waitForTimeout(800);const v=p.viewportSize();await p.mouse.move(v.width/2,v.height/2);await p.mouse.down();await p.mouse.move(v.width/2+dx,v.height/2+dy,{steps:8});await p.mouse.up();
 await p.waitForTimeout(2500);await p.screenshot({path:`${OUT}/${name}.png`})}

let p,s;
if(process.env.ONLY!=="vnkt"){
// 1) Chennai: surveyed runway 07, buildings and taxiways stream, the mission still lands.
p=await open(`?quality=low&rate=2&airport=VOMM&runway=07&terrain=${T}&features=${F("vomm")}`);
s=await until(p,s=>s.state==="READY"&&s.features==="READY"&&s.patches>4,120000);log("ready",JSON.stringify(s));
check(s.surveyed&&Math.abs(s.hdg-68.9)<0.3,`runway 07 placed from surveyed data (heading ${s.hdg}°)`);check(s.buildings>1000,`physics buildings loaded (${s.buildings})`);check(s.patches>4,`building/airport meshes shown (${s.patches})`);
check((await p.getByTestId("geo-features").innerText()).includes("buildings"),"badge reports buildings");
await p.screenshot({path:`${OUT}/features-1-vomm-parked.png`});
await p.getByTestId("start-autopilot").click();s=await until(p,s=>s.agl>50,90000);await orbit(p,"features-2-vomm-city-orbit");
await p.keyboard.press("1");s=await until(p,s=>s.phase==="COMPLETE"||s.phase==="FAILED",240000);check(s.phase==="COMPLETE","autopilot mission lands at VOMM with real buildings around");
await p.keyboard.press("4");await p.waitForTimeout(2500);await p.screenshot({path:`${OUT}/features-3-vomm-tower.png`});
errs.push(...p.errs);await p.context().close();

// 2) Features off: the badge and world say so, terrain still streams.
p=await open(`?quality=low&airport=VOMM&terrain=${T}&features=off`);s=await until(p,s=>s.state==="READY",90000);
check(s.features==="OFF"&&s.patches===0,"features=off: no buildings, terrain only");errs.push(...p.errs);await p.context().close();
}

// 3) Kathmandu: a dense city in a mountain valley (when vnkt.pmtiles was baked).
if(process.env.VNKT!=="0"){
 p=await open(`?quality=low&rate=4&airport=VNKT&runway=02&terrain=${T}&features=${F("vnkt")}`);
 s=await until(p,s=>s.state==="READY"&&s.features!=="LOADING"&&s.patches>4,120000);log("kathmandu",JSON.stringify(s));
 check(s.features==="READY"&&s.buildings>1000,`Kathmandu buildings (${s.buildings})`);log("surveyed VNKT 02:",s.surveyed,s.hdg);
 await p.getByTestId("start-autopilot").click();s=await until(p,s=>s.agl>50,90000);await orbit(p,"features-4-vnkt-city-orbit",-200,-60);
 await p.keyboard.press("2");await p.waitForTimeout(2500);await p.screenshot({path:`${OUT}/features-5-vnkt-cockpit.png`});
 s=await until(p,s=>s.phase==="COMPLETE"||s.phase==="FAILED",240000);check(s.phase==="COMPLETE","autopilot mission lands at Kathmandu");
 errs.push(...p.errs);await p.context().close();
}
const real=errs.filter(e=>!/jev|typesafe|copilot|Failed to fetch|net::/i.test(e));log("CONSOLE_ERRORS",JSON.stringify(real));check(real.length===0,"no console errors");
await b.close();log(failures?`${failures} FAILED`:"ALL PASSED");process.exit(failures?1:0);
