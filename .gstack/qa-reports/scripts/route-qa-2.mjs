// Second pass: 3D Tiles layer, offline route pack, arrival banner, bad destination, crash cause, and the Control
// Room's world-stream panel fed by the flight's trace. Needs serve.ts (3200), terrain-relay.ts (3300) and a tileset
// from scripts/make-test-tileset.ts served with CORS on 3400.
import {chromium} from "playwright";
const OUT=process.env.OUT||".",BASE=process.env.BASE||"http://localhost:3200/",RELAY=process.env.RELAY||"http://localhost:3300",TILESET=process.env.TILESET||"http://localhost:3400/tileset.json";
const T=encodeURIComponent(`${RELAY}/{z}/{x}/{y}.png`);
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const log=(...a)=>console.log(...a);
const ctx=await b.newContext({viewport:{width:1280,height:800}});
await ctx.addInitScript(()=>{try{localStorage.setItem("flightWorld.jevKey","qa-dummy-key-0001")}catch{}});
async function open(q){const p=await ctx.newPage();p.errs=[];p.on("console",m=>{if(m.type()==="error")p.errs.push(m.text().slice(0,240))});p.on("pageerror",e=>p.errs.push("uncaught: "+e.message));
 await p.goto(BASE+q);await p.waitForFunction(()=>globalThis.flightSim?.world,null,{timeout:30000});return p}
const state=p=>p.evaluate(()=>{const g=flightSim.geo,w=flightSim.world;if(!w)return {phase:"(resetting)"};
 return {phase:w.objective.phase,t:Math.round(Number(w.tick)/120),geo:g&&{state:g.state,airport:g.airport,epoch:g.frameEpoch,arrived:g.arrived,surface:g.surface,agl:g.aglM===null?null:Math.round(g.aglM)},route:g?.route&&{to:g.route.destination,phase:g.route.phase,km:+(g.route.distanceM/1000).toFixed(1)}}});
async function until(p,pred,ms,every=1000){const t0=Date.now();let s;while(Date.now()-t0<ms){s=await state(p);if(s.phase!=="(resetting)"&&pred(s))return s;await p.waitForTimeout(every)}return s}
const text=(p,sel)=>p.locator(sel).first().innerText().catch(()=>"<none>");
const shot=(p,n)=>p.screenshot({path:`${OUT}/${n}.png`});
const errors=(p,label)=>log(`CONSOLE_ERRORS[${label}]=`+JSON.stringify(p.errs));

// E) 3D Tiles: the generated landmark stands 1.5 km past the VOMM 07 threshold, on the runway heading.
let p=await open(`?quality=low&airport=VOMM&runway=07&terrain=${T}&features=off&tiles3d=${encodeURIComponent(TILESET)}&camera=chase`);
let s=await until(p,s=>s.geo?.state==="READY",60000);
await p.waitForFunction(()=>{let n=0;globalThis.__r3fScene=globalThis.__r3fScene;return true},null);
await p.waitForTimeout(8000);await shot(p,"route-e-tiles3d");log("E tiles3d state:",JSON.stringify(s));errors(p,"E");await p.close();

// F) Offline route pack + flight to Arakkonam at ×32 + arrival banner.
p=await open(`?quality=low&airport=VOMM&runway=07&to=VOAR&terrain=${T}&features=off`);
s=await until(p,s=>s.geo?.state==="READY"&&s.route,60000);
await p.getByTestId("route-pack-save").click({force:true});
const t0=Date.now();let pack="";while(Date.now()-t0<180000){pack=await text(p,"[data-testid=route-pack-status]");if(/saved|⚠/.test(pack))break;await p.waitForTimeout(1000)}
log("F pack:",pack,"in",Math.round((Date.now()-t0)/1000),"s");await shot(p,"route-f-pack");
await p.getByTestId("start-autopilot").click({force:true});for(let i=0;i<6;i++)await p.keyboard.press("Equal");
s=await until(p,s=>s.phase==="COMPLETE"||s.phase==="FAILED",20*60_000,3000);
log("F end:",JSON.stringify(s));log("F banner:",(await text(p,".banner")).replace(/\n/g," | "));await shot(p,"route-f-arrived");errors(p,"F");
await p.waitForTimeout(2000);
const jsonl=await p.evaluate(()=>{const t=JSON.parse(localStorage.getItem("flightWorld.traces.v1")||"[]");return t.flatMap(x=>x.events.map(e=>JSON.stringify(e))).join("\n")});
log("F trace events:",jsonl.split("\n").length,"world-stream:",(jsonl.match(/WORLD_STREAM/g)||[]).length);await p.close();

// G) Control Room: load that trace; the world-stream panel shows the last sample.
p=await ctx.newPage();p.errs=[];p.on("console",m=>{if(m.type()==="error")p.errs.push(m.text().slice(0,240))});
await p.goto(BASE+"control-room/");await p.getByTestId("replay-file").setInputFiles({name:"trace.jsonl",mimeType:"application/x-ndjson",buffer:Buffer.from(jsonl)});
for(let i=0;i<400&&!(await p.getByTestId("world-stream").count());i++)await p.getByTestId("play").click().catch(()=>{}),await p.waitForTimeout(300);
await p.waitForTimeout(3000);log("G world stream:",(await text(p,"[data-testid=world-stream]")).replace(/\n/g," | ").slice(0,600));await shot(p,"route-g-control-room");errors(p,"G");await p.close();

// H) Unknown destination keeps the departure; crash cause off the airfield.
p=await open(`?quality=low&airport=VOMM&to=ZZZZ&terrain=${T}&features=off`);s=await until(p,s=>s.geo?.state==="READY",60000);
log("H bad destination:",await text(p,"[role=alert]"),"url:",new URL(p.url()).search,"geo:",JSON.stringify(s.geo),"route:",JSON.stringify(s.route));errors(p,"H");await p.close();
p=await open(`?quality=low&airport=VOMM&runway=07&terrain=${T}&features=off&pilot=manual`);s=await until(p,s=>s.geo?.state==="READY",60000);
await p.getByTestId("start-manual").click({force:true});for(let i=0;i<3;i++)await p.keyboard.press("Equal");
await p.keyboard.down("KeyW");s=await until(p,s=>s.geo?.agl>60,120000,500);await p.keyboard.up("KeyW");
s=await until(p,s=>s.t>60,240000,1000);await p.keyboard.down("KeyS");s=await until(p,s=>s.phase==="FAILED",120000,500);await p.keyboard.up("KeyS");
log("H crash:",JSON.stringify(s),"banner:",(await text(p,".banner")).replace(/\n/g," | "));await shot(p,"route-h-crash");errors(p,"H2");
await b.close();
