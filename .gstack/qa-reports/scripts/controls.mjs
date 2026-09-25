// Controls matrix: every UI control in both apps, each with an asserted effect. node controls.mjs [sim|room|all]
import {chromium} from "playwright";import {readFileSync} from "node:fs";
const SIM="http://localhost:3200/",ROOM="http://localhost:3100/",FIX="/home/user/flight-simulator/.gstack/qa-reports/fixtures",OUT=process.env.OUT||".",what=process.argv[2]||"all";
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const results=[];const check=(area,control,ok,detail="")=>{results.push({area,control,ok:!!ok,detail});console.log(`${ok?"PASS":"FAIL"}  ${area} · ${control}${detail?`  — ${detail}`:""}`)};
async function page(url){const ctx=await b.newContext({viewport:{width:1180,height:820},hasTouch:true,acceptDownloads:true});const p=await ctx.newPage();p.errs=[];p.dialogs=[];
 p.on("console",m=>{if(m.type()==="error")p.errs.push(m.text().slice(0,160))});p.on("pageerror",e=>p.errs.push("uncaught: "+e.message));p.on("dialog",d=>{p.dialogs.push(d.message());d.dismiss()});await p.goto(url);return p}
const W=p=>p.evaluate(()=>{const w=flightSim.world,a=w.aircraft;return {t:Number(w.tick)/120,phase:w.objective.phase,y:a.position.y,vy:a.velocity.y,hdg:a.heading,spd:Math.hypot(a.velocity.x,a.velocity.y,a.velocity.z),pilot:flightSim.pilot,cam:flightSim.camera,paused:flightSim.paused}});
// React commits on the next animation frame: wait two frames before reading the DOM after any interaction.
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
const txt=async(p,s)=>{await settle(p);return p.locator(s).first().innerText()};
const waitText=(p,sel,re,ms=30000)=>p.waitForFunction(([sel,src])=>new RegExp(src).test(document.querySelector(sel)?.textContent??""),[sel,re.source],{timeout:ms});
async function waitT(p,dt){const t0=(await W(p)).t;for(let i=0;i<200;i++){if((await W(p)).t>=t0+dt)return;await p.waitForTimeout(150)}}
if(what==="sim"||what==="all"){
 const p=await page(SIM+"?quality=low&rate=4");await p.waitForFunction(()=>globalThis.flightSim?.world&&Number(flightSim.world.tick)>120*12,null,{timeout:180000});
 const A="Simulator";
 // Buttons
 await p.getByRole("button",{name:"Autopilot"}).click();check(A,"Autopilot button → manual",(await W(p)).pilot==="MANUAL"&&await txt(p,"[data-testid=pilot]")==="MANUAL");
 await p.getByRole("button",{name:"Autopilot"}).click();check(A,"Autopilot button → autopilot",(await W(p)).pilot==="AUTOPILOT");
 const cams=[];for(let i=0;i<4;i++){await p.getByRole("button",{name:"Camera"}).click();await p.waitForTimeout(250);cams.push((await W(p)).cam)}check(A,"Camera button cycles all views",cams.join(",")==="COCKPIT,ORBIT,TOWER,CHASE",cams.join(" → "));
 await p.getByRole("button",{name:"Pause"}).click();const pa=(await W(p)).t;await p.waitForTimeout(1500);const pb=(await W(p)).t;check(A,"Pause freezes simulated time",pa===pb&&await txt(p,"[data-testid=pause]")==="Resume",`${pa}s = ${pb}s`);
 await p.getByRole("button",{name:"Resume"}).click();await waitT(p,.5);check(A,"Resume continues",(await W(p)).t>pb);
 const rate=async()=>Number((await txt(p,".chip:has([data-testid=time]) .k:last-child")).replace("×",""));
 const r0=await rate();await p.getByRole("button",{name:"Faster"}).click();const r1=await rate();await p.getByRole("button",{name:"Slower"}).click();await p.getByRole("button",{name:"Slower"}).click();const r2=await rate();
 check(A,"+ / − time rate",r1>r0&&r2<r0,`×${r0} → ×${r1} → ×${r2}`);await p.getByRole("button",{name:"Faster"}).click();
 await p.getByRole("button",{name:"Instruments"}).click();const hid=!(await p.locator(".instruments").count());await p.getByRole("button",{name:"Instruments"}).click();check(A,"Instruments toggle hides/shows panel",hid&&await p.locator(".instruments").isVisible());
 await p.getByRole("button",{name:"Help"}).click();const h1=await p.getByRole("dialog").isVisible();await p.getByRole("button",{name:"Close"}).click();const h2=await p.getByRole("dialog").count();
 await p.getByRole("button",{name:"Help"}).click();await p.mouse.click(15,400);const h3=await p.getByRole("dialog").count();check(A,"Help opens; Close and backdrop dismiss",h1&&!h2&&!h3);
 // Touch yoke (each direction) — engages manual, holds, releases to HOLD. Restart first: after landing, a mission ends and ignores flight input.
 await p.keyboard.press("KeyR");await p.getByRole("button",{name:"Slower"}).click();await p.waitForFunction(()=>flightSim.world.aircraft.position.y>40,null,{timeout:180000});
 for(const [intent,test] of [["CLIMB",(a,b)=>b.vy>a.vy+1||b.y>a.y+3],["DESCEND",(a,b)=>b.vy<a.vy-1],["TURN_LEFT",(a,b)=>b.hdg<a.hdg-.05],["TURN_RIGHT",(a,b)=>b.hdg>a.hdg+.05],["SLOW",(a,b)=>b.spd<a.spd-1]]){
  const btn=p.locator(`.pad [data-intent="${intent}"]`);const a=await W(p);await btn.dispatchEvent("pointerdown",{pointerId:7});await waitT(p,2.5);const bb=await W(p);const shown=await txt(p,"[data-testid=mode]");
  await btn.dispatchEvent("pointerup",{pointerId:7});await p.waitForTimeout(300);const rel=await txt(p,"[data-testid=mode]");
  check(A,`Touch pad ${intent}`,bb.pilot==="MANUAL"&&shown===intent&&test(a,bb)&&rel==="HOLD",`${shown}; y ${a.y.toFixed(0)}→${bb.y.toFixed(0)} vy ${a.vy.toFixed(1)}→${bb.vy.toFixed(1)} hdg ${a.hdg.toFixed(2)}→${bb.hdg.toFixed(2)} spd ${a.spd.toFixed(0)}→${bb.spd.toFixed(0)}; release→${rel}`)}
 // Keyboard flight keys
 for(const [key,intent] of [["KeyW","CLIMB"],["ArrowUp","CLIMB"],["KeyS","DESCEND"],["ArrowDown","DESCEND"],["ArrowLeft","TURN_LEFT"],["KeyQ","TURN_LEFT"],["ArrowRight","TURN_RIGHT"],["KeyE","TURN_RIGHT"],["ShiftLeft","SLOW"],["KeyX","ABORT"]]){
  await p.keyboard.down(key);await p.waitForTimeout(250);const shown=await txt(p,"[data-testid=mode]");await p.keyboard.up(key);await p.waitForTimeout(250);check(A,`Key ${key}`,shown===intent&&await txt(p,"[data-testid=mode]")==="HOLD",`${shown} then HOLD`)}
 await p.keyboard.press("KeyA");check(A,"Key A toggles autopilot",(await W(p)).pilot==="AUTOPILOT");
 const kc=[];for(const k of ["Digit2","Digit3","Digit4","Digit1"]){await p.keyboard.press(k);await p.waitForTimeout(200);kc.push((await W(p)).cam)}check(A,"Keys 1–4 select cameras",kc.join(",")==="COCKPIT,ORBIT,TOWER,CHASE",kc.join(","));
 await p.keyboard.press("KeyC");await p.waitForTimeout(200);check(A,"Key C cycles camera",(await W(p)).cam==="COCKPIT");await p.keyboard.press("Digit1");
 await p.keyboard.press("KeyP");const k1=(await W(p)).paused;await p.keyboard.press("Space");check(A,"Keys P / Space pause & resume",k1&&!(await W(p)).paused);
 const kr0=await rate();await p.keyboard.press("Equal");const kr1=await rate();await p.keyboard.press("Minus");check(A,"Keys + / − change rate",kr1>kr0&&await rate()===kr0);
 await p.keyboard.press("KeyI");const ki=!(await p.locator(".instruments").count());await p.keyboard.press("KeyI");check(A,"Key I toggles instruments",ki&&await p.locator(".instruments").count()===1);
 await p.keyboard.press("KeyH");const kh=await p.getByRole("dialog").isVisible();await p.keyboard.press("Escape");check(A,"Keys H / Escape help",kh&&!(await p.getByRole("dialog").count()));
 // Orbit camera drag
 await p.keyboard.press("Digit3");await p.waitForTimeout(400);const c0=await p.evaluate(()=>0);await p.screenshot({path:`${OUT}/controls-orbit-before.png`});
 await p.mouse.move(590,400);await p.mouse.down();await p.mouse.move(760,330,{steps:8});await p.mouse.up();await p.waitForTimeout(800);await p.screenshot({path:`${OUT}/controls-orbit-after.png`});
 const same=readFileSync(`${OUT}/controls-orbit-before.png`).equals(readFileSync(`${OUT}/controls-orbit-after.png`));check(A,"Orbit camera drag rotates view",!same);await p.keyboard.press("Digit1");
 // Restart / New scenario (button and key)
 await p.getByRole("button",{name:"Restart"}).click();await p.waitForTimeout(600);const rs=await W(p);check(A,"Restart button",rs.t<3&&rs.phase==="OUTBOUND",`t=${rs.t.toFixed(1)}s`);
 await p.getByRole("button",{name:"New scenario"}).click();await p.waitForTimeout(800);const sc1=await p.evaluate(()=>new URL(location.href).search);check(A,"New scenario button",/scenario=seeded/.test(sc1)&&/seed=2/.test(sc1),sc1);
 await p.keyboard.press("KeyN");await p.waitForTimeout(800);const sc2=await p.evaluate(()=>new URL(location.href).search);await p.keyboard.press("KeyR");await p.waitForTimeout(600);check(A,"Keys N / R",/seed=3/.test(sc2)&&(await W(p)).t<3,sc2);
 check(A,"No console errors",!p.errs.length,JSON.stringify(p.errs));await p.context().close();
}
if(what==="room"||what==="all"){
 const p=await page(ROOM);await p.waitForSelector("[data-testid=status]");const A="Control Room";const btn=n=>p.getByRole("button",{name:n,exact:true});
 check(A,"Initial state: live, waiting; replay controls disabled",(await txt(p,"[data-testid=mode]")).includes("LIVE")&&await btn("Step").isDisabled()&&await p.locator("[data-testid=play]").isDisabled()&&await btn("Export telemetry").isDisabled());
 // Live bridge (same origin) + Pause UI + Export
 await p.evaluate(()=>{for(let i=1;i<=3;i++)window.postMessage({type:"FLIGHT_RUNTIME_EVENT",event:{type:"DECISION",frame:{id:`live-${i}`,startTick:String(i),requestedIntent:"HOLD",executedIntent:"HOLD",provider:"live",probability:.9}}},location.origin)});await p.waitForTimeout(300);
 check(A,"Live telemetry via same-origin postMessage",(await txt(p,"[data-testid=status]")).startsWith("3 decisions"));
 await btn("Pause UI").click();await p.evaluate(()=>flightControlRoom.showEvent({type:"DECISION",frame:{id:"live-4",startTick:4n,requestedIntent:"CLIMB",executedIntent:"CLIMB",provider:"live",probability:.8}}));await p.waitForTimeout(200);const frozen=await txt(p,"[data-testid=status]");
 await btn("Resume UI").click();await p.waitForTimeout(200);check(A,"Pause UI freezes view; Resume UI catches up",frozen.startsWith("3 ")&&(await txt(p,"[data-testid=status]")).startsWith("4 "),`${frozen} → ${await txt(p,"[data-testid=status]")}`);
 const [dl]=await Promise.all([p.waitForEvent("download"),btn("Export telemetry").click()]);const exp=readFileSync(await dl.path(),"utf8").trim().split("\n");check(A,"Export telemetry downloads JSONL",exp.length===4&&JSON.parse(exp[3]).frame.id==="live-4",`${exp.length} lines, ${dl.suggestedFilename()}`);
 // Replay: load / step / play / pause / replay again / back to live
 await p.setInputFiles("[data-testid=replay-file]",`${FIX}/override-storm.jsonl`);await p.waitForTimeout(200);
 check(A,"Load replay → fresh REPLAY state",(await txt(p,"[data-testid=mode]")).includes("REPLAY")&&(await txt(p,"[data-testid=status]")).includes("0/24"));
 await btn("Step").click();await btn("Step").click();check(A,"Step advances one event",(await txt(p,"[data-testid=status]")).includes("2/24"));
 await p.locator("[data-testid=play]").click();const playing=await txt(p,"[data-testid=play]");await p.waitForTimeout(350);await p.locator("[data-testid=play]").click();const paused=await txt(p,"[data-testid=play]");const pos=await txt(p,"[data-testid=status]");
 check(A,"Play / Pause replay",playing==="Pause replay"&&paused==="Play"&&!pos.includes("24/24"),pos);
 await p.locator("[data-testid=play]").click();await waitText(p,"[data-testid=play]",/^Replay again$/);
 const m1=await txt(p,".cards");check(A,"Replay runs to the end (Replay again, Step disabled)",await btn("Step").isDisabled()&&(await txt(p,"[data-testid=mode]")).includes("(end)"));
 await p.locator("[data-testid=play]").click();await waitText(p,"[data-testid=play]",/^Pause replay$/);await waitText(p,"[data-testid=status]",/replay [0-9]\//);await waitText(p,"[data-testid=play]",/^Replay again$/);check(A,"Replay again does not double count",await txt(p,".cards")===m1&&m1.includes("14"),m1.replace(/\n/g," "));
 // Alerts & watchdog from the override-storm recording
 const notes=await txt(p,".notices");check(A,"Alerts + watchdog findings shown",["override rate","OVERRIDE_STORM","DISAGREEMENT_ACCUMULATION","confidence","disagreement"].every(s=>notes.toLowerCase().includes(s.toLowerCase())),notes.replace(/\n/g," | ").slice(0,300));
 // Selection: strip tick, timeline row, follow latest
 await p.locator(".tick").nth(2).click();const pin1=await txt(p,"[data-testid=pin]");await p.locator("[data-testid=timeline] .decision").nth(5).click();const pin2=await txt(p,"[data-testid=pin]");
 check(A,"Decision strip tick pins a decision",pin1==="Pinned: s-3",pin1);check(A,"Timeline row pins a decision",pin2==="Pinned: s-9",pin2);
 check(A,"Why card shows the pinned decision (s-9 was accepted)",(await txt(p,"[data-testid=why-safety]")).includes("Accepted without override")&&(await txt(p,"[data-testid=reasons]")).includes("Shadow jev/j preferred CLIMB"));
 await btn("Resume live").click();check(A,"Resume live / Following latest",await txt(p,"[data-testid=pin]")==="Following latest decision"&&await btn("Following latest").isVisible());
 // Tabs
 const tabs={};for(const [name,sel] of [[/^Learning/,"pre"],[/^Safety/,"[data-testid=safety]"],[/^Raw telemetry/,".tabs-card pre"],[/^Timeline/,"[data-testid=timeline]"]]){await p.getByRole("tab",{name}).click();tabs[String(name)]=(await txt(p,`.tabs-card ${sel.replace(".tabs-card ","")}`)).slice(0,60)}
 check(A,"Tabs: Timeline / Learning / Safety / Raw",tabs["/^Learning/"].includes("XGBoost")&&tabs["/^Safety/"].includes("TERRAIN_CLEARANCE")&&tabs["/^Raw telemetry/"].includes("decisionId")&&tabs["/^Timeline/"].includes("s-14"),JSON.stringify(tabs).slice(0,200));
 await p.screenshot({path:`${OUT}/controls-room-alerts.png`});
 // Back to live, bad replay file
 await btn("Back to live").click();check(A,"Back to live",(await txt(p,"[data-testid=mode]")).includes("LIVE")&&(await txt(p,"[data-testid=status]"))==="waiting for telemetry");
 await p.setInputFiles("[data-testid=replay-file]",{name:"broken.jsonl",mimeType:"text/plain",buffer:Buffer.from("{not json\n")});await p.waitForTimeout(300);
 check(A,"Invalid replay file is reported, state kept",p.dialogs.some(d=>d.startsWith("Could not read replay"))&&(await txt(p,"[data-testid=mode]")).includes("LIVE"),p.dialogs.join(" | "));
 check(A,"No console errors",!p.errs.length,JSON.stringify(p.errs));await p.context().close();
}
const failed=results.filter(r=>!r.ok);console.log(`\nCONTROLS ${results.length-failed.length}/${results.length} passed`);await b.close();process.exit(failed.length?1:0);
