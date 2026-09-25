import {chromium} from "playwright";
const OUT=process.env.OUT||".",BASE=process.env.BASE||"http://localhost:3200/";
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const log=(...a)=>console.log(...a);
async function open(q,vp={width:1440,height:900}){const p=await (await b.newContext({viewport:vp})).newPage();p.errs=[];
 p.on("console",m=>{if(m.type()==="error"||m.type()==="warning")p.errs.push(m.type()+": "+m.text().slice(0,200))});p.on("pageerror",e=>p.errs.push("uncaught: "+e.message));
 await p.goto(BASE+q);await p.waitForFunction(()=>globalThis.flightSim?.world,null,{timeout:30000});return p}
const st=p=>p.evaluate(()=>{const w=flightSim.world,a=w.aircraft;return {phase:w.objective.phase,t:(Number(w.tick)/120).toFixed(1),x:a.position.x.toFixed(0),y:a.position.y.toFixed(1),z:a.position.z.toFixed(0),pilot:flightSim.pilot,cam:flightSim.camera,fps:flightSim.fps,chk:(flightSim.checksum||"").slice(0,8)}});
async function until(p,pred,ms){const t0=Date.now();while(Date.now()-t0<ms){const s=await st(p);if(pred(s))return s;await p.waitForTimeout(400)}return st(p)}
// 1) Full autopilot mission, default scenario, time ×8
let p=await open("?quality=low&rate=8");
let s=await until(p,s=>+s.y>25,60000);log("climbing",JSON.stringify(s));await p.screenshot({path:`${OUT}/sim-1-climb-chase.png`});
s=await until(p,s=>s.phase!=="OUTBOUND",120000);log("gate",JSON.stringify(s));await p.screenshot({path:`${OUT}/sim-2-gate.png`});
s=await until(p,s=>s.phase==="RETURN"&&+s.z<500&&Math.abs(+s.x)<30,180000);log("final",JSON.stringify(s));await p.screenshot({path:`${OUT}/sim-3-final.png`});
await p.keyboard.press("2");await p.waitForTimeout(1500);await p.screenshot({path:`${OUT}/sim-4-final-cockpit.png`});await p.keyboard.press("1");
s=await until(p,s=>s.phase==="COMPLETE"||s.phase==="FAILED",180000);log("end",JSON.stringify(s));await p.waitForTimeout(800);await p.screenshot({path:`${OUT}/sim-5-landed.png`});
log("banner:",(await p.locator("#banner").innerText()).replace(/\n/g," | "));
for(const [k,name] of [["3","orbit"],["4","tower"]]){await p.keyboard.press(k);await p.waitForTimeout(1200);await p.screenshot({path:`${OUT}/sim-6-${name}.png`})}
log("MISSION_ERRORS",JSON.stringify(p.errs));await p.context().close();
// 2) Manual control, pause, restart, new scenario, help
let m=await open("?quality=low&rate=2");
await m.waitForTimeout(3000);await m.keyboard.down("KeyW");await m.waitForTimeout(1500);log("after W:",JSON.stringify(await st(m)),"| label",await m.locator("#pilotLabel").innerText(),"| intent",await m.locator("#apMode").innerText());await m.keyboard.up("KeyW");
await m.waitForTimeout(500);log("after release intent:",await m.locator("#apMode").innerText());
await m.keyboard.press("KeyP");const a1=(await st(m)).t;await m.waitForTimeout(2000);const a2=(await st(m)).t;log("paused holds time:",a1===a2,a1,a2,"| button",await m.locator("#btnPause").innerText());await m.keyboard.press("KeyP");
await m.keyboard.press("KeyN");await m.waitForTimeout(2500);log("new scenario:",await m.locator("#scenario").innerText(),"| url",new URL(m.url()).search);
await m.keyboard.press("KeyR");await m.waitForTimeout(1500);log("restart t:",(await st(m)).t);
await m.keyboard.press("KeyH");log("help visible:",await m.locator("#help").isVisible());await m.screenshot({path:`${OUT}/sim-7-help.png`});await m.keyboard.press("Escape");
await m.keyboard.press("KeyA");log("autopilot re-engaged:",await m.locator("#pilotLabel").innerText());
log("MANUAL_ERRORS",JSON.stringify(m.errs));await m.context().close();
// 3) Seeded scenario on a phone
let ph=await open("?quality=low&rate=4&scenario=seeded&seed=33",{width:390,height:844});await ph.waitForTimeout(4000);
log("phone scrollW",await ph.evaluate(()=>document.documentElement.scrollWidth),"| scenario",await ph.locator("#scenario").innerText());await ph.screenshot({path:`${OUT}/sim-8-phone.png`});
log("PHONE_ERRORS",JSON.stringify(ph.errs));await ph.context().close();
// 4) Invalid URL input is ignored safely
let bad=await open("?seed=abc&camera=nope&rate=999&scenario=<script>");await bad.waitForTimeout(1500);log("bad params →",JSON.stringify(await st(bad)),await bad.locator("#scenario").innerText(),"| errors",JSON.stringify(bad.errs));
await b.close();
