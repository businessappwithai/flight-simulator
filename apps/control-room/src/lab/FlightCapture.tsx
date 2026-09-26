import {useEffect,useMemo,useRef,useState} from "react";
import type {LabDecision,LabEpisodeDetail} from "@flight/protocol";
import {INK,STATUS} from "./charts.tsx";
/*
 * Flight capture of one episode: top-down map (north up, east right) + altitude profile on a shared time axis,
 * a scrubber that moves the aircraft and balloon, and a marker for every decision. Click a marker to trace it.
 */
const ALT=["#184f95","#1c5cab","#2a78d6","#5598e7","#86b6ef","#b7d3f6"]; // sequential blue ramp, dark→light = low→high
export const MARK={normal:"#c3c2b7",advisor:"#9085e9",explored:"#c98500",override:STATUS.critical,bad:STATUS.serious};
export function decisionKind(d:LabDecision):"override"|"advisor"|"explored"|"normal"{return d.safetyReason?"override":d.changedByAdvisor?"advisor":d.explored?"explored":"normal"}
const KIND_LABEL={normal:"Jev's choice",advisor:"changed by XGBoost",explored:"exploration",override:"safety override"} as const;
function at<T extends {t:number}>(xs:readonly T[],t:number):T|undefined{let best=xs[0];for(const x of xs){if(x.t>t)break;best=x}return best}
export function FlightCapture({detail,selectedId,onSelect}:{detail:LabEpisodeDetail;selectedId?:string;onSelect:(id:string)=>void}){
 const {track,decisions,obstacleTrack,scenario}=detail,end=track.at(-1)?.t??0;
 const [t,setT]=useState(end);const [playing,setPlaying]=useState(false);const [hover,setHover]=useState<LabDecision|null>(null);
 useEffect(()=>{setT(end);setPlaying(false)},[detail,end]);
 const sel=decisions.find(d=>d.id===selectedId);
 useEffect(()=>{if(sel)setT(sel.t)},[sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
 const raf=useRef(0);
 useEffect(()=>{if(!playing)return;let last=performance.now();const step=(now:number)=>{const dt=(now-last)/1000;last=now;setT(v=>{const n=v+dt*6;if(n>=end){setPlaying(false);return end}return n});raf.current=requestAnimationFrame(step)};raf.current=requestAnimationFrame(step);return()=>cancelAnimationFrame(raf.current)},[playing,end]);
 // Map geometry
 const geo=useMemo(()=>{
  const xs=[...track.map(p=>p.x),...obstacleTrack.map(p=>p.x),scenario.checkpoint.x,scenario.runway.x-40,scenario.runway.x+40],zs=[...track.map(p=>p.z),...obstacleTrack.map(p=>p.z),scenario.checkpoint.z,-320,520];
  const minX=Math.min(...xs)-60,maxX=Math.max(...xs)+60,minZ=Math.min(...zs)-60,maxZ=Math.max(...zs)+60,W=640,H=400,s=Math.min(W/(maxX-minX),H/(maxZ-minZ));
  const ox=(W-(maxX-minX)*s)/2,oz=(H-(maxZ-minZ)*s)/2,P=(x:number,z:number)=>[ox+(x-minX)*s,H-(oz+(z-minZ)*s)] as const;
  const maxY=Math.max(10,...track.map(p=>p.y),scenario.checkpoint.y);
  return {W,H,s,P,maxY};
 },[track,obstacleTrack,scenario]);
 const {W,H,s,P,maxY}=geo;
 const segs=useMemo(()=>{const out:{d:string;c:string}[]=[];for(let i=1;i<track.length;i++){const a=track[i-1]!,b=track[i]!,[x1,y1]=P(a.x,a.z),[x2,y2]=P(b.x,b.z);out.push({d:`M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`,c:ALT[Math.min(ALT.length-1,Math.floor(b.y/maxY*ALT.length))]!})}return out},[track,P,maxY]);
 const now=at(track,t),ob=at(obstacleTrack,t);
 const [gx,gz]=P(scenario.checkpoint.x,scenario.checkpoint.z),[rx1,rz1]=P(scenario.runway.x-15,520),[rx2,rz2]=P(scenario.runway.x+15,-320);
 // Profile geometry
 const PW=640,PH=150,pl=36,pr=8,pt=8,pb=20,TX=(x:number)=>pl+(PW-pl-pr)*(end?x/end:0),TY=(y:number)=>pt+(PH-pt-pb)*(1-y/maxY);
 const setFromProfile=(e:React.PointerEvent<SVGSVGElement>)=>{const r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*PW;setT(Math.max(0,Math.min(end,(x-pl)/(PW-pl-pr)*end)))};
 // Markers overlap where the track crosses itself, so taps pick the NEAREST decision (map: in space, profile: in time)
 // instead of whichever marker happens to be on top. Markers stay individually focusable for keyboard users.
 const svgPoint=(e:React.PointerEvent<SVGSVGElement>|React.MouseEvent<SVGSVGElement>,w:number,h:number)=>{const r=e.currentTarget.getBoundingClientRect();return [(e.clientX-r.left)/r.width*w,(e.clientY-r.top)/r.height*h] as const};
 const nearestOnMap=(px:number,py:number)=>{let best:LabDecision|undefined,bd=18;for(const d of decisions){const [x,y]=P(d.x,d.z),dd=Math.hypot(x-px,y-py);if(dd<bd){bd=dd;best=d}}return best};
 const nearestInTime=(tt:number)=>{let best:LabDecision|undefined,bd=Infinity;for(const d of decisions){const dd=Math.abs(d.t-tt);if(dd<bd){bd=dd;best=d}}return best};
 const hoverMap=(e:React.PointerEvent<SVGSVGElement>)=>{const [x,y]=svgPoint(e,W,H);setHover(nearestOnMap(x,y)??null)};
 const down=useRef<{x:number;y:number}|null>(null);
 const marker=(d:LabDecision,x:number,y:number,size:number)=>{const k=decisionKind(d),selected=d.id===selectedId;return <g key={d.id} className="mk" role="button" aria-label={`${d.id} at ${d.t.toFixed(1)} s: ${d.requested}${d.executed!==d.requested?` → ${d.executed}`:""}, ${KIND_LABEL[k]}${d.label===0?", bad outcome":d.label===1?", good outcome":""}`} tabIndex={0} onKeyDown={e=>{if(e.key==="Enter")onSelect(d.id)}}>
  <circle cx={x} cy={y} r={selected?size+2:size} fill={MARK[k]} stroke={d.label===0?MARK.bad:selected?"#fff":"#111a2b"} strokeWidth={d.label===0||selected?2.5:1.5}/></g>};
 const shown=decisions.length>160?decisions.filter((d,i)=>i%2===0||d.safetyReason||d.changedByAdvisor||d.id===selectedId):decisions;
 const s0=detail.summary;
 return <div className="capture">
  <div className="cap-head"><b>Generation {detail.generation} · flight {detail.episode+1}</b><span className="muted">{s0.scenarioId} · {s0.seconds.toFixed(1)} s · {s0.decisions} decisions</span>
   <span className={`pill ${s0.gateReached?"ok":""}`}>{s0.gateReached?"✓ gate reached":`gate missed by ${s0.closestGate.toFixed(0)} m`}</span>
   {s0.collision?<span className="pill bad">✗ hit balloon</span>:s0.crashed?<span className="pill bad">✗ crashed</span>:<span className="pill">✓ no crash</span>}</div>
  <div className="cap-grid">
   <svg className="map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Top-down flight track. Tap near a decision to trace it." onPointerMove={hoverMap} onPointerLeave={()=>setHover(null)} onClick={e=>{const [x,y]=svgPoint(e,W,H),d=nearestOnMap(x,y);if(d)onSelect(d.id)}}>
    <rect x={0} y={0} width={W} height={H} fill="#0f1726"/>
    <rect x={Math.min(rx1,rx2)} y={Math.min(rz1,rz2)} width={Math.max(2,Math.abs(rx2-rx1))} height={Math.abs(rz2-rz1)} fill="#3b4150" rx={2}/>
    <text x={Math.min(rx1,rx2)+Math.abs(rx2-rx1)/2} y={Math.max(rz1,rz2)+14} textAnchor="middle" className="tick">runway</text>
    <polyline points={obstacleTrack.map(p=>P(p.x,p.z).join(",")).join(" ")} fill="none" stroke={STATUS.critical} strokeOpacity={.55} strokeWidth={1.5} strokeDasharray="4 4"/>
    <circle cx={gx} cy={gz} r={Math.max(6,scenario.gateRadius*s)} fill="none" stroke={s0.gateReached?STATUS.good:STATUS.warning} strokeWidth={3}/>
    <text x={gx} y={gz-Math.max(6,scenario.gateRadius*s)-6} textAnchor="middle" className="tick">gate {scenario.checkpoint.y.toFixed(0)} m</text>
    {segs.map((g,i)=><path key={i} d={g.d} stroke={g.c} strokeWidth={2.5} strokeLinecap="round"/>)}
    {shown.map(d=>{const [x,y]=P(d.x,d.z);return marker(d,x,y,3.5)})}
    {ob&&(()=>{const [x,y]=P(ob.x,ob.z);return <g><circle cx={x} cy={y} r={Math.max(5,scenario.obstacleRadius*s)} fill={STATUS.critical} fillOpacity={.35} stroke={STATUS.critical}/><text x={x} y={y-Math.max(5,scenario.obstacleRadius*s)-4} textAnchor="middle" className="tick">balloon</text></g>})()}
    {now&&(()=>{const [x,y]=P(now.x,now.z);return <g transform={`translate(${x},${y}) rotate(${now.heading*180/Math.PI})`}><path d="M0,-9 L6,7 L0,4 L-6,7 Z" fill="#fff" stroke="#000" strokeWidth={1}/></g>})()}
    <text x={W-10} y={18} textAnchor="end" className="tick">N ↑</text>
   </svg>
   <div className="cap-side">
    <div className="legend-block"><div className="muted">Decisions</div>{(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map(k=><div key={k} className="lg"><i style={{background:MARK[k]}}/>{KIND_LABEL[k]}{k==="override"&&" ⚠"}</div>)}
     <div className="lg"><i style={{background:"transparent",boxShadow:`inset 0 0 0 2.5px ${MARK.bad}`}}/>bad outcome (ring)</div></div>
    <div className="legend-block"><div className="muted">Altitude</div><div className="ramp">{ALT.map(c=><i key={c} style={{background:c}}/>)}</div><div className="ramp-l muted"><span>0</span><span>{maxY.toFixed(0)} m</span></div></div>
    {now&&<div className="legend-block now"><div className="muted">At {t.toFixed(1)} s</div><div>{now.y.toFixed(0)} m · {(now.speed*1.944).toFixed(0)} kt</div><div className="muted">bank {(now.roll*57.3).toFixed(0)}°</div></div>}
    {hover&&<div className="legend-block hovercard" role="status"><b>{hover.id}</b> · {hover.t.toFixed(1)} s<div>{hover.requested}{hover.executed!==hover.requested?` → ${hover.executed}`:""}</div><div className="muted">{KIND_LABEL[decisionKind(hover)]}{hover.label!==undefined?` · ${hover.label?"good":"bad"} outcome`:""}</div></div>}
   </div>
  </div>
  <svg className="profile" viewBox={`0 0 ${PW} ${PH}`} role="img" aria-label="Altitude over time. Drag to scrub, tap to trace the nearest decision."
   onPointerDown={e=>{down.current={x:e.clientX,y:e.clientY};setFromProfile(e)}} onPointerMove={e=>{if(e.buttons)setFromProfile(e)}}
   onPointerUp={e=>{const s=down.current;down.current=null;if(s&&Math.hypot(e.clientX-s.x,e.clientY-s.y)<6){const r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*PW,d=nearestInTime((x-pl)/(PW-pl-pr)*end);if(d)onSelect(d.id)}}}>
   {[0,maxY/2,maxY].map((y,i)=><g key={i}><line x1={pl} x2={PW-pr} y1={TY(y)} y2={TY(y)} stroke={INK.grid}/><text x={pl-5} y={TY(y)+4} textAnchor="end" className="tick">{y.toFixed(0)}</text></g>)}
   <line x1={pl} x2={PW-pr} y1={TY(scenario.checkpoint.y)} y2={TY(scenario.checkpoint.y)} stroke={STATUS.warning} strokeDasharray="5 4" strokeWidth={1.5}/><text x={PW-pr} y={TY(scenario.checkpoint.y)+(TY(scenario.checkpoint.y)<pt+14?12:-4)} textAnchor="end" className="tick">gate height</text>
   <polyline points={track.map(p=>`${TX(p.t)},${TY(p.y)}`).join(" ")} fill="none" stroke={ALT[3]} strokeWidth={2}/>
   {shown.map(d=>marker(d,TX(d.t),TY(d.y),3))}
   <line x1={TX(t)} x2={TX(t)} y1={pt} y2={PH-pb} stroke="#fff" strokeWidth={1.5}/>
   {[0,end/2,end].map((x,i)=><text key={i} x={TX(x)} y={PH-5} textAnchor="middle" className="tick">{x.toFixed(0)} s</text>)}
  </svg>
  <div className="scrub"><button onClick={()=>{if(t>=end)setT(0);setPlaying(p=>!p)}} aria-label={playing?"Pause":"Play"}>{playing?"❚❚":"▶"}</button>
   <input type="range" min={0} max={end} step={.05} value={t} onChange={e=>{setPlaying(false);setT(Number(e.target.value))}} aria-label="Flight time"/><span className="muted">{t.toFixed(1)} / {end.toFixed(1)} s</span></div>
 </div>;
}
