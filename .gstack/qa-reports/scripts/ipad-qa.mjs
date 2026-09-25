// gstack /qa browser pass for the React/R3F apps at iPad sizes. OUT=<dir> node ipad-qa.mjs [sim|room|layout|all]
import {chromium} from "playwright";
const OUT=process.env.OUT||".",SIM=process.env.SIM||"http://localhost:3200/",ROOM=process.env.ROOM||"http://localhost:3100/",FIX=process.env.FIX||"/home/user/flight-simulator/.gstack/qa-reports/fixtures";
const what=process.argv[2]||"all",log=(...a)=>console.log(...a);
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const IPADS={"ipad-mini-portrait":[768,1024],"ipad-air-portrait":[820,1180],"ipad-landscape":[1024,768],"ipad-air-landscape":[1180,820],"ipad-pro-landscape":[1366,1024]};
async function page(url,[w,h],touch=true){const ctx=await b.newContext({viewport:{width:w,height:h},hasTouch:touch,deviceScaleFactor:1});const p=await ctx.newPage();p.errs=[];
 p.on("console",m=>{if(m.type()==="error"||(m.type()==="warning"&&!/DevTools/.test(m.text())))p.errs.push(`${m.type()}: ${m.text().slice(0,160)}`)});p.on("pageerror",e=>p.errs.push("uncaught: "+e.message));await p.goto(url);return p}
const overlap=(a,b)=>a&&b&&!(a.x+a.width<=b.x+1||b.x+b.width<=a.x+1||a.y+a.height<=b.y+1||b.y+b.height<=a.y+1);
async function boxes(p,sels){const o={};for(const s of sels){const l=p.locator(s).first();o[s]=await l.count()&&await l.isVisible()?await l.boundingBox():null}return o}
async function layoutCheck(p,sels,name){const bx=await boxes(p,sels),bad=[];const ks=Object.keys(bx);for(let i=0;i<ks.length;i++)for(let j=i+1;j<ks.length;j++)if(overlap(bx[ks[i]],bx[ks[j]]))bad.push(`${ks[i]}∩${ks[j]}`);
 const sw=await p.evaluate(()=>document.documentElement.scrollWidth),vw=p.viewportSize().width;const off=Object.entries(bx).filter(([,x])=>x&&(x.x<-1||x.x+x.width>vw+1)).map(([k])=>k);
 log(`LAYOUT ${name}: scrollW=${sw}/${vw} overlaps=${JSON.stringify(bad)} offscreen=${JSON.stringify(off)}`);return {sw,vw,bad,off}}
