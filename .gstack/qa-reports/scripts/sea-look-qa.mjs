// Sea and coast check, by button clicks: take off from VOMM runway 07 (heading east, toward the Bay of Bengal, ~12 km),
// hold Climb to ~600 m and look ahead from the chase camera. The sea is the DEM's sea level (h <= 0.5 m).
//   SITE=… OUT=<dir> node sea-look-qa.mjs
import {chromium} from "playwright";
const OUT=process.env.OUT||".",SITE=process.env.SITE||"http://localhost:8000/flight-simulator/";
const proxy=process.env.HTTPS_PROXY?[`--proxy-server=${process.env.HTTPS_PROXY}`,"--proxy-bypass-list=localhost;127.0.0.1;<local>"]:[];
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:[...proxy,"--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const p=await (await b.newContext({viewport:{width:1180,height:820},hasTouch:true,ignoreHTTPSErrors:true})).newPage();
await p.goto(`${SITE}?quality=low&airport=VOMM&runway=07&features=off`);
await p.waitForFunction(()=>flightSim.geo?.state==="READY",null,{timeout:120000});
if(await p.locator(".ai .close").count())await p.locator(".ai .close").first().click();
await p.getByTestId("start-manual").click();for(let i=0;i<5;i++)await p.getByRole("button",{name:"Faster"}).click();
const box=await p.getByRole("button",{name:"Climb",exact:true}).boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();
await p.waitForFunction(()=>flightSim.geo.aglM>600,null,{timeout:600000});await p.mouse.up();
await p.waitForTimeout(8000);
console.log(JSON.stringify(await p.evaluate(()=>({pos:flightSim.geo.position,trk:flightSim.geo.trackDeg,terrain:flightSim.terrainTiles}))));
await p.screenshot({path:`${OUT}/sea-01-coast-ahead.png`});await b.close();
