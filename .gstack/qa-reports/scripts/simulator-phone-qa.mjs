import {chromium} from "playwright";
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const p=await (await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true})).newPage();const errs=[];p.on("pageerror",e=>errs.push(e.message));
await p.goto("http://localhost:3200/?quality=low&rate=4&scenario=seeded&seed=33");await p.waitForFunction(()=>globalThis.flightSim?.world&&Number(flightSim.world.tick)>900,null,{timeout:90000});
const box=async s=>(await p.locator(s).boundingBox());const top=await box("#top"),map=await box("#map"),panel=await box("#panel"),pad=await box("#pad");
const overlap=(a,b)=>!(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
console.log("scrollW",await p.evaluate(()=>document.documentElement.scrollWidth),"map∩top",overlap(map,top),"map∩panel",overlap(map,panel),"pad∩panel",overlap(pad,panel),"pad visible",await p.locator("#pad").isVisible());
await p.locator('#pad [data-intent="CLIMB"]').dispatchEvent("pointerdown",{pointerId:1});await p.waitForTimeout(1200);console.log("touch climb →",await p.locator("#pilotLabel").innerText(),await p.locator("#apMode").innerText());
await p.screenshot({path:`${process.env.OUT||'.'}/sim-phone.png`});console.log(JSON.stringify(errs));await b.close();