const st=p=>p.evaluate(()=>{const w=flightSim.world,a=w.aircraft,sp=Math.hypot(a.velocity.x,a.velocity.y,a.velocity.z);return {phase:w.objective.phase,t:+(Number(w.tick)/120).toFixed(1),x:+a.position.x.toFixed(0),y:+a.position.y.toFixed(1),z:+a.position.z.toFixed(0),kt:+(sp*1.944).toFixed(0),hdg:a.heading}});
async function until(p,pred,ms=240000){const t0=Date.now();for(;;){const s=await st(p);if(pred(s)||Date.now()-t0>ms)return s;await p.waitForTimeout(250)}}
async function shot(p,name,s){await p.screenshot({path:`${OUT}/${name}.png`});log(`SHOT ${name} ${JSON.stringify(s??"")}`)}
if(what==="sim"||what==="all"){
 // Full mission, iPad Air landscape, from takeoff to landing.
 const p=await page(SIM+"?quality=low&rate=2",IPADS["ipad-air-landscape"]);await p.waitForFunction(()=>globalThis.flightSim?.world,null,{timeout:60000});
 await shot(p,"flight-01-lineup",await st(p));
 await shot(p,"flight-02-takeoff-roll",await until(p,s=>s.kt>40));
 await shot(p,"flight-03-liftoff",await until(p,s=>s.y>6));
 await shot(p,"flight-04-climb",await until(p,s=>s.y>45));
 await p.evaluate(()=>0);await p.keyboard.press("Equal");
 await shot(p,"flight-05-approaching-gate",await until(p,s=>s.z>480||s.phase!=="OUTBOUND"));
 await shot(p,"flight-06-gate-passed",await until(p,s=>s.phase==="RETURN"));
 await shot(p,"flight-07-turn-back",await until(p,s=>Math.cos(s.hdg)<-.2));
 await p.keyboard.press("2");await shot(p,"flight-08-cockpit-downwind",await until(p,s=>s.phase==="RETURN"&&Math.abs(s.x)<40&&s.z<650&&Math.cos(s.hdg)<-.9));await p.keyboard.press("1");
 await p.keyboard.press("Minus");
 await shot(p,"flight-09-final-approach",await until(p,s=>s.z<260&&Math.abs(s.x)<20));
 await shot(p,"flight-10-short-final",await until(p,s=>s.y<12||s.phase!=="RETURN"));
 await shot(p,"flight-11-touchdown",await until(p,s=>s.phase!=="RETURN"||s.y<.5));
 const end=await until(p,s=>s.phase==="COMPLETE"||s.phase==="FAILED");await p.waitForTimeout(800);await shot(p,"flight-12-landed-chase",end);
 await p.keyboard.press("4");await p.waitForTimeout(1500);await shot(p,"flight-13-landed-tower",end);
 await p.keyboard.press("3");await p.waitForTimeout(1500);await shot(p,"flight-14-landed-orbit",end);
 log("BANNER",(await p.locator(".banner").innerText()).replace(/\n/g," | "),"| mode",await p.locator('[data-testid=mode]').innerText());
 log("SIM_ERRORS",JSON.stringify(p.errs));await p.context().close();
}
if(what==="layout"||what==="all"){
 for(const [name,vp] of Object.entries(IPADS)){
  const p=await page(SIM+"?quality=low&rate=4",vp);await p.waitForFunction(()=>globalThis.flightSim?.world&&Number(flightSim.world.tick)>600,null,{timeout:120000});
  await layoutCheck(p,[".top .chips",".top .buttons",".instruments",".map",".pad",".readout"],`sim ${name}`);
  await p.locator('.pad [data-intent="TURN_LEFT"]').dispatchEvent("pointerdown",{pointerId:1});await p.waitForTimeout(600);const lbl=await p.locator('[data-testid=pilot]').innerText();await p.locator('.pad [data-intent="TURN_LEFT"]').dispatchEvent("pointerup",{pointerId:1});
  log(`TOUCH ${name}: pad→${lbl}`);await shot(p,`sim-${name}`);log(`ERRORS sim ${name}`,JSON.stringify(p.errs));await p.context().close();
 }
}
if(what==="room"||what==="all"){
 for(const name of ["ipad-air-landscape","ipad-air-portrait","ipad-mini-portrait"]){
  const p=await page(ROOM,IPADS[name]);await p.waitForSelector("[data-testid=status]");
  await p.setInputFiles("[data-testid=replay-file]",`${FIX}/flight-42.jsonl`);await p.waitForTimeout(200);
  for(let i=0;i<12;i++)await p.getByRole("button",{name:"Step"}).click();
  log(`ROOM ${name} after steps:`,await p.locator("[data-testid=status]").innerText(),"|",await p.locator("[data-testid=mode]").innerText());
  await p.locator("[data-testid=play]").click();await p.waitForFunction(()=>document.querySelector("[data-testid=play]")?.textContent==="Replay again",null,{timeout:120000});
  await layoutCheck(p,[".header .title",".header .actions",".cards",".strip-card",".tabs-card"],`room ${name}`);
  await p.locator(".tick.ov").first().click();await p.waitForTimeout(700);
  log(`ROOM ${name} pinned:`,await p.locator("[data-testid=pin]").innerText(),"| safety:",await p.locator("[data-testid=why-safety]").innerText());
  log(`ROOM ${name} why:`,(await p.locator("[data-testid=reasons]").innerText()).replace(/\n/g," / ").slice(0,400));
  await p.screenshot({path:`${OUT}/room-${name}.png`});if(name==="ipad-air-landscape"){await p.screenshot({path:`${OUT}/room-${name}-full.png`,fullPage:true});await p.getByRole("tab",{name:/Safety/}).click();log("SAFETY TAB",(await p.locator("[data-testid=safety]").innerText()).replace(/\n/g," / "))}
  log(`ERRORS room ${name}`,JSON.stringify(p.errs));await p.context().close();
 }
 // Security: script in a replay file, and cross-origin postMessage
 const x=await page(ROOM,IPADS["ipad-air-landscape"]);await x.waitForSelector("[data-testid=status]");await x.setInputFiles("[data-testid=replay-file]",`${FIX}/xss.jsonl`);await x.getByRole("button",{name:"Step"}).click();await x.waitForTimeout(300);
 log("XSS executed:",await x.evaluate(()=>window.__xss===1),"| injected:",await x.locator("#injected").count());await x.context().close();
 const co=await page(SIM+"?quality=low",IPADS["ipad-air-landscape"]);await co.evaluate(u=>{const f=document.createElement("iframe");f.src=u;f.id="cr";document.body.appendChild(f)},ROOM);
 const fr=await (await co.waitForSelector("#cr")).contentFrame();await fr.waitForSelector("[data-testid=status]");
 await co.evaluate(()=>document.getElementById("cr").contentWindow.postMessage({type:"FLIGHT_RUNTIME_EVENT",event:{type:"DECISION",frame:{id:"xo-1",startTick:"2",requestedIntent:"HOLD",executedIntent:"HOLD",provider:"other-origin",probability:1}}},"*"));await co.waitForTimeout(400);
 log("cross-origin accepted:",(await fr.locator("[data-testid=status]").innerText()).includes("1 decisions"));await co.context().close();
}
await b.close();
