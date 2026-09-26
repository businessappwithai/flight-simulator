import {useEffect,useState,useSyncExternalStore} from "react";
import type {LabConfig,LabGenerationSummary} from "@flight/protocol";
import {LabStore,type LabRun} from "./lab-store.ts";
import {ConfigPanel,DEFAULT_CONFIG} from "./ConfigPanel.tsx";
import {LineChart,HBars,SERIES,STATUS,pct,type Series} from "./charts.tsx";
import {FlightCapture} from "./FlightCapture.tsx";
import {DecisionTrace} from "./DecisionTrace.tsx";
/* Learning Lab: configure → run generations → watch whether learning improves → drill into any flight and decision. */
const CFG_KEY="flightWorld.lab.config.v1";
function loadConfig():LabConfig{try{const s=localStorage.getItem(CFG_KEY);return s?{...DEFAULT_CONFIG,...JSON.parse(s)}:DEFAULT_CONFIG}catch{return DEFAULT_CONFIG}}
const METRICS:{key:string;title:string;note?:string;get:(g:LabGenerationSummary)=>number|null;fmt:(v:number)=>string;range?:[number,number]}[]=[
 {key:"gate",title:"Gate reached",note:"higher is better",get:g=>g.metrics.gateRate,fmt:pct,range:[0,1]},
 {key:"coll",title:"Balloon collisions",note:"lower is better",get:g=>g.metrics.collisionRate,fmt:pct,range:[0,1]},
 {key:"good",title:"Good decisions",note:"labelled at the horizon",get:g=>g.metrics.goodDecisionRate,fmt:pct,range:[0,1]},
 {key:"auc",title:"XGBoost holdout AUC",note:"on unseen flights · 0.5 = guessing",get:g=>g.holdout&&Number.isFinite(g.holdout.auc)?g.holdout.auc:null,fmt:v=>v.toFixed(3),range:[.5,1]},
 {key:"ll",title:"XGBoost holdout log-loss",note:"lower is better",get:g=>g.holdout?g.holdout.logloss:null,fmt:v=>v.toFixed(3)},
 {key:"ovr",title:"Safety overrides",note:"of all decisions",get:g=>g.metrics.overrideRate,fmt:v=>`${(v*100).toFixed(1)}%`},
 {key:"chg",title:"XGBoost changed Jev's choice",note:"of all decisions",get:g=>g.metrics.advisorChangeRate,fmt:v=>`${(v*100).toFixed(1)}%`},
 {key:"spread",title:"Action sensitivity",note:"spread of P(success) across actions",get:g=>g.generation===0?null:g.metrics.advisorSpread,fmt:pct,range:[0,1]},
 {key:"gdist",title:"Closest approach to gate",note:"metres · lower is better",get:g=>g.metrics.meanGateDistance,fmt:v=>`${v.toFixed(0)} m`},
];
export function LabView({store}:{store:LabStore}){
 const v=useSyncExternalStore(store.subscribe,store.getSnapshot);
 const [config,setConfig]=useState<LabConfig>(loadConfig);const [panel,setPanel]=useState(true);const [help,setHelp]=useState(false);
 useEffect(()=>{try{localStorage.setItem(CFG_KEY,JSON.stringify(config))}catch{/* private mode: settings just aren't remembered */}},[config]);
 const cur=v.current,running=cur?.status==="running",gens=cur?.generations??[],sel=v.selection,g=gens.find(x=>x.generation===sel?.generation);
 const shownRuns=v.runs.filter(r=>v.compare.includes(r.id)),color=(r:LabRun)=>SERIES[v.runs.indexOf(r)%SERIES.length]!;
 const series=(get:(g:LabGenerationSummary)=>number|null):Series[]=>shownRuns.map(r=>({name:`#${r.id} ${r.label}`,color:color(r),points:r.generations.map(x=>({x:x.generation,y:get(x)}))}));
 const decision=v.episode&&sel?.decisionId?v.episode.decisions.find(d=>d.id===sel.decisionId):undefined;
 const latest=[...gens].reverse().find(x=>x.training)?.generation??null;
 const imp=g?.training?.importance??[],prevImp=gens.find(x=>x.generation===(sel?.generation??0)-1)?.training?.importance,total=imp.reduce((a,b)=>a+b.gain,0)||1,prevTotal=prevImp?.reduce((a,b)=>a+b.gain,0)||1;
 const p=v.progress;
 const step=(delta:-1|1)=>{const ds=v.episode?.decisions;if(!ds||!decision)return;const i=ds.findIndex(d=>d.id===decision.id),n=ds[Math.max(0,Math.min(ds.length-1,i+delta))];if(n&&n.id!==decision.id)store.selectDecision(n.id)};
 useEffect(()=>{const k=(e:KeyboardEvent)=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;if(e.key==="ArrowLeft")step(-1);if(e.key==="ArrowRight")step(1)};window.addEventListener("keydown",k);return()=>window.removeEventListener("keydown",k)});
 return <div className={`lab ${panel?"":"no-panel"}`}>
  <aside className="lab-panel" hidden={!panel}><ConfigPanel config={config} onChange={setConfig} running={!!running} onRun={()=>store.start(config)} onStop={()=>store.stop()}/></aside>
  <div className="lab-main">
   <div className="lab-bar">
    <button onClick={()=>setPanel(x=>!x)} aria-expanded={panel}>{panel?"◂ Hide settings":"▸ Settings"}</button>
    {running&&p?<div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={p.generations*p.episodes} aria-valuenow={p.generation*p.episodes+p.episode}>
     <span>{p.phase==="training"?`Training XGBoost on generation ${p.generation}…`:`Generation ${p.generation+1}/${p.generations} · flight ${p.episode+1}/${p.episodes}`}</span>
     <i style={{width:`${(p.generation*p.episodes+p.episode)/(p.generations*p.episodes)*100}%`}}/></div>
     :cur?<span className="muted">Run #{cur.id} {cur.status} · {gens.length} generations</span>:<span className="muted">Choose settings, then Run lab.</span>}
    <button onClick={()=>setHelp(x=>!x)} aria-expanded={help}>How to read this</button>
   </div>
   {v.error&&<div className="card notice bad" role="alert">{v.error}</div>}
   {(help||!cur)&&<div className="card howto"><b>What the lab does</b><ol>
    <li><b>Fly.</b> Each generation flies the same set of scenarios (take off, fly through the gate, avoid the balloon). A decision provider — Jev, or the local rule-based stand-in — proposes a probability for every action, four times a second.</li>
    <li><b>Judge.</b> Every decision is labelled good or bad by what actually happened next (survived, kept clear of the balloon, not overridden by safety, got closer to the objective).</li>
    <li><b>Learn.</b> XGBoost is retrained on all labelled decisions so far and learns P(good outcome | situation, action). Before retraining, it is scored on the new flights it has never seen (holdout AUC / log-loss) — that is the honest measure of learning.</li>
    <li><b>Steer.</b> The next generation blends Jev with XGBoost using your weight. At weight 0 XGBoost only watches (the control run).</li></ol>
    <p className="muted">Try: run <b>Shadow (control)</b>, then the same settings with weight 0.6, then <b>Deep trees</b> vs <b>Shallow stumps</b>. Runs stay on the charts so you can compare. Click any dot on the flight map to see exactly why that decision was made.</p></div>}
   {v.runs.length>0&&<div className="runs">{v.runs.map(r=><label key={r.id} className="run-chip"><input type="checkbox" checked={v.compare.includes(r.id)} onChange={()=>store.toggleCompare(r.id)}/><i style={{background:color(r)}}/>#{r.id} {r.label} <span className="muted">{r.status==="running"?"running":`${r.generations.length} gen`}</span></label>)}
    {v.runs.length>1&&<button className="linkish" onClick={()=>store.clearHistory()} disabled={running}>clear older runs</button>}</div>}
   {gens.length>0&&<section className="curves" aria-label="Learning curves">{METRICS.map(m=><div className="card" key={m.key}><LineChart title={m.title} note={m.note} series={series(m.get)} format={m.fmt} yMin={m.range?.[0]} yMax={m.range?.[1]}/></div>)}</section>}
   {gens.length>0&&<section className="card">
    <div className="gen-head"><b>Flights</b><div className="seg" role="radiogroup" aria-label="Generation">{gens.map(x=><button key={x.generation} role="radio" aria-checked={sel?.generation===x.generation} className={sel?.generation===x.generation?"on":""} onClick={()=>store.selectEpisode(x.generation,0)}>gen {x.generation}</button>)}</div>
     {g&&<span className="muted">XGBoost weight {g.advisorWeight.toFixed(2)} · {g.modelFrom===null?"no model yet":`model from gen ${g.modelFrom}`}{g.holdout?` · holdout AUC ${Number.isFinite(g.holdout.auc)?g.holdout.auc.toFixed(3):"n/a"}`:""}</span>}</div>
    {g&&<div className="table-scroll"><table className="episodes"><thead><tr><th>Flight</th><th>Gate</th><th>Crash</th><th>Time</th><th>Decisions</th><th>Overrides</th><th>XGB changes</th><th>Good</th><th>Closest to gate</th></tr></thead>
     <tbody>{g.episodes.map(e=><tr key={e.episode} className={sel?.episode===e.episode?"sel":""} onClick={()=>store.selectEpisode(e.generation,e.episode)} tabIndex={0} onKeyDown={k=>{if(k.key==="Enter")store.selectEpisode(e.generation,e.episode)}}>
      <td>#{e.episode+1} <span className="muted">{e.scenarioId}</span></td><td>{e.gateReached?<span style={{color:STATUS.good}}>✓ yes</span>:"no"}</td><td>{e.collision?<span style={{color:STATUS.critical}}>✗ balloon</span>:e.crashed?<span style={{color:STATUS.critical}}>✗ ground</span>:"—"}</td>
      <td>{e.seconds.toFixed(0)} s</td><td>{e.decisions}</td><td>{e.overrides}</td><td>{e.advisorChanges}</td><td>{pct(e.goodDecisionRate)}</td><td>{e.closestGate.toFixed(0)} m</td></tr>)}</tbody></table></div>}
   </section>}
   {v.episode&&<section className="drill">
    <div className="card"><FlightCapture detail={v.episode} selectedId={sel?.decisionId} onSelect={id=>store.selectDecision(id)}/></div>
    <div className="card">{decision?<DecisionTrace d={decision} generation={v.episode.generation} latestModel={latest} explanation={v.explanation} explaining={v.explaining} action={sel?.action??decision.requested} model={sel?.model??"then"} onAction={a=>store.setTraceAction(a)} onModel={m=>store.setModel(m)} error={v.error} onStep={step}/>:<p className="muted">Select a decision on the map or the altitude profile.</p>}</div>
   </section>}
   {g?.training&&<section className="card imp">
    <div className="gen-head"><b>What XGBoost relies on</b><span className="muted">model trained after gen {g.generation}: {g.training.rows} decisions ({pct(g.training.positives/Math.max(1,g.training.rows))} good) · {g.training.trees} trees · deepest {g.training.maxDepthReached} · trained in {g.training.ms.toFixed(0)} ms · training AUC {Number.isFinite(g.training.trainEval.auc)?g.training.trainEval.auc.toFixed(3):"n/a"}</span></div>
    <HBars rows={imp.slice(0,12).map(x=>({name:x.name,value:x.gain/total,ghost:prevImp?(prevImp.find(y=>y.name===x.name)?.gain??0)/prevTotal:undefined,detail:`${x.splits} splits`}))} format={pct} valueLabel="share of split gain" ghostLabel={prevImp?`previous generation`:undefined}/>
   </section>}
  </div>
 </div>;
}
