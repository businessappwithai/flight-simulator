import {useEffect,useState} from "react";
import {REVEAL,revealFrame,type LandscapeInfo,type LandscapeStatus} from "@flight/protocol";
import type {RevealDirector} from "./reveal.ts";
/*
 * Frame 1 names the tool: a level editor shell (dark theme, panel names only, no logos) around the 3D view, which
 * shows through as its viewport. The Cmd line types the prompt, the panels slide off, the world is built in the
 * viewport, and at the end the frame shrinks back into the editor while the Outliner floods with the real count of
 * everything the simulation placed. Every number in it comes from the planet itself.
 */
const CSS=`
.ed{position:fixed;inset:0;pointer-events:none;font:12px/1.35 system-ui,Segoe UI,Roboto,sans-serif;color:#c8c8c8;z-index:30}
.ed .bar{position:absolute;left:0;right:0;background:#2a2a2a;border-bottom:1px solid #151515;display:flex;align-items:center;gap:14px;padding:0 10px}
.ed .menu{top:0;height:26px}.ed .tools{top:26px;height:38px;background:#242424}
.ed .tools span{padding:4px 9px;border-radius:3px;background:#383838;border:1px solid #1a1a1a}
.ed .tools .play{color:#7ee07e}
.ed .side{position:absolute;right:0;top:64px;bottom:0;width:300px;background:#2a2a2a;border-left:1px solid #151515;display:flex;flex-direction:column}
.ed .side h4,.ed .bottom h4{margin:0;padding:6px 10px;font-size:12px;font-weight:600;background:#1f1f1f;border-bottom:1px solid #151515;color:#e0e0e0}
.ed .outliner{flex:1;overflow:hidden}.ed .details{height:46%;overflow:hidden;border-top:1px solid #151515}
.ed .row{padding:2px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ed .row:nth-child(odd){background:#262626}
.ed .row b{color:#e6e6e6;font-weight:500}.ed .row i{float:right;font-style:normal;color:#8a8a8a}
.ed .prop{display:flex;justify-content:space-between;padding:3px 10px;border-bottom:1px solid #232323}.ed .prop span:last-child{color:#e6e6e6}
.ed .bottom{position:absolute;left:0;right:300px;bottom:0;height:190px;background:#2a2a2a;border-top:1px solid #151515;display:flex;flex-direction:column}
.ed .tabs{display:flex}.ed .tabs h4{border-right:1px solid #151515}.ed .tabs h4.dim{color:#8a8a8a;background:#262626}
.ed .log{flex:1;padding:6px 10px;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end}
.ed .log .w{color:#e8c46a}.ed .cmd{height:26px;display:flex;align-items:center;gap:8px;padding:0 10px;background:#1c1c1c;border-top:1px solid #151515;font:12px ui-monospace,monospace}
.ed .cmd b{color:#9ad;font-weight:600}.ed .caret{display:inline-block;width:7px;height:13px;background:#ccc;vertical-align:-2px;animation:edblink 1s steps(1) infinite}
@keyframes edblink{50%{opacity:0}}
.ed .vp{position:absolute;left:10px;top:72px;padding:3px 8px;background:rgba(20,20,20,.7);border-radius:3px;color:#ddd}
.ed .skip{position:absolute;right:12px;bottom:12px;pointer-events:auto;background:#383838;color:#ddd;border:1px solid #111;border-radius:3px;padding:4px 10px;font:inherit}
@media (max-width:700px){.ed .side{width:200px}.ed .bottom{right:200px;height:130px}}
`;
const fmt=(n:number)=>Math.round(n).toLocaleString("en-US");
export function EditorOverlay({director,info,status,onSkip}:{director:RevealDirector;info?:LandscapeInfo;status?:LandscapeStatus;onSkip:()=>void}){
 const [t,setT]=useState(0);
 useEffect(()=>{let id=0;const loop=()=>{setT(director.time());id=requestAnimationFrame(loop)};id=requestAnimationFrame(loop);return()=>cancelAnimationFrame(id)},[director]);
 if(!Number.isFinite(t))return null;
 const s=director.state(),R=REVEAL,slide=1-s.panels;
 const trees=status?.trees??0,buildings=status?.buildings??0,actors=status?.actors??0;
 const log:[number,string,string?][]=[
  [R.enter,`Cmd: ${R.prompt}`],
  [R.enter+.05,`LogLandscape: uplift + stream-power erosion, seed ${info?.seed??"?"}, ${info?.size??513}² nodes @ ${info?.cell??320} m`],
  [R.terrainStart,`LogLandscape: priority-flood · stochastic receivers (slope²) · hillslope diffusion`],
  [R.terrainStart+1,`LogLandscape: 10 m tiles eroded again under the flight (K 1.6e-2, 40 it)`],
  [R.waterStart,`LogWater: ocean flooded to sea level; lakes at ${info?.lakeLevelM??0} m`],
  [R.riversStart,`LogWater: rivers lit sources-first from the drainage map`],
  [R.forestStart,`LogFoliage: ${fmt(trees)} instances (pine, juniper, cottonwood)`],
  [R.cityStart,`LogCity: ${fmt(buildings)} buildings on the lake shore`],
  [R.climbStart,`LogCamera: clearance over the final terrain ≥ ${info?.clearance.minM??"?"} m (frame ${info?.clearance.frame??"?"})`,"w"],
  [R.reveal,`LogWorld: it is ${info?.brand??"the brand"}`],
  [R.outlinerStart,`LogWorld: ${fmt(actors)} actors`]];
 const shown=log.filter(l=>t>=l[0]).slice(-8);
 const outlinerBase:[string,string][]=[["Landscape_"+(info?.brand??"World"),"Landscape"],["Ocean","WaterBody"],...(info?.lakes??[]).map((_,i)=>[`Lake_${i?"RightEye":"LeftEye"}`,"WaterBody"] as [string,string]),
  ["Rivers","Spline"],["Foliage_Pine","Foliage"],["Foliage_Juniper","Foliage"],["Foliage_Cottonwood","Foliage"],["City","Instances"],["SkyAtmosphere","Sky"],["DirectionalLight_Sun","Light"],["PlayerStart_Runway18","Start"]];
 const flood=Math.floor(s.outliner*s.outliner*Math.max(0,actors-outlinerBase.length));
 const rows=s.outliner>0?Array.from({length:22},(_,i)=>{const k=flood-i;return k>0?[`Foliage_Instance_${fmt(k)}`,"Instance"] as [string,string]:null}).filter((r):r is [string,string]=>!!r).reverse():[];
 const props:[string,string][]=[["Seed",info?.seed??"—"],["Brand",info?.brand??"—"],["Simulation","uplift + stream power"],["Global field",`${info?.size??513}² · ${info?.cell??320} m`],["Detail","80 m · 10 m tiles"],
  ["Pad elevation",`${info?.padElevationM??0} m`],["Lake level",`${info?.lakeLevelM??0} m`],["Planet radius",`${fmt((info?.planetRadiusM??0)/1000)} km`],["Trees",fmt(trees)],["Buildings",fmt(buildings)],["Manifest",status?.manifest?.slice(0,12)??"…"]];
 const typed=R.prompt.slice(0,s.typed);
 return <div className="ed" aria-hidden="true" data-testid="editor-overlay" data-frame={revealFrame(t)}>
  <style>{CSS}</style>
  <div className="bar menu" style={{transform:`translateY(${-90*slide}px)`}}>{["File","Edit","Window","Tools","Build","Select","Actor","Help"].map(m=><span key={m}>{m}</span>)}<span style={{marginLeft:"auto",color:"#8a8a8a"}}>Landscape_{info?.brand??"World"}</span></div>
  <div className="bar tools" style={{transform:`translateY(${-90*slide}px)`}}><span>Select Mode ▾</span><span>Content ▾</span><span>Blueprints ▾</span><span className="play">▶ Play</span><span>Perspective</span><span>Lit</span><span>Show</span></div>
  <div className="side" style={{transform:`translateX(${320*slide}px)`}}>
   <div className="outliner"><h4>Outliner · {fmt(outlinerBase.length+flood)} actors</h4>{[...outlinerBase,...rows].slice(-26).map(([n,k],i)=><div className="row" key={i}><b>{n}</b><i>{k}</i></div>)}</div>
   <div className="details"><h4>Details</h4>{props.map(([k,v])=><div className="prop" key={k}><span>{k}</span><span>{v}</span></div>)}</div>
  </div>
  <div className="bottom" style={{transform:`translateY(${220*slide}px)`}}>
   <div className="tabs"><h4 className="dim">Content Drawer</h4><h4>Output Log</h4></div>
   <div className="log">{shown.map(([ts,l,c],i)=><div key={i} className={c}>[{ts.toFixed(2)}s] {l}</div>)}</div>
   <div className="cmd"><b>Cmd</b><span>{typed}</span>{t<R.enter&&<span className="caret"/>}</div>
  </div>
  {s.panels>.5&&t>R.backStart&&<div className="vp">Perspective · Lit</div>}
  <button className="skip" onClick={onSkip}>Skip ▸</button>
 </div>;
}
