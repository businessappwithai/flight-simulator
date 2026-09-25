import type {WorldSnapshot} from "@flight/protocol";
/**
 * Classic "six-pack" flight instruments rendered to a 2D canvas from the simulation snapshot:
 * airspeed, attitude, altimeter / turn coordinator, heading, vertical speed. Units as in real cockpits
 * (knots, feet, feet per minute); the simulation itself is SI.
 */
export interface FlightData{speedKt:number;altFt:number;vsFpm:number;pitch:number;roll:number;headingDeg:number;turnRateDegS:number}
const KT=1.94384,FT=3.28084;
const TAU=Math.PI*2,rad=(d:number)=>d*Math.PI/180;
export function flightData(w:WorldSnapshot,prevHeading:number|undefined,dtSeconds:number):FlightData{
 const a=w.aircraft,speed=Math.hypot(a.velocity.x,a.velocity.y,a.velocity.z);
 const hd=((a.heading%TAU)+TAU)%TAU;
 return {speedKt:speed*KT,altFt:a.position.y*FT,vsFpm:a.velocity.y*FT*60,pitch:a.pitch,roll:a.roll,headingDeg:hd*180/Math.PI,
  turnRateDegS:prevHeading===undefined||dtSeconds<=0?0:(a.heading-prevHeading)/dtSeconds*180/Math.PI};
}
function bezel(g:CanvasRenderingContext2D,cx:number,cy:number,r:number){
 g.save();g.beginPath();g.arc(cx,cy,r+6,0,TAU);g.fillStyle="#1b1d20";g.fill();g.lineWidth=3;g.strokeStyle="#3a3d42";g.stroke();
 g.beginPath();g.arc(cx,cy,r,0,TAU);g.fillStyle="#0c0d0f";g.fill();g.restore();
}
function ticks(g:CanvasRenderingContext2D,cx:number,cy:number,r:number,from:number,to:number,n:number,major:number,label?:(i:number)=>string){
 g.save();g.strokeStyle="#e8e8e8";g.fillStyle="#e8e8e8";g.font=`${Math.round(r*.2)}px system-ui`;g.textAlign="center";g.textBaseline="middle";
 for(let i=0;i<=n;i++){const a=from+(to-from)*i/n-Math.PI/2,big=i%major===0;g.lineWidth=big?2.2:1.2;g.beginPath();g.moveTo(cx+Math.cos(a)*r*(big?.8:.88),cy+Math.sin(a)*r*(big?.8:.88));g.lineTo(cx+Math.cos(a)*r*.97,cy+Math.sin(a)*r*.97);g.stroke();
  if(big&&label){const t=label(i);if(t)g.fillText(t,cx+Math.cos(a)*r*.62,cy+Math.sin(a)*r*.62)}}
 g.restore();
}
function needle(g:CanvasRenderingContext2D,cx:number,cy:number,len:number,angle:number,width=3,color="#f4f4f4"){
 g.save();g.translate(cx,cy);g.rotate(angle);g.fillStyle=color;g.beginPath();g.moveTo(-width,0);g.lineTo(0,-len);g.lineTo(width,0);g.lineTo(0,len*.15);g.closePath();g.fill();g.restore();
}
// Captions sit between the hub and the lower dial numerals (which are drawn at 0.62 r).
function caption(g:CanvasRenderingContext2D,cx:number,cy:number,r:number,text:string,sub?:string){g.save();g.textAlign="center";g.textBaseline="middle";g.fillStyle="#9aa3ad";g.font=`${Math.round(r*.12)}px system-ui`;if(text)g.fillText(text,cx,cy-r*.3);if(sub){g.fillStyle="#f0f0f0";g.font=`bold ${Math.round(r*.14)}px ui-monospace,monospace`;g.fillText(sub,cx,cy+r*.3)}g.restore()}
function airspeed(g:CanvasRenderingContext2D,cx:number,cy:number,r:number,kt:number){
 bezel(g,cx,cy,r);const max=200,ang=(v:number)=>rad(20)+(rad(340)-rad(20))*Math.min(v,max)/max;
 const arc=(a:number,b:number,c:string,w:number,rr:number)=>{g.save();g.strokeStyle=c;g.lineWidth=w;g.beginPath();g.arc(cx,cy,r*rr,ang(a)-Math.PI/2,ang(b)-Math.PI/2);g.stroke();g.restore()};
 arc(33,85,"#e8e8e8",r*.06,.84);arc(48,129,"#2fb34a",r*.07,.92);arc(129,163,"#e3c02a",r*.07,.92);
 g.save();g.strokeStyle="#e0332d";g.lineWidth=3;const red=ang(163)-Math.PI/2;g.beginPath();g.moveTo(cx+Math.cos(red)*r*.8,cy+Math.sin(red)*r*.8);g.lineTo(cx+Math.cos(red)*r*.98,cy+Math.sin(red)*r*.98);g.stroke();g.restore();
 ticks(g,cx,cy,r,rad(20),rad(340),40,4,i=>i%8===0?String(i*5):"");
 caption(g,cx,cy,r,"AIRSPEED","KNOTS");needle(g,cx,cy,r*.82,ang(Math.max(0,kt)));
}
function attitude(g:CanvasRenderingContext2D,cx:number,cy:number,r:number,pitch:number,roll:number){
 bezel(g,cx,cy,r);g.save();g.beginPath();g.arc(cx,cy,r,0,TAU);g.clip();g.translate(cx,cy);g.rotate(-roll);
 const ppd=r*.055,off=pitch*180/Math.PI*ppd;g.fillStyle="#2f7fd0";g.fillRect(-r*2,-r*2+off,r*4,r*2);g.fillStyle="#8a5a2b";g.fillRect(-r*2,off,r*4,r*2);
 g.strokeStyle="#fff";g.lineWidth=2;g.beginPath();g.moveTo(-r*2,off);g.lineTo(r*2,off);g.stroke();
 g.lineWidth=1.3;g.fillStyle="#fff";g.font=`${Math.round(r*.12)}px system-ui`;g.textAlign="center";
 for(const d of [-20,-10,-5,5,10,20]){const y=off-d*ppd,w=Math.abs(d)%10===0?r*.28:r*.14;g.beginPath();g.moveTo(-w,y);g.lineTo(w,y);g.stroke();if(Math.abs(d)%10===0){g.fillText(String(Math.abs(d)),-w-r*.12,y+4);g.fillText(String(Math.abs(d)),w+r*.12,y+4)}}
 g.restore();
 g.save();g.translate(cx,cy);g.strokeStyle="#fff";g.lineWidth=2;for(const d of [-60,-45,-30,-20,-10,0,10,20,30,45,60]){const a=rad(d)-Math.PI/2,big=d%30===0;g.beginPath();g.moveTo(Math.cos(a)*r*(big?.8:.86),Math.sin(a)*r*(big?.8:.86));g.lineTo(Math.cos(a)*r*.96,Math.sin(a)*r*.96);g.stroke()}
 g.rotate(-roll);g.fillStyle="#f5a623";g.beginPath();g.moveTo(0,-r*.78);g.lineTo(-r*.06,-r*.66);g.lineTo(r*.06,-r*.66);g.fill();g.rotate(roll);
 g.strokeStyle="#f5a623";g.lineWidth=4;g.beginPath();g.moveTo(-r*.5,0);g.lineTo(-r*.18,0);g.lineTo(-r*.1,r*.08);g.moveTo(r*.5,0);g.lineTo(r*.18,0);g.lineTo(r*.1,r*.08);g.stroke();g.fillStyle="#f5a623";g.beginPath();g.arc(0,0,4,0,TAU);g.fill();g.restore();
}
function altimeter(g:CanvasRenderingContext2D,cx:number,cy:number,r:number,ft:number){
 bezel(g,cx,cy,r);ticks(g,cx,cy,r,0,TAU,50,5,i=>i<10?String(i/5*1):"");
 g.save();g.fillStyle="#e8e8e8";g.font=`${Math.round(r*.2)}px system-ui`;g.textAlign="center";g.textBaseline="middle";for(let i=0;i<10;i++){const a=i/10*TAU-Math.PI/2;g.fillText(String(i),cx+Math.cos(a)*r*.62,cy+Math.sin(a)*r*.62)}g.restore();
 caption(g,cx,cy,r,"ALT FEET",String(Math.round(ft)).padStart(5," "));
 needle(g,cx,cy,r*.5,(ft%10000)/10000*TAU,4.5);needle(g,cx,cy,r*.82,(ft%1000)/1000*TAU,2.5);
}
function turnCoordinator(g:CanvasRenderingContext2D,cx:number,cy:number,r:number,rate:number,slip:number){
 bezel(g,cx,cy,r);g.save();g.translate(cx,cy);g.strokeStyle="#fff";g.lineWidth=3;
 for(const d of [-20,0,20]){const a=rad(d);g.beginPath();g.moveTo(-Math.cos(a)*r*.62,Math.sin(a)*r*.62);g.lineTo(-Math.cos(a)*r*.8,Math.sin(a)*r*.8);g.moveTo(Math.cos(a)*r*.62,Math.sin(a)*r*.62);g.lineTo(Math.cos(a)*r*.8,Math.sin(a)*r*.8);g.stroke()}
 g.fillStyle="#9aa3ad";g.font=`${Math.round(r*.14)}px system-ui`;g.textAlign="center";g.fillText("L",-r*.62,r*.45);g.fillText("R",r*.62,r*.45);g.fillText("2 MIN",0,r*.62);
 g.rotate(Math.max(-.6,Math.min(.6,rate/3*rad(20))));g.strokeStyle="#f4f4f4";g.lineWidth=5;g.beginPath();g.moveTo(-r*.58,0);g.lineTo(r*.58,0);g.moveTo(0,-r*.12);g.lineTo(0,0);g.stroke();g.beginPath();g.arc(0,0,r*.09,0,TAU);g.fillStyle="#f4f4f4";g.fill();g.restore();
 g.save();g.translate(cx,cy+r*.36);g.fillStyle="#1f2226";g.strokeStyle="#666";g.beginPath();g.roundRect(-r*.4,-r*.08,r*.8,r*.16,r*.08);g.fill();g.stroke();g.fillStyle="#111";g.beginPath();g.arc(Math.max(-r*.32,Math.min(r*.32,slip*r*.3)),0,r*.07,0,TAU);g.fillStyle="#e8e8e8";g.fill();g.restore();
}
function heading(g:CanvasRenderingContext2D,cx:number,cy:number,r:number,deg:number){
 bezel(g,cx,cy,r);g.save();g.translate(cx,cy);g.rotate(-rad(deg));g.strokeStyle="#e8e8e8";g.fillStyle="#e8e8e8";g.textAlign="center";g.textBaseline="middle";
 for(let d=0;d<360;d+=5){const a=rad(d)-Math.PI/2,big=d%30===0;g.lineWidth=big?2:1;g.beginPath();g.moveTo(Math.cos(a)*r*(big?.78:.86),Math.sin(a)*r*(big?.78:.86));g.lineTo(Math.cos(a)*r*.96,Math.sin(a)*r*.96);g.stroke();
  if(big){g.save();g.rotate(rad(d));g.font=`${d%90===0?"bold ":""}${Math.round(r*.18)}px system-ui`;g.fillText(({0:"N",90:"E",180:"S",270:"W"} as Record<number,string>)[d]??String(d/10),0,-r*.6);g.restore()}}
 g.restore();g.save();g.translate(cx,cy);g.strokeStyle="#f5a623";g.lineWidth=3;g.beginPath();g.moveTo(0,-r*.35);g.lineTo(0,r*.3);g.moveTo(-r*.25,-r*.02);g.lineTo(r*.25,-r*.02);g.moveTo(-r*.1,r*.26);g.lineTo(r*.1,r*.26);g.stroke();
 g.fillStyle="#f5a623";g.beginPath();g.moveTo(0,-r*.99);g.lineTo(-r*.06,-r*.88);g.lineTo(r*.06,-r*.88);g.fill();g.restore();
}
function vsi(g:CanvasRenderingContext2D,cx:number,cy:number,r:number,fpm:number){
 bezel(g,cx,cy,r);const ang=(v:number)=>-Math.PI/2-Math.max(-1,Math.min(1,v/2000))*rad(170);
 g.save();g.strokeStyle="#e8e8e8";g.fillStyle="#e8e8e8";g.font=`${Math.round(r*.18)}px system-ui`;g.textAlign="center";g.textBaseline="middle";
 for(let v=-2000;v<=2000;v+=100){const a=ang(v)+Math.PI/2,big=v%500===0;g.lineWidth=big?2:1;g.beginPath();g.moveTo(cx+Math.cos(a-Math.PI/2)*r*(big?.8:.88),cy+Math.sin(a-Math.PI/2)*r*(big?.8:.88));g.lineTo(cx+Math.cos(a-Math.PI/2)*r*.97,cy+Math.sin(a-Math.PI/2)*r*.97);g.stroke();
  if(v%1000===0&&Math.abs(v)<2000||v===0){g.fillText(String(Math.abs(v)/1000*10),cx+Math.cos(a-Math.PI/2)*r*.62,cy+Math.sin(a-Math.PI/2)*r*.62)}}
 g.restore();caption(g,cx,cy,r,"VERT SPEED",`${fpm>=0?"+":""}${Math.round(fpm/10)*10}`);needle(g,cx,cy,r*.82,ang(fpm)+Math.PI/2+Math.PI);
}
export class SixPack{
 readonly canvas:HTMLCanvasElement;#g:CanvasRenderingContext2D;
 constructor(canvas:HTMLCanvasElement){this.canvas=canvas;this.#g=canvas.getContext("2d")!}
 draw(d:FlightData){
  const c=this.canvas,dpr=Math.min(2,window.devicePixelRatio||1),w=c.clientWidth,h=c.clientHeight;if(!w||!h)return;
  if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr)}
  const g=this.#g;g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
  const cols=3,rows=2,cell=Math.min(w/cols,h/rows),r=cell*.42,ox=(w-cell*cols)/2,oy=(h-cell*rows)/2,at=(i:number,j:number)=>[ox+cell*(i+.5),oy+cell*(j+.5)] as const;
  let [x,y]=at(0,0);airspeed(g,x,y,r,d.speedKt);[x,y]=at(1,0);attitude(g,x,y,r,d.pitch,d.roll);[x,y]=at(2,0);altimeter(g,x,y,r,d.altFt);
  [x,y]=at(0,1);turnCoordinator(g,x,y,r,d.turnRateDegS,d.roll*.4-d.turnRateDegS/60);[x,y]=at(1,1);heading(g,x,y,r,d.headingDeg);[x,y]=at(2,1);vsi(g,x,y,r,d.vsFpm);
 }
}
/** North-up map (simulation +z = north, +x = east), consistent with the 3D view and the heading indicator. */
export class MiniMap{
 #g:CanvasRenderingContext2D;#trail:{x:number;z:number}[]=[];
 constructor(readonly canvas:HTMLCanvasElement){this.#g=canvas.getContext("2d")!}
 reset(){this.#trail=[]}
 draw(w:WorldSnapshot){
  const c=this.canvas,dpr=Math.min(2,window.devicePixelRatio||1),W=c.clientWidth,H=c.clientHeight;if(!W||!H)return;
  if(c.width!==Math.round(W*dpr)){c.width=Math.round(W*dpr);c.height=Math.round(H*dpr)}
  const g=this.#g;g.setTransform(dpr,0,0,dpr,0,0);const a=w.aircraft.position;
  const last=this.#trail.at(-1);if(!last||Math.hypot(last.x-a.x,last.z-a.z)>6){this.#trail.push({x:a.x,z:a.z});if(this.#trail.length>600)this.#trail.shift()}
  const pts=[{x:0,z:-320},{x:0,z:520},...w.entities.map(e=>({x:e.position.x,z:e.position.z})),{x:a.x,z:a.z}];
  const minX=Math.min(...pts.map(p=>p.x))-120,maxX=Math.max(...pts.map(p=>p.x))+120,minZ=Math.min(...pts.map(p=>p.z))-120,maxZ=Math.max(...pts.map(p=>p.z))+120;
  const s=Math.min(W/(maxX-minX),H/(maxZ-minZ)),cx=(minX+maxX)/2,cz=(minZ+maxZ)/2;
  const P=(x:number,z:number)=>[W/2+(x-cx)*s,H/2-(z-cz)*s] as const;
  g.fillStyle="rgba(28,44,30,.92)";g.fillRect(0,0,W,H);
  g.strokeStyle="rgba(255,255,255,.07)";g.lineWidth=1;const grid=200;for(let x=Math.ceil(minX/grid)*grid;x<maxX;x+=grid){const [px]=P(x,0);g.beginPath();g.moveTo(px,0);g.lineTo(px,H);g.stroke()}for(let z=Math.ceil(minZ/grid)*grid;z<maxZ;z+=grid){const [,pz]=P(0,z);g.beginPath();g.moveTo(0,pz);g.lineTo(W,pz);g.stroke()}
  const [r1x,r1z]=P(-15,520),[r2x,r2z]=P(15,-320);g.fillStyle="#555a61";g.fillRect(Math.min(r1x,r2x),Math.min(r1z,r2z),Math.max(3,Math.abs(r2x-r1x)),Math.abs(r2z-r1z));
  g.strokeStyle="rgba(255,255,255,.75)";g.setLineDash([4,4]);g.beginPath();this.#trail.forEach((p,i)=>{const [x,y]=P(p.x,p.z);i?g.lineTo(x,y):g.moveTo(x,y)});g.stroke();g.setLineDash([]);
  for(const e of w.entities){const [x,y]=P(e.position.x,e.position.z);if(e.kind==="CHECKPOINT"){g.strokeStyle=w.objective.checkpointReached?"#30e070":"#ffb020";g.lineWidth=2.5;g.beginPath();g.arc(x,y,Math.max(5,e.radius*s),0,TAU);g.stroke()}
   else if(e.kind==="OBSTACLE"){g.fillStyle="#ff4d4d";g.beginPath();g.arc(x,y,Math.max(4,e.radius*s),0,TAU);g.fill()}}
  const [ax,ay]=P(a.x,a.z);g.save();g.translate(ax,ay);g.rotate(w.aircraft.heading);g.fillStyle="#fff";g.strokeStyle="#000";g.lineWidth=1;g.beginPath();g.moveTo(0,-9);g.lineTo(6,7);g.lineTo(0,4);g.lineTo(-6,7);g.closePath();g.fill();g.stroke();g.restore();
  g.fillStyle="#e8e8e8";g.font="bold 11px system-ui";g.fillText("N ▲",W-30,14);
 }
}
