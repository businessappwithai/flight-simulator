// Third pass: offline end to end (app-shell service worker + route pack, network switched off), live World stream in
// a Control Room tab, 3D Tiles height alignment, and a Google 3D Tiles key given in a link.
// Needs: the production build served under /flight-simulator/ on :8000 (as Pages), serve.ts on :3200, terrain-relay.ts
// on :3300, and a CORS static server for tilesets on :3400 serving TILESET_DIR.
import {chromium} from "playwright";
import {execFileSync} from "node:child_process";
const OUT=process.env.OUT||".",SITE=process.env.SITE||"http://localhost:8000/flight-simulator/",DEV=process.env.DEV||"http://localhost:3200/",RELAY=process.env.RELAY||"http://localhost:3300";
const TILES=process.env.TILES||"http://localhost:3400",TILESET_DIR=process.env.TILESET_DIR||"/tmp/claude-0/tileset";
const T=encodeURIComponent(`${RELAY}/{z}/{x}/{y}.png`);
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const log=(...a)=>console.log(...a);
const watch=p=>{p.errs=[];p.on("console",m=>{if(m.type()==="error")p.errs.push(m.text().slice(0,240))});p.on("pageerror",e=>p.errs.push("uncaught: "+e.message));return p};
const state=p=>p.evaluate(()=>{const g=flightSim.geo,w=flightSim.world;if(!w)return {phase:"(resetting)"};return {phase:w.objective.phase,t:Math.round(Number(w.tick)/120),geo:g&&{state:g.state,airport:g.airport,epoch:g.frameEpoch,arrived:g.arrived,holding:g.holding},route:g?.route&&{to:g.route.destination,phase:g.route.phase,km:+(g.route.distanceM/1000).toFixed(1)}}});
async function until(p,pred,ms,every=1000){const t0=Date.now();let s;while(Date.now()-t0<ms){s=await state(p).catch(()=>({phase:"(resetting)"}));if(s.phase!=="(resetting)"&&pred(s))return s;await p.waitForTimeout(every)}return s}
const text=(p,sel)=>p.locator(sel).first().innerText().catch(()=>"<none>");
const shot=(p,n)=>p.screenshot({path:`${OUT}/${n}.png`});
const errors=(p,label)=>log(`CONSOLE_ERRORS[${label}]=`+JSON.stringify(p.errs));

