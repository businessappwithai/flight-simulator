// Smoke test for the published site (GitHub Pages or the same files served locally), with screenshots.
// SITE=https://<owner>.github.io/flight-simulator/ OUT=shots node .github/scripts/pages-smoke.mjs
// Optional: CHROMIUM=/path/to/chrome (defaults to Playwright's own Chromium).
import {chromium} from "playwright";import {appendFileSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
const SITE=(process.env.SITE??"http://localhost:8000/flight-simulator/").replace(/\/?$/,"/"),OUT=process.env.OUT??"pages-screenshots",KEY="ci_smoke_key_2468";
mkdirSync(OUT,{recursive:true});
const results=[];const check=(name,ok,detail="")=>{results.push({name,ok:!!ok,detail});console.log(`${ok?"PASS":"FAIL"}  ${name}${detail?`  (${detail})`:""}`)};
// Software WebGL: GitHub-hosted runners have no GPU.
const b=await chromium.launch({executablePath:process.env.CHROMIUM||undefined,args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const errors=[];
async function open(ctx,url){const p=await ctx.newPage();p.on("console",m=>{if(m.type()==="error")errors.push(m.text())});p.on("pageerror",e=>errors.push(`uncaught: ${e.message}`));await p.goto(url);return p}
const ready=p=>p.waitForFunction(()=>!!globalThis.flightSim?.world,null,{timeout:90000});
const W=p=>p.evaluate(()=>{const w=flightSim.world;return {tick:Number(w.tick),phase:w.objective.phase,y:w.aircraft.position.y,pilot:flightSim.pilot}});
const text=(p,sel)=>p.locator(sel).first().innerText().catch(()=>"");
const shot=(p,n)=>p.screenshot({path:`${OUT}/${n}.png`});
try{
 // 1. First visit: parked on runway 18, manual only, key box offered.
 const ctx=await b.newContext({viewport:{width:1280,height:720}});const p=await open(ctx,`${SITE}?quality=low`);await ready(p);await p.waitForTimeout(2500);
 let w=await W(p);
 check("Site loads the simulator from Pages (page, bundle and worker)",w.tick===0);
 check("Parked on the runway with the clock stopped",w.tick===0&&await p.getByTestId("start-panel").isVisible());
 check("Manual pilot and key box offered without a key",w.pilot==="MANUAL"&&await p.getByTestId("jev-input").isVisible());
 await shot(p,"01-first-visit");
 // 2. Save a Jev key.
 await p.getByTestId("jev-input").fill(KEY);await p.getByTestId("jev-save").click();
 check("Jev key saved and masked",(await text(p,"[data-testid=jev-saved]")).includes(`••••${KEY.slice(-4)}`));
 await shot(p,"02-key-saved");
 // 3. Fly by hand, hand over to the autopilot, land: both pilots learn and are traced.
 await p.keyboard.down("KeyW");await p.waitForFunction(()=>flightSim.world.aircraft.position.y>15,null,{timeout:60000}).catch(()=>{});await p.keyboard.up("KeyW");
 check("Manual controls fly the aircraft",(await W(p)).y>15);
 await p.keyboard.press("KeyA");check("Autopilot takes over",(await W(p)).pilot==="AUTOPILOT");
 for(let i=0;i<3;i++)await p.getByRole("button",{name:"Faster"}).click();
 await shot(p,"03-flying");
 await p.waitForFunction(()=>["COMPLETE","FAILED"].includes(flightSim.world.objective.phase),null,{timeout:420000});w=await W(p);
 await p.waitForFunction(()=>(localStorage.getItem("flightWorld.traces.v1")??"").length>2,null,{timeout:15000}).catch(()=>{});
 check("The flight lands",w.phase==="COMPLETE",w.phase);
 check("Learning is credited to both pilots",/1 manual and 1 autopilot/.test(await text(p,"[data-testid=learning-sources]")),await text(p,"[data-testid=learning-sources]"));
 check("The flight is traced for both pilots",/Traces:\s*1\s*\(1 manual, 1 autopilot\)/.test(await text(p,"[data-testid=traces]")),await text(p,"[data-testid=traces]"));
 await shot(p,"04-landed");
 // 4. Reload: key, learning and traces persist in this browser; back on the runway.
 await p.reload();await ready(p);await p.waitForTimeout(2000);
 if(!await p.getByTestId("ai-panel").count())await p.getByRole("button",{name:"Jev & learning"}).click();
 w=await W(p);
 check("After reload: parked on the runway with key and learning kept",w.tick===0&&(await text(p,"[data-testid=jev-saved]")).includes("••••")&&/FLIGHTS\s*1/i.test(await text(p,"[data-testid=learning-stats]")));
 const insight=await text(p,"[data-testid=insight]");check("The learned best action is shown",/Best known here/.test(insight),insight);
 await shot(p,"05-reloaded");
 // 5. Download traces and replay them in the Control Room published alongside.
 const [dl]=await Promise.all([p.waitForEvent("download"),p.getByTestId("traces-download").click()]);const file=`${OUT}/flight-traces.jsonl`;await dl.saveAs(file);
 const lines=readFileSync(file,"utf8").trim().split("\n").map(l=>JSON.parse(l));
 check("Traces download as JSONL",lines.some(e=>e.type==="EPISODE_END")&&lines.some(e=>e.frame?.provider==="manual")&&lines.some(e=>e.frame?.provider==="autopilot"),`${lines.length} events`);
 const room=await open(ctx,`${SITE}control-room/`);await room.getByTestId("replay-file").setInputFiles(file);await room.getByTestId("play").click();
 await room.waitForFunction(()=>/manual/.test(document.body.innerText)&&/autopilot/.test(document.body.innerText),null,{timeout:60000}).catch(()=>{});
 const rt=await room.evaluate(()=>document.body.innerText);check("The Control Room replays the traces",/manual/.test(rt)&&/autopilot/.test(rt));
 await room.screenshot({path:`${OUT}/06-control-room-replay.png`});
 await ctx.close();
 // 6. Phone layout.
 const phone=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const m=await open(phone,`${SITE}?quality=low`);await ready(m);await m.waitForTimeout(2000);
 const overlap=await m.evaluate(()=>{const r=s=>document.querySelector(s)?.getBoundingClientRect(),a=r(".ai"),s=r(".start");return !!(a&&s&&a.left<s.right&&s.left<a.right&&a.top<s.bottom&&s.top<a.bottom)});
 check("Phone: panel and Start card do not overlap",!overlap);
 await shot(m,"07-phone");await phone.close();
}catch(e){check("Smoke test ran to completion",false,e instanceof Error?e.message.split("\n")[0]:String(e))}
finally{
 const real=errors.filter(e=>!/GPU stall|GL Driver|Lit is in dev|React DevTools/.test(e));check("No console errors",real.length===0,real.slice(0,3).join(" | "));
 await b.close();
 const failed=results.filter(r=>!r.ok);
 writeFileSync(`${OUT}/results.json`,JSON.stringify({site:SITE,passed:results.length-failed.length,total:results.length,results},null,2));
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,[`### Smoke test: ${SITE}`,"",`**${results.length-failed.length}/${results.length} checks passed.** Screenshots are in the \`pages-screenshots\` artifact.`,"","| | Check | Detail |","|---|---|---|",...results.map(r=>`| ${r.ok?"✅":"❌"} | ${r.name} | ${r.detail.replaceAll("|","\\|")} |`),""].join("\n"));
 console.log(`\n${results.length-failed.length}/${results.length} passed`);process.exitCode=failed.length?1:0;
}
