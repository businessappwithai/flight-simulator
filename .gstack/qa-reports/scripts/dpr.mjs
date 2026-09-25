// iPad Pro: force the adaptive-quality resolution drop (high quality in a software renderer), then prove frames keep rendering.
import {chromium} from "playwright";
const OUT=process.env.OUT||".";
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const p=await (await b.newContext({viewport:{width:1366,height:1024},hasTouch:true,deviceScaleFactor:2})).newPage();const errs=[];p.on("pageerror",e=>errs.push(e.message));
await p.goto("http://localhost:3200/?rate=2");
const toasts=[];const t0=Date.now();
while(Date.now()-t0<150000){const t=await p.evaluate(()=>document.querySelector(".banner")?.textContent??"");if(t&&!toasts.includes(t))toasts.push(t);if(t.includes("resolution"))break;await p.waitForTimeout(500)}
console.log("toasts:",JSON.stringify(toasts));
const sky=async()=> (await p.screenshot({clip:{x:300,y:150,width:760,height:260},type:"png"})).length;
const samples=[];for(let i=0;i<6;i++){await p.waitForTimeout(2000);samples.push(await sky())}
console.log("sky PNG bytes after drop (black ≈ <2k):",samples.join(","),"| canvas px:",await p.evaluate(()=>{const c=document.querySelector("canvas");return `${c.width}x${c.height} for ${innerWidth}x${innerHeight} css`}));
await p.screenshot({path:`${OUT}/sim-ipad-pro-landscape.png`});console.log("errors",JSON.stringify(errs));await b.close();
