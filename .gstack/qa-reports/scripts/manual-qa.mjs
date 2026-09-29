// Manual flight QA, by button clicks only: a touch tablet (so the on-screen yoke shows), no Jev key (autopilot off).
// Picks From/To with the start-card search, presses Start (manual), then flies by holding the pad's ▲ ▼ ◀ ▶ ■ buttons,
// deciding like a pilot from what the HUD shows (height, track, the destination's distance and bearing).
// Real-world data as a user gets it: AWS Terrarium terrain (through $HTTPS_PROXY when set); buildings/runways from a
// baked PMTiles archive (FEAT) where OpenFreeMap is unreachable.
//   SITE=http://localhost:8000/flight-simulator/ FEAT=http://localhost:3300/features OUT=<dir> node manual-qa.mjs [FROM TO QUERY_FROM QUERY_TO ARCHIVE]
import {chromium} from "playwright";
const OUT=process.env.OUT||".",SITE=process.env.SITE||"http://localhost:8000/flight-simulator/",FEAT=process.env.FEAT||"";
const [FROM="VOMM",TO="VOAR",QFROM="chennai",QTO="arakkonam",ARCHIVE="vomm.pmtiles"]=process.argv.slice(2);
const proxy=process.env.HTTPS_PROXY?[`--proxy-server=${process.env.HTTPS_PROXY}`,"--proxy-bypass-list=localhost;127.0.0.1;<local>"]:[];
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:[...proxy,"--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const ctx=await b.newContext({viewport:{width:1180,height:820},hasTouch:true,isMobile:false,ignoreHTTPSErrors:true});
const p=await ctx.newPage();const errs=[];p.on("console",m=>{if(m.type()==="error")errs.push(m.text().slice(0,200))});p.on("pageerror",e=>errs.push("uncaught: "+e.message));
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
let shots=0;const shot=async n=>{await p.screenshot({path:`${OUT}/manual-${String(++shots).padStart(2,"0")}-${n}.png`});log("screenshot",n)};
const T=encodeURIComponent;
// What the HUD shows (the badge and instruments read the same status).
const hud=()=>p.evaluate(()=>{const w=flightSim.world,g=flightSim.geo;if(!w||!g)return null;const r=g.route,a=w.aircraft;
 return {t:Number(w.tick)/120,phase:w.objective.phase,crashed:a.crashed,grounded:a.grounded,agl:g.aglM,msl:g.position.altMsl,trk:g.trackDeg,kt:Math.hypot(a.velocity.x,a.velocity.z)*1.944,vs:a.velocity.y,
  surface:g.surface,runwayBelow:g.runwayBelow,arrived:g.arrived,route:r&&{km:r.distanceM/1000,brg:r.bearingDeg,rwyHdg:r.runwayHeadingDeg,rwy:r.runway,xt:r.crossTrackM},
  buildings:g.features.buildings,featurePatches:flightSim.featurePatches,terrain:flightSim.terrainTiles}});
// Press-and-hold a pad button (pointer down on it, pointer up to release): only one held at a time, like a thumb.
let held=null;
async function hold(label){if(held===label)return;if(held){await p.mouse.up();held=null}
 if(!label)return;const box=await p.getByRole("button",{name:label,exact:true}).boundingBox();if(!box)throw new Error(`pad button ${label} not visible`);
 await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();held=label}
const click=sel=>p.locator(sel).first().click();

// 1) Choose the flight on the start card.
await p.goto(`${SITE}?quality=low${FEAT?`&features=${T(`${FEAT}/${ARCHIVE}`)}`:""}`);
await p.waitForFunction(()=>globalThis.flightSim?.world,null,{timeout:60000});
if(await p.locator(".ai .close").count())await click(".ai .close");
await p.getByTestId("airport-search").click();await p.getByTestId("airport-search").pressSequentially(QFROM,{delay:40});
await p.getByTestId(`from-${FROM}`).waitFor({timeout:20000});await shot("search-from");await p.getByTestId(`from-${FROM}`).click();
await p.waitForFunction(()=>flightSim.geo?.state&&flightSim.geo.state!=="LOADING",null,{timeout:120000});
await p.getByTestId("airport-search").click();await p.getByTestId("airport-search").fill("");await p.getByTestId("airport-search").pressSequentially(QTO,{delay:40});
await p.getByTestId(`to-${TO}`).waitFor({timeout:20000});await p.getByTestId(`to-${TO}`).click();
await p.waitForFunction(to=>flightSim.geo?.route?.destination===to&&flightSim.geo.state!=="LOADING",TO,{timeout:120000});
await p.waitForTimeout(6000);let s=await hud();log("planned",JSON.stringify(s));await shot("route-planned");
log("autopilot button:",await p.getByTestId("start-autopilot").getAttribute("class"),"(no Jev key)");
await p.getByTestId("start-manual").click();
for(let i=0;i<5;i++)await p.getByRole("button",{name:"Faster"}).click();
log("rate:",await p.getByTestId("time").innerText());

// 2) Fly by holding pad buttons, like a pilot flying a visual approach: climb out, head for a point 11 km out on the
// destination runway's extended centreline (descending towards a 3° path to it), then track the centreline down.
// Positions come from what the HUD shows: distance and bearing to the runway threshold and the runway heading.
const norm=d=>((d%360)+540)%360-180,rad=Math.PI/180,cruiseAgl=450,FAF=11000,glide=Math.tan(3*rad);
let stage="takeoff",t0=Date.now(),last=0,seen=new Set();
const snap=async(name,cond)=>{if(!seen.has(name)&&cond){seen.add(name);await hold(null);await shot(name)}};
while(Date.now()-t0<30*60_000){
 s=await hud();if(!s){await p.waitForTimeout(500);continue}
 if(s.phase==="COMPLETE"||s.phase==="FAILED"||s.crashed||s.arrived)break;
 if(stage==="final"&&s.grounded&&s.kt<3)break;
 const r=s.route;if(!r)break;
 await snap("climbing-out",s.agl>150&&s.t>20);
 await snap("buildings",s.featurePatches>0&&s.agl>200&&s.agl<800);
 await snap("cruise",stage==="cruise"&&s.agl>cruiseAgl-50);
 await snap("final",stage==="final"&&r.km<4);
 await snap("short-final",stage==="final"&&r.km<1.2&&s.agl<80);
 // Aircraft relative to the threshold (east, north metres), then along/right of the runway centreline.
 const d=r.km*1000,px=-d*Math.sin(r.brg*rad),py=-d*Math.cos(r.brg*rad),h=r.rwyHdg*rad;
 const along=px*Math.sin(h)+py*Math.cos(h),right=px*Math.cos(h)-py*Math.sin(h);
 const fx=-FAF*Math.sin(h)-px,fy=-FAF*Math.cos(h)-py,toFaf=Math.hypot(fx,fy),fafBrg=Math.atan2(fx,fy)/rad;
 if(stage==="takeoff"&&s.agl>60)stage="enroute";
 if(stage==="enroute"&&s.agl>cruiseAgl-50)stage="cruise";
 if(stage!=="takeoff"&&stage!=="final"&&(toFaf<1200||(along<-FAF*.6&&along>-FAF*1.6&&Math.abs(right)<600))){
  // Like a person would: slow the sim down for the approach (×32 → ×4) so each thumb press is a small correction.
  stage="final";await hold(null);for(let i=0;i<3;i++)await p.getByRole("button",{name:"Slower"}).click();log("rate:",await p.getByTestId("time").innerText());continue}
 let want,targetAgl;
 if(stage==="final"){want=r.rwyHdg-Math.max(-30,Math.min(30,right/4));targetAgl=Math.max(0,-along)*glide}
 else{want=fafBrg;targetAgl=Math.min(cruiseAgl,(toFaf+FAF)*glide)}
 const err=norm(want-s.trk);
 let btn;
 if(stage==="takeoff")btn="Climb";
 else if(stage==="final"){
  // Turns are level intents (they hold height) and bank ~29°, so: turn only for real heading errors, let the descent
  // win when on heading, and keep the wings level below 15 m (a banked touchdown is a wing strike).
  if(s.grounded)btn="Slow";
  else if(s.agl<15)btn="Descend";
  else if(Math.abs(err)>(s.agl>targetAgl+15?8:Math.abs(right)>20?2:5))btn=err>0?"Turn right":"Turn left";
  else if(s.agl>targetAgl+10)btn="Descend";
  else if(s.agl<targetAgl-20)btn="Climb";
  else btn=s.kt>75?"Slow":null;
 }
 else if(Math.abs(err)>8&&!(Math.abs(err)<20&&Math.abs(s.agl-targetAgl)>60))btn=err>0?"Turn right":"Turn left";
 else if(s.agl>targetAgl+20)btn="Descend";
 else if(s.agl<targetAgl-20)btn="Climb";
 else btn=null;
 await hold(btn);
 if(Date.now()-last>15000){last=Date.now();log(stage,JSON.stringify({t:Math.round(s.t),agl:Math.round(s.agl),kt:Math.round(s.kt),trk:Math.round(s.trk),km:+r.km.toFixed(1),along:Math.round(along),right:Math.round(right),target:Math.round(targetAgl),btn,feat:s.featurePatches,terrain:s.terrain}))}
 await p.waitForTimeout(250);
}
await hold(null);s=await hud();
log("end",JSON.stringify(s));log("banner:",await p.locator(".banner").first().innerText().catch(()=>"<none>"));
await shot("end");log("CONSOLE_ERRORS="+JSON.stringify(errs));
await b.close();
