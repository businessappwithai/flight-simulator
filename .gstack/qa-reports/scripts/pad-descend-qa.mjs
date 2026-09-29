// Pad buttons do what they say: take off with ▲ held, then hold ▼ alone and read the vertical speed the HUD shows
// (the intent controller flies −4 m/s ≈ −790 fpm), then release (HOLD keeps the height).
import {chromium} from "playwright";
const SITE=process.env.SITE||"http://localhost:8000/flight-simulator/",OUT=process.env.OUT||".";
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const p=await (await b.newContext({viewport:{width:1180,height:820},hasTouch:true})).newPage();
await p.goto(`${SITE}?quality=low&hud=1`);await p.waitForFunction(()=>globalThis.flightSim?.world,null,{timeout:60000});
if(await p.locator(".ai .close").count())await p.locator(".ai .close").first().click();
await p.getByTestId("start-manual").click();for(let i=0;i<5;i++)await p.getByRole("button",{name:"Faster"}).click();
const press=async l=>{const x=await p.getByRole("button",{name:l,exact:true}).boundingBox();await p.mouse.move(x.x+x.width/2,x.y+x.height/2);await p.mouse.down()};
const st=()=>p.evaluate(()=>{const a=flightSim.world.aircraft;return {t:Number(flightSim.world.tick)/120,alt:a.position.y,vy:a.velocity.y,intent:flightSim.intent??null}});
await press("Climb");await p.waitForFunction(()=>flightSim.world.aircraft.position.y>300,null,{timeout:600000});await p.mouse.up();
await p.waitForTimeout(3000);const a=await st();await press("Descend");await p.waitForTimeout(12000);const d=await st();await p.mouse.up();
await p.waitForTimeout(6000);const h=await st();
console.log(JSON.stringify({level:a,descending:d,rate:(d.alt-a.alt)/(d.t-a.t),afterRelease:h}));
await p.screenshot({path:`${OUT}/pad-descend.png`});await b.close();
