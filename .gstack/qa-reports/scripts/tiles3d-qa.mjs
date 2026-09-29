import {chromium} from "playwright";
const T=encodeURIComponent("http://localhost:3300/{z}/{x}/{y}.png");
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const p=await b.newPage({viewport:{width:1280,height:800}});const reqs=[];p.on("request",r=>{if(r.url().includes(":3400"))reqs.push(r.url())});p.on("console",m=>{if(m.type()==="error"||m.type()==="warning")console.log("console:",m.text().slice(0,200))});
await p.goto(`http://localhost:3200/?quality=low&airport=VOMM&runway=07&terrain=${T}&features=off&tiles3d=${encodeURIComponent("http://localhost:3400/tileset.json")}&pilot=manual&hud=0`);
await p.waitForFunction(()=>globalThis.flightSim?.geo?.state==="READY",null,{timeout:60000});
await p.getByTestId("start-manual").click({force:true});await p.keyboard.press("KeyP");await p.waitForTimeout(8000);
console.log("requests:",reqs);await p.screenshot({path:".gstack/qa-reports/screenshots/route-0929/route-e-tiles3d.png"});await b.close();
