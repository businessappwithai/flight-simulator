// Simulated planet QA ("measure, don't guess"): plays the build-and-reveal sequence frame by frame and checks it.
//   bun run simulator &  OUT=.gstack/qa-reports/landscape SITE=http://localhost:3200/ node landscape-qa.mjs
// - 24 half-resolution stills (960×540) at even times through the 18 s shot, held with flightSim.revealSeek, and a
//   contact sheet of them;
// - exposure per still: luminance p99 ≤ 235 and (almost) nothing clipped;
// - the orange measured on the lit land at the reveal (15.5 s) against the brand colour (#D97757), per channel;
// - the forest beat's frame time (one frame at 9.5 s, timed);
// - the sound rendered offline: loudness per quarter second, the reveal the loudest quarter, peak below −2 dBFS;
// - no console errors. Writes landscape-qa.json and exits non-zero on any failed check.
import {chromium} from "playwright";
import {existsSync,readFileSync,writeFileSync,mkdirSync} from "node:fs";
const OUT=process.env.OUT||".",SITE=process.env.SITE||"http://localhost:3200/";mkdirSync(OUT,{recursive:true});
const b=await chromium.launch({...(process.env.PW_CHROME?{executablePath:process.env.PW_CHROME}:{}),args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const p=await (await b.newContext({viewport:{width:960,height:540}})).newPage();
const errors=[];p.on("pageerror",e=>errors.push(String(e)));p.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
await p.goto(`${SITE}?world=landscape&seed=7&quality=low`);
await p.waitForFunction(()=>flightSim.landscape?.state==="READY",null,{timeout:300000});
const planet=await p.evaluate(()=>({...flightSim.landscape,clearance:flightSim.landscapeInfo.clearance,color:flightSim.landscapeInfo.color}));
await p.evaluate(()=>flightSim.revealStart(false));
// Pixel statistics of a PNG, decoded in the page.
const stats=png=>p.evaluate(async b64=>{const img=new Image();img.src=`data:image/png;base64,${b64}`;await img.decode();const c=document.createElement("canvas");c.width=img.width;c.height=img.height;
 const g=c.getContext("2d");g.drawImage(img,0,0);const d=g.getImageData(0,0,c.width,c.height).data,lum=[],land=[];let clipped=0;
 for(let i=0;i<d.length;i+=4){const r=d[i],gg=d[i+1],bb=d[i+2];lum.push(.2126*r+.7152*gg+.0722*bb);if(r>=255||gg>=255||bb>=255)clipped++;if(r>gg+30&&gg>bb-5&&r>100)land.push([r,gg,bb])}
 lum.sort((a,b)=>a-b);land.sort((a,b)=>a[0]+a[1]+a[2]-b[0]-b[1]-b[2]);
 return {p99:Math.round(lum[Math.floor(lum.length*.99)]),clipped:clipped/(d.length/4),land:land.length?land[Math.floor(land.length/2)]:null,landShare:land.length/(d.length/4)}},png.toString("base64"));
const stills=[];
// REUSE=1 measures the stills already in OUT instead of taking them again (a run takes ~40 min on SwiftShader).
for(let i=0;i<24;i++){const t=+(i*18/24+.375).toFixed(3),file=`still-${String(i+1).padStart(2,"0")}-t${t.toFixed(2)}.png`;let png;
 if(process.env.REUSE&&existsSync(`${OUT}/${file}`))png=readFileSync(`${OUT}/${file}`);
 else{await p.evaluate(t=>flightSim.revealSeek(t),t);await p.waitForTimeout(Number(process.env.SETTLE||7000));png=await p.screenshot({timeout:300000});writeFileSync(`${OUT}/${file}`,png)}
 stills.push({t,frame:Math.round(t*60)+1,file,...await stats(png)});console.log(JSON.stringify(stills.at(-1)))}
// The orange at the reveal.
await p.evaluate(()=>flightSim.revealSeek(15.5));await p.waitForTimeout(8000);const reveal=await stats(await p.screenshot({path:`${OUT}/reveal-15.5.png`,timeout:300000}));
// The forest beat's frame time.
await p.evaluate(()=>flightSim.revealSeek(9.5));await p.waitForTimeout(8000);
console.log("timing the forest beat…");const frameMs=await p.evaluate(()=>new Promise(r=>{let n=0,t0=0;const f=t=>{if(n===1)t0=t;if(n++===3){r(Math.round((t-t0)/2));return}requestAnimationFrame(f)};requestAnimationFrame(f)}));
await p.evaluate(()=>flightSim.revealStop());
console.log("rendering the sound offline…");const sound=await p.evaluate(()=>flightSim.revealSound());console.log(JSON.stringify(sound));
// Contact sheet: 6 × 4 thumbnails.
const sheet=await b.newPage({viewport:{width:1440,height:420}});
await sheet.setContent(`<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(6,240px);gap:0">${stills.map(s=>`<div style="position:relative"><img src="data:image/png;base64,${require64(`${OUT}/${s.file}`)}" width=240 height=135><span style="position:absolute;left:4px;top:2px;color:#fff;font:11px monospace;text-shadow:0 0 2px #000">f${s.frame} ${s.t}s</span></div>`).join("")}</body>`);
await sheet.screenshot({path:`${OUT}/contact-sheet.png`,fullPage:true,timeout:300000});
function require64(f){return readFileSync(f).toString("base64")}
const target=[0xd9,0x77,0x57],dOrange=reveal.land?reveal.land.map((v,k)=>Math.abs(v-target[k])):[999,999,999];
const checks={
 clearance:planet.clearance.minM>=350,
 exposure:stills.every(s=>s.p99<=235),orbitExposure:reveal.p99<=235&&reveal.clipped<.001,
 orange:dOrange.every(d=>d<=16),sound:sound.loudestQuarter===sound.revealQuarter||Math.abs(sound.loudestQuarter-sound.revealQuarter)<=2,soundPeak:sound.peakDb<=-2,
 noErrors:errors.length===0};
const report={planet,stills,reveal,orange:{measured:reveal.land,target,delta:dOrange},forestFrameMs:frameMs,sound,errors,checks};
writeFileSync(`${OUT}/landscape-qa.json`,JSON.stringify(report,null,1));console.log(JSON.stringify({checks,orange:report.orange,forestFrameMs:frameMs,sound:{loudest:sound.loudestQuarter,reveal:sound.revealQuarter,peakDb:sound.peakDb}}));
await b.close();process.exit(Object.values(checks).every(Boolean)?0:1);
