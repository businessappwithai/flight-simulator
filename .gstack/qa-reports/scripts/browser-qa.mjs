import {chromium} from "playwright";
const OUT=process.env.OUT, REPO="/home/user/flight-simulator", tag=process.env.TAG||"before";
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=swiftshader","--enable-unsafe-swiftshader"]});
const log=(...a)=>console.log(...a);
async function page(vp={width:1440,height:900}){const ctx=await b.newContext({viewport:vp,acceptDownloads:true});const p=await ctx.newPage();p.errs=[];p.on("console",m=>{if(m.type()==="error")p.errs.push(m.text())});p.on("pageerror",e=>p.errs.push("uncaught: "+e.message));return p}
const txt=async(p,id)=>(await p.locator("#"+id).innerText()).trim();
// ---- Control Room
let p=await page();const t0=Date.now();await p.goto("http://localhost:3100/");await p.waitForLoadState("networkidle");log("LOAD_MS",Date.now()-t0);
await p.screenshot({path:`${OUT}/${tag}-inspector-initial.png`});log("status:",await txt(p,"status"));
await p.setInputFiles("#replayFile",`${REPO}/.gstack/qa-reports/fixtures/flight-42.jsonl`);await p.waitForTimeout(200);log("after load:",await txt(p,"status"));
for(let i=0;i<8;i++)await p.click("#replayStep");
log("after 8 steps: decisions",await txt(p,"mDecisions"),"| selected",await txt(p,"selectedIntent"),"| provider",await txt(p,"provider"));
await p.screenshot({path:`${OUT}/${tag}-inspector-stepped.png`});
await p.click("#replayPlay");log("play button:",await txt(p,"replayPlay"));await p.waitForTimeout(40000/1);
log("after play: status",await txt(p,"status"),"| decisions",await txt(p,"mDecisions"),"| overrides",await txt(p,"mOverrides"),"| play button:",await txt(p,"replayPlay"),"| LIVE badge:",await p.locator(".live").innerText());
log("safety tab:",JSON.stringify((await p.locator("#safetyBody").innerText()).slice(0,200)));log("watchdog:",JSON.stringify(await txt(p,"watchdog")),"alerts:",JSON.stringify(await txt(p,"alerts")));
// pick an overridden decision
const rows=p.locator("#decisions .decision");log("timeline rows",await rows.count());
const ov=rows.filter({hasText:"→"}).first();if(await ov.count()){await ov.click();log("pinned:",await txt(p,"pinState"),"| safety:",await txt(p,"selectedSafety"));log("reasons:",JSON.stringify(await txt(p,"reasons")));log("outcomes:",(await txt(p,"outcomes")).replace(/\s+/g," ").slice(0,200))}
await p.screenshot({path:`${OUT}/${tag}-inspector-override-selected.png`});
for(const tab of ["learning","safety","raw"]){await p.click(`[data-tab=${tab}]`);log(`tab ${tab} visible:`,await p.locator("#"+tab).isVisible(),"|",(await p.locator("#"+tab).innerText()).replace(/\s+/g," ").slice(0,160))}
await p.screenshot({path:`${OUT}/${tag}-inspector-raw-tab.png`});
await p.click("#follow");log("follow:",await txt(p,"pinState"));
const [dl]=await Promise.all([p.waitForEvent("download"),p.click("#export")]);const path=await dl.path();const lines=(await import("fs")).readFileSync(path,"utf8").split("\n").filter(Boolean).length;log("export lines:",lines,"(replayed file has",(await import("fs")).readFileSync(`${REPO}/.gstack/qa-reports/fixtures/flight-42.jsonl`,"utf8").split("\n").filter(Boolean).length,")");
// load the same replay again — does it reset?
await p.setInputFiles("#replayFile",[]);await p.setInputFiles("#replayFile",`${REPO}/.gstack/qa-reports/fixtures/flight-42.jsonl`);await p.click("#replayStep");log("reload replay + 1 step: decisions",await txt(p,"mDecisions"));
log("INSPECTOR_CONSOLE_ERRORS=",JSON.stringify(p.errs));
// XSS via replay file
let x=await page();await x.goto("http://localhost:3100/");await x.setInputFiles("#replayFile",`${REPO}/.gstack/qa-reports/fixtures/xss.jsonl`);await x.click("#replayStep");await x.waitForTimeout(300);
log("XSS executed:",await x.evaluate(()=>window.__xss===1),"| injected element:",await x.locator("#injected").count());
// XSS via cross-origin postMessage
await x.evaluate(()=>window.postMessage({type:"FLIGHT_RUNTIME_EVENT",event:{type:"DECISION",frame:{id:"pm-1",startTick:"2",requestedIntent:"HOLD",executedIntent:"HOLD",provider:"any-origin",probability:1}}},"*"));await x.waitForTimeout(200);
log("postMessage accepted w/o origin check:",(await x.locator("#decisions").innerText()).includes("pm-1"));
// cross-origin postMessage: page on :3200 frames the Control Room on :3100
let co=await page();await co.goto("http://localhost:3200/");await co.evaluate(()=>{const f=document.createElement("iframe");f.src="http://localhost:3100/";f.id="cr";document.body.appendChild(f)});
const fr=await (await co.waitForSelector("#cr")).contentFrame();await fr.waitForLoadState("networkidle");
await co.evaluate(()=>document.getElementById("cr").contentWindow.postMessage({type:"FLIGHT_RUNTIME_EVENT",event:{type:"DECISION",frame:{id:"xo-1",startTick:"2",requestedIntent:"HOLD",executedIntent:"HOLD",provider:"other-origin",probability:1}}},"*"));await co.waitForTimeout(300);
log("cross-origin postMessage accepted:",(await fr.locator("#decisions").innerText()).includes("xo-1"));
// mobile
let m=await page({width:375,height:812});await m.goto("http://localhost:3100/");await m.setInputFiles("#replayFile",`${REPO}/.gstack/qa-reports/fixtures/flight-42.jsonl`);for(let i=0;i<10;i++)await m.click("#replayStep");
log("mobile scrollWidth",await m.evaluate(()=>document.documentElement.scrollWidth),"vs 375");await m.screenshot({path:`${OUT}/${tag}-inspector-mobile.png`,fullPage:true});
// ---- 3D simulator
let s=await page();await s.goto("http://localhost:3200/");await s.waitForTimeout(2500);
log("canvas count",await s.locator("canvas").count());await s.screenshot({path:`${OUT}/${tag}-simulator.png`});
const w=await s.evaluate(()=>performance.getEntriesByType("resource").map(r=>r.name).filter(n=>/worker/.test(n)));log("worker resources:",JSON.stringify(w));
log("SIM_CONSOLE_ERRORS=",JSON.stringify(s.errs));
await b.close();
