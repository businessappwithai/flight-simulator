import {chromium} from "playwright";
const OUT=process.env.OUT||".",URL="http://localhost:3100/#lab",log=(...a)=>console.log(...a);
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
const vp=process.env.VP?process.env.VP.split("x").map(Number):[1180,820];
const p=await (await b.newContext({viewport:{width:vp[0],height:vp[1]},hasTouch:true})).newPage();const errs=[];
p.on("console",m=>{if(m.type()==="error")errs.push(m.text().slice(0,200))});p.on("pageerror",e=>errs.push("uncaught: "+e.message));
const settle=()=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
await p.goto(URL);await p.waitForSelector(".cfg");await settle();await p.screenshot({path:`${OUT}/lab-01-start.png`});
const runs=()=>p.evaluate(()=>flightControlRoom.lab.runs.map(r=>({id:r.id,status:r.status,g:r.generations.length})));
async function runPreset(names){for(const n of names)await p.getByRole("button",{name:n,exact:true}).click();await settle();
 await p.getByRole("button",{name:"▶ Run lab"}).click();const t0=Date.now();await p.waitForFunction(()=>{const r=flightControlRoom.lab.current;return r&&r.status!=="running"},null,{timeout:300000});log("run done in",((Date.now()-t0)/1000).toFixed(1),"s",JSON.stringify(await runs()))}
await runPreset(["Quick look","Shadow (control)"]);
// Weight back to 0.6 via the slider, then run again
await p.getByRole("slider",{name:"XGBoost weight"}).fill("0.6");await settle();log("weight label:",await p.locator(".field:has([aria-label='XGBoost weight']) .f-label b").innerText());
await p.getByRole("button",{name:"▶ Run lab"}).click();await p.waitForFunction(()=>flightControlRoom.lab.current?.status!=="running"&&flightControlRoom.lab.runs.length===2,null,{timeout:300000});log("runs",JSON.stringify(await runs()));
await settle();await p.waitForTimeout(500);await p.screenshot({path:`${OUT}/lab-02-curves.png`,fullPage:false});
// Pick last generation, a flight, then a decision with an override or advisor change
const lastGen=await p.evaluate(()=>flightControlRoom.lab.current.generations.at(-1).generation);
await p.getByRole("radio",{name:`gen ${lastGen}`,exact:true}).click();await p.waitForSelector(".capture");await p.waitForSelector(".trace .summary",{timeout:30000}).catch(()=>{});await settle();
log("selected:",JSON.stringify(await p.evaluate(()=>flightControlRoom.lab.selection)));
log("summary:",(await p.locator(".trace .summary").innerText().catch(()=>"(none)")).slice(0,300));
await p.locator(".capture").scrollIntoViewIfNeeded();await p.screenshot({path:`${OUT}/lab-03-capture-trace.png`,fullPage:false});
// Click a marker on the map, then trace a different action, then the latest model
const box=await p.locator(".profile").boundingBox();await p.mouse.click(box.x+box.width*.45,box.y+box.height*.5);await settle();await p.waitForSelector(".trace .summary",{timeout:30000});const id1=await p.evaluate(()=>flightControlRoom.lab.selection.decisionId);
await p.locator("table.cmp tbody tr").nth(3).click();await p.waitForFunction(()=>document.querySelector(".trace .summary")?.textContent?.includes(flightControlRoom.lab.selection.action),null,{timeout:30000});
log("clicked marker →",id1,"trace action",await p.evaluate(()=>flightControlRoom.lab.selection.action),"| trees shown",await p.locator(".tree").count());
await p.getByRole("button",{name:"Next decision"}).click();await settle();const id2=await p.evaluate(()=>flightControlRoom.lab.selection.decisionId);log("next decision →",id2);await p.keyboard.press("ArrowLeft");await settle();log("arrow left →",await p.evaluate(()=>flightControlRoom.lab.selection.decisionId));
 await p.locator("table.cmp tbody tr").nth(3).click();await p.waitForSelector(".trace .summary",{timeout:30000});
 await p.getByRole("radio",{name:/latest model/}).click();await p.waitForFunction(()=>flightControlRoom.lab.explanation?.modelFrom!==undefined,null,{timeout:30000});
log("latest model from gen",await p.evaluate(()=>flightControlRoom.lab.explanation.modelFrom));
await p.locator(".trace").scrollIntoViewIfNeeded();await p.screenshot({path:`${OUT}/lab-04-trace-detail.png`,fullPage:false});
// Scrub the flight
await p.locator(".scrub input").fill("10");await settle();await p.locator(".capture").scrollIntoViewIfNeeded();await p.screenshot({path:`${OUT}/lab-05-scrubbed.png`,fullPage:false});
// Importance + full page
await p.locator(".imp").scrollIntoViewIfNeeded();await p.screenshot({path:`${OUT}/lab-06-importance.png`,fullPage:false});
await p.screenshot({path:`${OUT}/lab-00-full.png`,fullPage:true});
log("scrollWidth",await p.evaluate(()=>document.documentElement.scrollWidth),"/",vp[0],"| errors",JSON.stringify(errs));await b.close();