// I) Offline: install the app shell, pack VOMM → VOAR, switch the network off, reload, fly and land.
let ctx=await b.newContext({viewport:{width:1280,height:800}});await ctx.addInitScript(()=>{try{localStorage.setItem("flightWorld.jevKey","qa-dummy-key-0001")}catch{}});
let p=watch(await ctx.newPage());const q=`?quality=low&sw=1&airport=VOMM&runway=07&to=VOAR&terrain=${T}&features=off`;
await p.goto(SITE+q);await p.waitForFunction(()=>navigator.serviceWorker?.controller||navigator.serviceWorker?.ready.then(()=>true),null,{timeout:30000});
await p.reload();await p.waitForFunction(()=>!!navigator.serviceWorker.controller&&globalThis.flightSim?.geo?.state==="READY"&&flightSim.geo.route,null,{timeout:90000});
log("I controlled by the service worker:",await p.evaluate(()=>!!navigator.serviceWorker.controller));
await p.getByTestId("route-pack-save").click({force:true});
let t0=Date.now(),pack="";while(Date.now()-t0<240000){pack=await text(p,"[data-testid=route-pack-status]");if(/saved|⚠/.test(pack))break;await p.waitForTimeout(1000)}
log("I pack:",pack,"in",Math.round((Date.now()-t0)/1000),"s");
await ctx.setOffline(true);
const failed=[];p.on("requestfailed",r=>failed.push(r.url().replace(/\?.*/,"")));
await p.reload();await p.waitForFunction(()=>globalThis.flightSim?.geo?.state==="READY",null,{timeout:90000}).catch(()=>{});
let s=await state(p);log("I offline reload:",JSON.stringify(s));await shot(p,"route-i-offline-ready");
await p.getByTestId("start-autopilot").click({force:true});for(let i=0;i<6;i++)await p.keyboard.press("Equal");
s=await until(p,s=>s.phase==="COMPLETE"||s.phase==="FAILED"||(s.geo?.holding&&s.t>30&&false),20*60_000,3000);
log("I offline flight:",JSON.stringify(s),"banner:",(await text(p,".banner")).replace(/\n/g," | "));
{const u=[...new Set(failed)],tiles=u.filter(x=>/:3300\//.test(x));log("I failed requests while offline:",u.length,"of which render tiles:",tiles.length,JSON.stringify(u.filter(x=>!/:3300\//.test(x))))}await shot(p,"route-i-offline-arrived");errors(p,"I");await ctx.close();

// K) Live World stream: a Control Room tab shows the simulator's GeoTelemetry while it flies.
ctx=await b.newContext({viewport:{width:1280,height:800}});await ctx.addInitScript(()=>{try{localStorage.setItem("flightWorld.jevKey","qa-dummy-key-0001")}catch{}});
const room=watch(await ctx.newPage());await room.goto(DEV+"control-room/");
p=watch(await ctx.newPage());await p.goto(DEV+`?quality=low&airport=VOMM&runway=07&to=VOAR&terrain=${T}&features=off`);
await p.waitForFunction(()=>globalThis.flightSim?.geo?.state==="READY",null,{timeout:90000});
await p.getByTestId("start-autopilot").click({force:true});for(let i=0;i<6;i++)await p.keyboard.press("Equal");
await room.getByTestId("world-stream").waitFor({timeout:120000}).catch(()=>{});
log("K live world stream:",(await text(room,"[data-testid=world-stream]")).replace(/\n/g," | ").slice(0,400),"mode:",await text(room,"[data-testid=mode]"));
await room.bringToFront();await shot(room,"route-k-live-world-stream");errors(room,"K-room");errors(p,"K-sim");await ctx.close();

// J) 3D Tiles height: a 3 m slab over the VOMM 07 threshold whose ground is 30 m too high is lowered onto the runway.
ctx=await b.newContext({viewport:{width:1280,height:800}});p=watch(await ctx.newPage());
await p.goto(DEV+`?quality=low&airport=VOMM&runway=07&terrain=${T}&features=off&pilot=manual`);await p.waitForFunction(()=>globalThis.flightSim?.geo?.state==="READY",null,{timeout:90000});
const a=await p.evaluate(()=>flightSim.geo.anchor);
execFileSync("bun",["scripts/make-test-tileset.ts",`${TILESET_DIR}/slab`,String(a.lat),String(a.lon),String(a.elevationM+30),"1600","3"],{stdio:"inherit"});
await p.goto(DEV+`?quality=low&airport=VOMM&runway=07&terrain=${T}&features=off&pilot=manual&tiles3d=${encodeURIComponent(TILES+"/slab/tileset.json")}`);
await p.waitForFunction(()=>globalThis.flightSim?.tiles3d?.aligned,null,{timeout:90000}).catch(()=>{});
log("J tiles3d:",JSON.stringify(await p.evaluate(()=>flightSim.tiles3d)),"(expected lift ≈ -33 m: 30 m too high + 3 m slab)");
await p.getByTestId("start-manual").click({force:true});await p.keyboard.press("KeyP");await p.waitForTimeout(3000);await shot(p,"route-j-tiles3d-aligned");errors(p,"J");

// L) A Google 3D Tiles key in a link: kept in this browser, removed from the address bar; unreachable → message, own terrain stays.
await p.goto(DEV+`?quality=low&airport=VOMM&runway=07&terrain=${T}&features=off&pilot=manual&tiles3dKey=AIzaQAdummyKeyForQA0000000000000000000`);
await p.waitForFunction(()=>globalThis.flightSim?.geo?.state==="READY",null,{timeout:90000});await p.waitForTimeout(8000);
log("L url:",new URL(p.url()).search,"stored:",await p.evaluate(()=>localStorage.getItem("flightWorld.tiles3dKey")?.slice(-4)));
log("L panel:",(await text(p,"[data-testid=tiles3d-key]")).replace(/\n/g," | "),"error:",await text(p,"[role=alert]"),"terrain tiles:",await p.evaluate(()=>flightSim.terrainTiles));
await shot(p,"route-l-google-key");errors(p,"L");
await p.getByTestId("tiles3d-remove").click({force:true});log("L removed:",await p.evaluate(()=>localStorage.getItem("flightWorld.tiles3dKey")));
await b.close();
