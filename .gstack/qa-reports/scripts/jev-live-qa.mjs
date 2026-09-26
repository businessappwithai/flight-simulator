// Live Jev copilot QA in the browser (needs network access to api.typesafe.ai).
// JEV_API_KEY=… OUT=.gstack/qa-reports/screenshots/jev-live node jev-live-qa.mjs
//   (simulator on http://localhost:3200, Control Room on http://localhost:3100)
// The key comes from the environment only; it is typed into the (password) key box and never printed.
import {chromium} from "playwright";import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
const KEY=process.env.JEV_API_KEY?.trim();if(!KEY){console.error("Set JEV_API_KEY");process.exit(2)}
const SIM=process.env.SIM??"http://localhost:3200/?quality=low",ROOM=process.env.ROOM??"http://localhost:3100/",OUT=process.env.OUT??".";mkdirSync(OUT,{recursive:true});
const results=[];const check=(name,ok,detail="")=>{const d=String(detail).replaceAll(KEY,"[REDACTED]");results.push({name,ok:!!ok,detail:d});console.log(`${ok?"PASS":"FAIL"}  ${name}${d?`  (${d})`:""}`)};
const b=await chromium.launch({executablePath:process.env.CHROMIUM??"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const errors=[],jevRequests=[];
const W=p=>p.evaluate(()=>{const w=flightSim.world;return {tick:Number(w.tick),phase:w.objective.phase,pilot:flightSim.pilot}});
const text=(p,sel)=>p.locator(sel).first().innerText().catch(()=>"");
const shot=(p,n)=>p.screenshot({path:`${OUT}/${n}.png`});
const land=p=>p.waitForFunction(()=>["COMPLETE","FAILED"].includes(flightSim.world.objective.phase),null,{timeout:300000});
try{
 const ctx=await b.newContext({viewport:{width:1280,height:720},acceptDownloads:true});const p=await ctx.newPage();
 p.on("console",m=>{if(m.type()==="error")errors.push(m.text())});p.on("pageerror",e=>errors.push(`uncaught: ${e.message}`));
 p.on("request",r=>{if(r.url().startsWith("https://api.typesafe.ai/"))jevRequests.push({url:r.url(),method:r.method(),at:Date.now()})});
 p.on("requestfailed",r=>{if(r.url().startsWith("https://api.typesafe.ai/"))errors.push(`jev request failed: ${r.failure()?.errorText}`)});
 await p.goto(SIM);await p.waitForFunction(()=>!!globalThis.flightSim?.world,null,{timeout:90000});await p.waitForTimeout(1500);
 // 1. Save the real key.
 await p.getByTestId("jev-input").fill(KEY);await shot(p,"01-key-typed");await p.getByTestId("jev-save").click();
 check("Key saved and shown masked",(await text(p,"[data-testid=jev-saved]")).includes(`••••${KEY.slice(-4)}`));
 check("Copilot panel appears",await p.getByTestId("copilot").isVisible());
 check("No Jev calls while parked on the runway",jevRequests.length===0,`${jevRequests.length} requests`);
 await shot(p,"02-key-saved");
 // 2. First autopilot flight: Jev recommends live.
 await p.getByTestId("start-autopilot").click();
 await p.waitForFunction(()=>/Recommends/.test(document.querySelector("[data-testid=copilot-advice]")?.textContent??"")||/unreachable/.test(document.querySelector("[data-testid=jev-status]")?.textContent??""),null,{timeout:60000}).catch(()=>{});
 const status=await text(p,"[data-testid=jev-status]"),advice=await text(p,"[data-testid=copilot-advice]"),jevErr=await text(p,"[data-testid=jev-error]");
 check("Browser reaches Jev with the key (no CORS or auth error)",/^Jev (?!unreachable)/.test(status)&&!jevErr,jevErr||status);
 check("Jev's first recommendation arrives",/Recommends/.test(advice),advice.replace(/\s+/g," "));
 check("Requests go to api.typesafe.ai /v1/systemone",jevRequests.some(r=>r.url.endsWith("/v1/systemone")&&r.method==="POST"),`${jevRequests.length} requests`);
 await shot(p,"03-jev-recommends");
 for(let i=0;i<2;i++)await p.getByRole("button",{name:"Faster"}).click();
 await land(p);let w=await W(p);await p.waitForTimeout(1500);
 check("The autopilot lands with the copilot riding along",w.phase==="COMPLETE",w.phase);
 await p.waitForFunction(()=>/trained on/.test(document.querySelector("[data-testid=xgb-status]")?.textContent??""),null,{timeout:120000}).catch(()=>{});
 const xgb=await text(p,"[data-testid=xgb-status]");check("XGBoost trains in the browser on the finished flight",/trained on \d+ examples/.test(xgb),xgb);
 await shot(p,"04-landed-xgboost-trained");
 // 3. Second flight: Jev again, with the trained model ready to take over when Jev is unsure.
 await p.getByRole("button",{name:"Restart",exact:true}).click();await p.getByTestId("start-panel").waitFor({timeout:10000});
 await p.getByTestId("start-autopilot").click();for(let i=0;i<2;i++)await p.getByRole("button",{name:"Faster"}).click();
 await p.waitForTimeout(8000);await shot(p,"05-second-flight");
 await land(p);await p.waitForTimeout(1500);
 const [dl]=await Promise.all([p.waitForEvent("download"),p.getByTestId("traces-download").click()]);const file=`${OUT}/jev-traces.jsonl`;await dl.saveAs(file);
 const raw=readFileSync(file,"utf8"),events=raw.trim().split("\n").map(l=>JSON.parse(l)),advice2=events.filter(e=>e.type==="DECISION"&&(e.frame.provider==="jev"||e.frame.provider.startsWith("xgboost")));
 const byJev=advice2.filter(e=>e.frame.provider==="jev"),byXgb=advice2.filter(e=>e.frame.provider.startsWith("xgboost"));
 const conf=byJev.map(e=>e.frame.evidence.selection?.providerConfidence).filter(x=>x!==undefined);
 check("Traces hold Jev's recommendations with real model evidence",byJev.length>0&&byJev.every(e=>e.frame.evidence.model&&e.frame.evidence.candidates.length===8),`${byJev.length} by Jev (model ${byJev[0]?.frame.evidence.model}), ${byXgb.length} by XGBoost`);
 check("Every recommendation records Jev's confidence and who decided",advice2.every(e=>e.frame.evidence.selection),`Jev confidence ${conf.length?`${Math.round(Math.min(...conf)*100)}–${Math.round(Math.max(...conf)*100)}%`:"n/a"}`);
 check("When Jev was unsure (<50%) XGBoost decided",advice2.filter(e=>(e.frame.evidence.selection?.providerConfidence??1)<.5).every(e=>e.frame.provider.startsWith("xgboost")||/unavailable/.test(e.frame.evidence.selection?.reason??"")),`${conf.filter(c=>c<.5).length} unsure answers`);
 // 4. The key stays where it belongs.
 const ls=await p.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])));
 check("Key stored only under flightWorld.jevKey",Object.entries(ls).filter(([,v])=>v?.includes(KEY)).map(([k])=>k).join()==="flightWorld.jevKey");
 check("Key is not in traces, learning or page text",!raw.includes(KEY)&&!(ls["flightWorld.learning.v2"]??"").includes(KEY)&&!(await p.evaluate(()=>document.body.innerText)).includes(KEY));
 // 5. Control Room explains the copilot's decisions.
 const room=await (await b.newContext({viewport:{width:1280,height:900}})).newPage();await room.goto(ROOM);await room.getByTestId("replay-file").setInputFiles(file);await room.getByTestId("play").click();
 await room.waitForFunction(()=>/jev/.test(document.body.innerText),null,{timeout:60000}).catch(()=>{});
 check("Control Room replays the Jev recommendations",/jev/.test(await room.evaluate(()=>document.body.innerText)));
 await room.screenshot({path:`${OUT}/06-control-room.png`});
 // 6. Removing the key stops the copilot and its requests.
 await p.getByTestId("jev-remove").click();const n=jevRequests.length;await p.getByTestId("start-manual").click().catch(()=>{});await p.keyboard.down("KeyW");await p.waitForTimeout(6000);await p.keyboard.up("KeyW");
 check("Removing the key stops Jev calls and hides the copilot",jevRequests.length===n&&!(await p.getByTestId("copilot").count()),`${jevRequests.length-n} calls after removal`);
 await shot(p,"07-key-removed");
}catch(e){check("Live QA ran to completion",false,e instanceof Error?e.message.split("\n")[0]:String(e))}
finally{
 const real=errors.filter(e=>!/GPU stall|GL Driver|Lit is in dev|React DevTools/.test(e));check("No console errors",real.length===0,real.slice(0,3).join(" | "));
 await b.close();const failed=results.filter(r=>!r.ok);
 writeFileSync(`${OUT}/results.json`,JSON.stringify({passed:results.length-failed.length,total:results.length,jevRequests:jevRequests.length,results},null,2));
 console.log(`\n${results.length-failed.length}/${results.length} passed, ${jevRequests.length} Jev requests`);process.exitCode=failed.length?1:0;
}
