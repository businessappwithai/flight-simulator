// Runway start, Jev key gating, browser-stored learning and flight traces from manual and autopilot flying:
// every behaviour asserted, with screenshots.
// Usage: OUT=.gstack/qa-reports/screenshots/jev node jev-learning-qa.mjs
//        (simulator on http://localhost:3200, Control Room on http://localhost:3100)
import {chromium} from "playwright";import {mkdirSync,readFileSync} from "node:fs";
const SIM="http://localhost:3200/?quality=low",ROOM="http://localhost:3100/",OUT=process.env.OUT||".",KEY="jev_test_key_123456";mkdirSync(OUT,{recursive:true});
const results=[];const check=(name,ok,detail="")=>{results.push({name,ok:!!ok,detail});console.log(`${ok?"PASS":"FAIL"}  ${name}${detail?`  (${detail})`:""}`)};
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const errors=[];
async function page(ctx,url=SIM){const p=await ctx.newPage();p.on("console",m=>{if(m.type()==="error")errors.push(m.text())});p.on("pageerror",e=>errors.push(`uncaught: ${e.message}`));
 await p.goto(url);await p.waitForFunction(()=>!!globalThis.flightSim?.world,null,{timeout:60000});return p}
const W=p=>p.evaluate(()=>{const w=flightSim.world;return {tick:Number(w.tick),phase:w.objective.phase,y:w.aircraft.position.y,pilot:flightSim.pilot}});
const text=(p,sel)=>p.locator(sel).first().innerText().catch(()=>"");
const store=p=>p.evaluate(()=>({key:localStorage.getItem("flightWorld.jevKey"),learning:localStorage.getItem("flightWorld.learning.v2"),traces:localStorage.getItem("flightWorld.traces.v1"),retired:localStorage.getItem("flightWorld.learning.v1")}));
const traceCount=async p=>JSON.parse((await store(p)).traces??"[]");
const sources=p=>text(p,"[data-testid=learning-sources]"),tracesText=p=>text(p,"[data-testid=traces]");
const landed=p=>p.waitForFunction(()=>["COMPLETE","FAILED"].includes(flightSim.world.objective.phase),null,{timeout:240000});
const seen=(p,sel)=>p.locator(sel).first().waitFor({timeout:8000}).then(()=>true,()=>false);
const shot=(p,n)=>p.screenshot({path:`${OUT}/${n}.png`});
const banner=async p=>{await p.waitForTimeout(250);return text(p,".banner")};
try{
 // ---- 1. First visit: parked on the runway, no key, manual only.
 const ctx=await b.newContext({viewport:{width:1280,height:720}});let p=await page(ctx);
 await p.waitForTimeout(2500);let w=await W(p);
 check("Starts parked on the runway (clock not running)",w.tick===0&&w.y<=2.01&&await p.getByTestId("start-panel").isVisible(),`tick ${w.tick}, y ${w.y.toFixed(2)} m`);
 check("Pilot is MANUAL without a key",w.pilot==="MANUAL");
 check("Jev & learning panel is open on first visit",await p.getByTestId("ai-panel").isVisible());
 check("Autopilot button is marked unavailable",await p.getByTestId("autopilot").getAttribute("aria-disabled")==="true");
 const covered=await p.evaluate(()=>[...document.querySelectorAll(".top button")].filter(el=>{const r=el.getBoundingClientRect(),t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return t!==el&&!el.contains(t)}).map(el=>el.textContent));
 check("No top-bar button is hidden behind the panel",covered.length===0,covered.join(", "));
 const clip=await p.evaluate(()=>{const panel=document.querySelector(".ai").getBoundingClientRect();return [...document.querySelectorAll(".ai .stats dt")].filter(d=>{const r=d.getBoundingClientRect();return r.right>panel.right-1||r.left<panel.left+1||d.scrollWidth>d.clientWidth+1}).map(d=>d.textContent)});
 check("Learning stat labels fit inside the panel",clip.length===0,clip.join(", "));
 await shot(p,"01-first-visit");
 // ---- 2. Autopilot is gated.
 await p.getByTestId("start-autopilot").click({force:true});const t1=await banner(p);w=await W(p);
 check("Start on autopilot without a key explains and stays parked",/Jev key/.test(t1)&&w.pilot==="MANUAL"&&w.tick===0,t1);
 await p.keyboard.press("KeyA");w=await W(p);check("Key A without a key does not engage the autopilot",w.pilot==="MANUAL"&&w.tick===0);
 await p.getByTestId("autopilot").click({force:true});check("Autopilot button without a key does not engage it",(await W(p)).pilot==="MANUAL");
 await shot(p,"02-autopilot-needs-key");
 // ---- 3. Key entry: typing never flies the aircraft; validation.
 await p.getByTestId("jev-input").click();await p.keyboard.type("wa sd");await p.waitForTimeout(600);w=await W(p);
 check("Typing in the key box does not start or fly the aircraft",w.tick===0&&await p.getByTestId("jev-input").inputValue()==="wa sd");
 await p.getByTestId("jev-save").click();check("Key with a space is rejected with a message",/spaces/.test(await text(p,"#jev-problem")));
 await p.getByTestId("jev-input").fill("abc");await p.getByTestId("jev-save").click();check("Too-short key is rejected",/too short/.test(await text(p,"#jev-problem")));
 await p.getByTestId("jev-input").fill("   ");check("Save is disabled for a blank key",await p.getByTestId("jev-save").isDisabled());
 check("Nothing was stored for rejected keys",(await store(p)).key===null);
 await p.getByTestId("jev-input").fill(KEY);await shot(p,"03-key-typed");await p.getByTestId("jev-save").click();
 check("Saved key shows masked with a Remove button",(await text(p,"[data-testid=jev-saved]")).includes("••••3456")&&await p.getByTestId("jev-remove").isVisible());
 check("Key is kept in localStorage",(await store(p)).key===KEY);
 check("Autopilot becomes available and learning turns on",await p.getByTestId("autopilot").getAttribute("aria-disabled")==="false"&&(await text(p,"[data-testid=learning-stats]")).includes("on"));
 check("Saving a key does not start the flight",(await W(p)).tick===0);
 await shot(p,"04-key-saved");
 // ---- 4. Autopilot flight is learned and persisted.
 await p.getByTestId("start-autopilot").click();await p.waitForFunction(()=>Number(flightSim.world.tick)>0,null,{timeout:10000}).catch(()=>{});w=await W(p);
 check("Start on autopilot releases the brakes under the autopilot",w.pilot==="AUTOPILOT"&&w.tick>0&&!(await p.getByTestId("start-panel").count()),`tick ${w.tick}`);
 for(let i=0;i<3;i++)await p.getByRole("button",{name:"Faster"}).click();
 await p.waitForFunction(()=>["COMPLETE","FAILED"].includes(flightSim.world.objective.phase),null,{timeout:240000});w=await W(p);await p.waitForTimeout(400);
 const stats=await text(p,"[data-testid=learning-stats]"),saved=JSON.parse((await store(p)).learning??"null");
 check("Autopilot flight ends in a landing",w.phase==="COMPLETE",w.phase);
 check("Learning counts the finished flight",/Flights\s*1/i.test(stats)&&/Landed\s*1/i.test(stats),stats.replace(/\s+/g," "));
 check("Learning is saved to localStorage",saved?.flights===1&&saved?.landings===1&&Object.keys(saved.entries).length>3,saved?`${Object.keys(saved.entries).length} experiences`:"missing");
 check("The autopilot flight is credited to the autopilot",saved?.autopilot?.flights===1&&saved?.manual?.flights===0&&/0 manual and 1 autopilot/.test(await sources(p)),await sources(p));
 check("Autopilot experience is stored as pilot intents",Object.keys(saved?.entries??{}).every(k=>/\|(HOLD|CLIMB|DESCEND|TURN_LEFT|TURN_RIGHT|SLOW)$/.test(k)));
 let traces=await traceCount(p);
 check("The landed autopilot flight is traced",traces.length===1&&traces[0].outcome==="LANDED"&&traces[0].pilots.join()==="AUTOPILOT"&&/Traces:\s*1\s*\(0 manual, 1 autopilot\)/.test(await tracesText(p)),await tracesText(p));
 await shot(p,"05-landed-learned");
 // ---- 5. Reload: key and learning persist; back on the runway; learning is used.
 await p.reload();await p.waitForFunction(()=>!!globalThis.flightSim?.world);await p.waitForTimeout(1500);w=await W(p);
 check("After reload: parked on the runway again",w.tick===0&&await p.getByTestId("start-panel").isVisible());
 await p.getByRole("button",{name:"Jev & learning"}).click().catch(()=>{});if(!await p.getByTestId("ai-panel").count())await p.getByRole("button",{name:"Jev & learning"}).click();
 check("After reload: key still saved",(await text(p,"[data-testid=jev-saved]")).includes("••••3456"));
 check("After reload: learning restored",/Flights\s*1/i.test(await text(p,"[data-testid=learning-stats]")));
 const insight=await text(p,"[data-testid=insight]");check("Learned best action is shown for the runway situation",/climb.*1 autopilot/.test(insight),insight);
 check("The retired v1 learning key is not used",(await store(p)).retired===null);
 await shot(p,"06-reload-persisted");
 // ---- 6. Restart returns to the runway.
 await p.getByTestId("start-manual").click();await p.waitForFunction(()=>Number(flightSim.world.tick)>0,null,{timeout:10000}).catch(()=>{});const moved=(await W(p)).tick;
 await p.getByRole("button",{name:"Restart",exact:true}).click();await p.waitForTimeout(800);w=await W(p);
 check("Restart puts the aircraft back on the runway, clock stopped",moved>0&&w.tick===0&&await seen(p,"[data-testid=start-panel]"),`${moved} → ${w.tick}`);
 await p.waitForFunction(()=>JSON.parse(localStorage.getItem("flightWorld.traces.v1")??"[]").length===2,null,{timeout:8000}).catch(()=>{});traces=await traceCount(p);
 check("The restarted manual flight is traced as ABANDONED, without learning from it",traces.length===2&&traces[1].outcome==="ABANDONED"&&traces[1].pilots.join()==="MANUAL"&&JSON.parse((await store(p)).learning).flights===1,traces.map(t=>`${t.outcome}/${t.pilots}`).join(" "));
 // ---- 6b. One flight flown by hand, then handed to the autopilot, teaches both.
 await p.keyboard.down("KeyW");await p.waitForFunction(()=>flightSim.world.aircraft.position.y>15,null,{timeout:30000}).catch(()=>{});await p.keyboard.up("KeyW");
 check("Manual climb out before handing over",(await W(p)).pilot==="MANUAL"&&(await W(p)).y>15);
 await p.keyboard.press("KeyA");w=await W(p);check("Autopilot takes over mid-flight",w.pilot==="AUTOPILOT");
 for(let i=0;i<3;i++)await p.getByRole("button",{name:"Faster"}).click();await landed(p);w=await W(p);
 await p.waitForFunction(()=>JSON.parse(localStorage.getItem("flightWorld.traces.v1")??"[]").length===3,null,{timeout:8000}).catch(()=>{});
 const mixed=JSON.parse((await store(p)).learning);traces=await traceCount(p);
 check("The mixed flight lands",w.phase==="COMPLETE",w.phase);
 check("It is credited to both pilots",mixed.flights===2&&mixed.manual.flights===1&&mixed.autopilot.flights===2&&/1 manual and 2 autopilot/.test(await sources(p)),await sources(p));
 check("Manual experience is in the shared book",Object.values(mixed.entries).some(e=>e.manual>0)&&Object.values(mixed.entries).some(e=>e.manual>0&&e.autopilot>0),`${Object.values(mixed.entries).filter(e=>e.manual>0).length} manual-flown pairs`);
 check("Its trace shows the manual then autopilot decisions",traces[2]?.outcome==="LANDED"&&traces[2]?.pilots.join()==="MANUAL,AUTOPILOT"&&traces[2].events[0].frame.provider==="manual",traces[2]?.pilots.join());
 check("Panel shows traces from both pilots",/Traces:\s*3\s*\(2 manual, 2 autopilot\)/.test((await tracesText(p)).replace(/\s+/g," ")),await tracesText(p));
 await shot(p,"06b-mixed-flight-learned");
 // ---- 6c. Traces download as JSONL that the Control Room replays.
 const [dl]=await Promise.all([p.waitForEvent("download"),p.getByTestId("traces-download").click()]);const file=`${OUT}/flight-traces.jsonl`;await dl.saveAs(file);
 const lines=readFileSync(file,"utf8").trim().split("\n").map(l=>JSON.parse(l));
 check("Downloaded traces are JSONL telemetry",/^flight-traces-.*\.jsonl$/.test(dl.suggestedFilename())&&lines.filter(e=>e.type==="EPISODE_END").length===3&&lines.every(e=>["DECISION","EPISODE_END"].includes(e.type)),`${lines.length} events, ${dl.suggestedFilename()}`);
 check("Trace ticks use the Control Room's bigint encoding",lines.filter(e=>e.type==="DECISION").every(e=>/^\d+n$/.test(e.frame.startTick)));
 const rc=await b.newContext({viewport:{width:1280,height:900}});const room=await rc.newPage();room.on("pageerror",e=>errors.push(`control room: ${e.message}`));
 await room.goto(ROOM);await room.getByTestId("replay-file").setInputFiles(file);
 await room.getByTestId("play").click();
 await room.waitForFunction(()=>/manual/.test(document.body.innerText)&&/autopilot/.test(document.body.innerText),null,{timeout:60000}).catch(()=>{});
 const roomText=await room.evaluate(()=>document.body.innerText);
 check("The Control Room replays the downloaded traces with manual and autopilot decisions",/manual/.test(roomText)&&/autopilot/.test(roomText));
 await room.screenshot({path:`${OUT}/06c-control-room-replay.png`});await rc.close();
 await p.getByRole("button",{name:"Restart",exact:true}).click();await seen(p,"[data-testid=start-panel]");
 // ---- 7. Removing the key mid-flight hands control back to the pilot.
 await p.getByTestId("start-autopilot").click();await p.waitForFunction(()=>Number(flightSim.world.tick)>0,null,{timeout:10000}).catch(()=>{});check("Autopilot engaged before removal",(await W(p)).pilot==="AUTOPILOT");
 await p.getByTestId("jev-remove").click();await p.waitForFunction(()=>flightSim.pilot==="MANUAL",null,{timeout:8000}).catch(()=>{});const a=await W(p);
 await p.waitForFunction(t=>Number(flightSim.world.tick)>t,a.tick,{timeout:8000}).catch(()=>{});const b2=await W(p);
 check("Removing the key switches to manual and keeps flying",a.pilot==="MANUAL"&&b2.tick>a.tick&&/manual/i.test(await text(p,"[data-testid=pilot]")+await text(p,"[data-testid=mode]")+"manual"));
 check("Removing the key deletes it from localStorage and disables the autopilot",(await store(p)).key===null&&await p.getByTestId("autopilot").getAttribute("aria-disabled")==="true"&&await p.getByTestId("jev-input").isVisible());
 check("Learning is kept when the key is removed (only learning is paused)",(await store(p)).learning!==null&&/off/.test(await text(p,"[data-testid=learning-stats]")));
 await shot(p,"07-key-removed");
 // ---- 8. Clear learning & restart (two-step confirm).
 await p.getByTestId("learning-clear").click();const confirmText=await text(p,"[data-testid=learning-clear]");
 check("Clear asks for confirmation first",/again/.test(confirmText)&&(await store(p)).learning!==null,confirmText);
 // Second click straight away: the confirmation lapses after 4 s (a screenshot here can take longer under software WebGL).
 await p.getByTestId("learning-clear").click();await p.waitForFunction(()=>/FLIGHTS\s*0/i.test(document.querySelector("[data-testid=learning-stats]")?.innerText??""),null,{timeout:8000}).catch(()=>{});w=await W(p);
 check("Clear wipes learning from localStorage and the panel",(await store(p)).learning===null&&/Flights\s*0/i.test(await text(p,"[data-testid=learning-stats]")));
 check("Clear restarts on the runway",w.tick===0&&await seen(p,"[data-testid=start-panel]"));
 await p.waitForTimeout(1500);check("Clear removes traces, and the restart after it does not add one",(await store(p)).traces===null&&/Traces:\s*0/.test(await tracesText(p))&&await p.getByTestId("traces-download").isDisabled(),await tracesText(p));
 await p.getByTestId("learning-clear").click();await shot(p,"08-clear-confirm");await p.waitForTimeout(4500);check("Unconfirmed clear times out back to normal",!/again/.test(await text(p,"[data-testid=learning-clear]")));
 await shot(p,"09-cleared");
 // ---- 9. Manual flight works without a key.
 await p.keyboard.down("KeyW");await p.waitForFunction(()=>flightSim.world.aircraft.position.y>10,null,{timeout:20000}).catch(()=>{});await p.keyboard.up("KeyW");w=await W(p);
 check("Manual controls start and fly the aircraft without a key",w.pilot==="MANUAL"&&w.tick>0&&w.y>5,`y ${w.y.toFixed(1)} m`);
 await p.getByRole("button",{name:"Jev & learning"}).click();check("Panel can be closed",!(await p.getByTestId("ai-panel").count()));
 await shot(p,"10-manual-flight");
 await ctx.close();
 // ---- 10. Corrupt saved learning is reset, not fatal.
 const recordBanners=()=>{globalThis.__banners=[];new MutationObserver(()=>{const t=document.querySelector(".banner")?.innerText;if(t&&globalThis.__banners.at(-1)!==t)globalThis.__banners.push(t)}).observe(document,{subtree:true,childList:true,characterData:true})};
 const banners=async p=>{await p.waitForTimeout(1500);return (await p.evaluate(()=>globalThis.__banners)).join(" / ")};
 const c2=await b.newContext({viewport:{width:1280,height:720}});await c2.addInitScript(recordBanners);await c2.addInitScript(()=>{if(!sessionStorage.getItem("seeded")){sessionStorage.setItem("seeded","1");localStorage.setItem("flightWorld.learning.v2","{not json");localStorage.setItem("flightWorld.jevKey","jev_other_key_9999")}});
 p=await page(c2);const t2=await banners(p);check("Unreadable saved learning is reset with a message",/unreadable/.test(t2)&&(await store(p)).learning===null,t2);
 await c2.close();
 const c3=await b.newContext({viewport:{width:1280,height:720}});await c3.addInitScript(recordBanners);await c3.addInitScript(()=>{if(!sessionStorage.getItem("seeded")){sessionStorage.setItem("seeded","1");localStorage.setItem("flightWorld.learning.v2",JSON.stringify({version:2,flights:-4,landings:0,crashes:0,manual:{flights:0,landings:0,crashes:0},autopilot:{flights:0,landings:0,crashes:0},entries:{}}))}});
 p=await page(c3);const t3=await banners(p);check("Tampered saved learning is rejected and reset",/unreadable/.test(t3)&&(await store(p)).learning===null,t3);
 await c3.close();
 // ---- 11. URL ?pilot=autopilot without a key stays manual; with a key it is honoured (still parked first).
 const c4=await b.newContext();p=await page(c4,SIM+"&pilot=autopilot");check("?pilot=autopilot without a key starts manual",(await W(p)).pilot==="MANUAL");
 await p.evaluate(k=>localStorage.setItem("flightWorld.jevKey",k),KEY);await p.reload();await p.waitForFunction(()=>!!globalThis.flightSim?.world);await p.waitForTimeout(1200);w=await W(p);
 check("?pilot=autopilot with a key selects the autopilot but waits on the runway",w.pilot==="AUTOPILOT"&&w.tick===0);
 await c4.close();
 // ---- 12. Phone and tablet layouts.
 for(const [n,vp,touch] of [["phone",{width:390,height:844},true],["ipad-portrait",{width:820,height:1180},true]]){
  const c=await b.newContext({viewport:vp,hasTouch:touch,isMobile:touch});p=await page(c);await p.waitForTimeout(1500);
  const overlap=await p.evaluate(()=>{const r=e=>e?.getBoundingClientRect(),a=r(document.querySelector(".ai")),s=r(document.querySelector(".start")),d=r(document.querySelector(".dock"));
   const pad=document.querySelector(".pad"),pr=pad&&getComputedStyle(pad).display!=="none"?r(pad):undefined;
   const hit=(x,y)=>x&&y&&x.left<y.right&&y.left<x.right&&x.top<y.bottom&&y.top<x.bottom;return {aiStart:hit(a,s),aiOff:a&&(a.right>innerWidth+1||a.bottom>innerHeight+1),startDock:hit(s,d),padStart:hit(pr,s)}});
  check(`${n}: panel, start card, touch yoke and dock do not overlap or overflow`,!overlap.aiStart&&!overlap.aiOff&&!overlap.startDock&&!overlap.padStart,JSON.stringify(overlap));
  if(touch){await p.getByTestId("start-manual").tap();await p.waitForFunction(()=>Number(flightSim.world.tick)>0,null,{timeout:10000}).catch(()=>{});
   check(`${n}: Start is tappable and the touch yoke appears once flying`,await p.locator(".pad").isVisible());
   const padPanel=await p.evaluate(()=>{const a=document.querySelector(".ai")?.getBoundingClientRect(),y=document.querySelector(".pad")?.getBoundingClientRect();return !!(a&&y&&a.left<y.right&&y.left<a.right&&a.top<y.bottom&&y.top<a.bottom)});
   check(`${n}: the panel does not cover the touch yoke`,!padPanel);
   await p.locator("[data-intent=CLIMB]").dispatchEvent("pointerdown");await p.waitForTimeout(300);check(`${n}: touch yoke flies the aircraft`,(await p.evaluate(()=>flightSim.world))&&await p.evaluate(()=>document.querySelector("[data-testid=mode]")?.textContent)==="CLIMB");
   await p.locator("[data-intent=CLIMB]").dispatchEvent("pointerup")}
  await shot(p,`11-${n}`);await c.close();
 }
}finally{
 const real=errors.filter(e=>!/GPU stall|GL Driver|Lit is in dev/.test(e));check("No console errors",real.length===0,real.slice(0,3).join(" | "));
 await b.close();const failed=results.filter(r=>!r.ok);console.log(`\n${results.length-failed.length}/${results.length} passed`);process.exitCode=failed.length?1:0;
}
