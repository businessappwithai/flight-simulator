import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import type {DashboardStore,DashboardView} from "./dashboard-store.ts";
import type {DecisionWhy} from "./live-dashboard.ts";
import {explanationIntegrity} from "./explanation-integrity.ts";
// All text below is rendered by React (escaped). Telemetry, including replay files, is untrusted input.
const pct=(x:number)=>`${(x*100).toFixed(1)}%`;
const Bar=({value}:{value:number})=><div className="bar"><i style={{width:`${Math.max(0,Math.min(100,value*100))}%`}}/></div>;
function Header({v,store,fileRef}:{v:DashboardView;store:DashboardStore;fileRef:React.RefObject<HTMLInputElement|null>}){
 const badge=v.mode==="LIVE"?"● LIVE":`● REPLAY ${v.replay==="DONE"?"(end)":v.replay.toLowerCase()}`;
 const status=v.mode==="REPLAY"?`replay ${v.replayPosition.index}/${v.replayPosition.total} events · ${v.metrics.decisions} decisions`:v.metrics.decisions?`${v.metrics.decisions} decisions observed`:"waiting for telemetry";
 const download=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([store.exportJsonl()],{type:"application/x-ndjson"}));a.download="flight-world-telemetry.jsonl";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
 return <header className="header">
  <div className="title"><strong>Flight World Control Room</strong><span className={`badge ${v.mode}`} data-testid="mode">{badge}</span><span className="muted" data-testid="status">{status}</span></div>
  <nav className="actions">
   <button onClick={()=>store.togglePause()} aria-pressed={v.paused}>{v.paused?"Resume UI":"Pause UI"}</button>
   <button onClick={()=>store.follow()} aria-pressed={!v.pinned}>{v.pinned?"Resume live":"Following latest"}</button>
   <button onClick={download} disabled={!v.telemetrySize}>Export telemetry</button>
   <button onClick={()=>fileRef.current?.click()}>Load replay</button>
   <button onClick={()=>store.step()} disabled={v.mode!=="REPLAY"||v.replay==="DONE"}>Step</button>
   <button onClick={()=>store.togglePlay()} disabled={v.mode!=="REPLAY"} data-testid="play">{v.replay==="PLAYING"?"Pause replay":v.replay==="DONE"?"Replay again":"Play"}</button>
   {v.mode==="REPLAY"&&<button onClick={()=>store.goLive()}>Back to live</button>}
  </nav>
 </header>;
}
function Metrics({v}:{v:DashboardView}){const m=v.metrics;
 return <section className="cards">{([["Decisions",String(m.decisions)],["Safety overrides",String(m.overrides)],["Override rate",pct(m.overrideRate)],["Mean confidence",pct(m.meanConfidence)],["Disagreements",String(m.providerDisagreements)]] as const).map(([k,x])=><div className="card" key={k}><div className="muted">{k}</div><div className="metric">{x}</div></div>)}</section>}
/** One tick per decision, oldest → newest: accepted, overridden, or with elevated provider disagreement. */
function DecisionStrip({v,onPick}:{v:DashboardView;onPick:(id:string)=>void}){
 const ds=[...v.decisions].reverse();
 return <section className="card strip-card"><div className="strip-head"><span className="muted">Decision strip</span><span className="legend"><i className="ok"/>accepted <i className="ov"/>safety override <i className="dis"/>disagreement</span></div>
  <div className="strip" role="list">{ds.length?ds.map(d=><button role="listitem" key={d.decisionId} title={`${d.decisionId}: ${d.requested}${d.executed!==d.requested?` → ${d.executed}`:""}`} aria-label={d.decisionId}
   className={`tick ${d.executed!==d.requested?"ov":d.disagreement>.25?"dis":"ok"} ${v.selected?.decisionId===d.decisionId?"sel":""}`} onClick={()=>onPick(d.decisionId)}/>):<span className="muted">No decisions yet — load a replay or connect a live runtime.</span>}</div>
 </section>;
}
function Tabs({v,onPick}:{v:DashboardView;onPick:(id:string)=>void}){
 const [tab,setTab]=useState<"timeline"|"learning"|"safety"|"raw">("timeline");const overridden=v.decisions.filter(d=>d.executed!==d.requested);
 return <section className="card tabs-card">
  <div className="tabs" role="tablist">{(["timeline","learning","safety","raw"] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} onClick={()=>setTab(t)}>{({timeline:"Timeline",learning:"Learning",safety:`Safety (${overridden.length})`,raw:"Raw telemetry"})[t]}</button>)}</div>
  {tab==="timeline"&&<div className="scroll" data-testid="timeline">{v.decisions.map(d=><button className={`decision ${v.selected?.decisionId===d.decisionId?"sel":""}`} key={d.decisionId} onClick={()=>onPick(d.decisionId)}>
   <b>{d.decisionId}</b><span>{d.requested}{d.executed!==d.requested?` → ${d.executed}`:""}</span><span>{pct(d.confidence)}</span><span className="muted">{d.provider}</span></button>)}</div>}
  {tab==="learning"&&<pre>{"ExperienceForest → XGBoost outcome model (P(good outcome | situation, action)) → shadow validation → promotion gate\nDreamer world-model trust → counterfactual verification → reusable skills"}</pre>}
  {tab==="safety"&&<div data-testid="safety">{overridden.length?overridden.map(d=><div className="reason" key={d.decisionId}>{`${d.decisionId}: ${d.requested} → ${d.executed} (${d.safetyReason??"unspecified"})`}</div>):"No safety overrides observed."}</div>}
  {tab==="raw"&&<pre className="scroll">{v.selected?JSON.stringify({...v.selected,explanationIntegrity:explanationIntegrity(v.selected)},null,2):"—"}</pre>}
 </section>;
}
function Advisors({d}:{d:DecisionWhy}){
 const bp=d.bestPractice,wm=d.worldModel;
 const lastByAction=wm?.status==="OK"?[...new Map(wm.result.map(x=>[x.action,x])).values()].sort((a,b)=>a.predictedRisk-b.predictedRisk).slice(0,4):[];
 return <>
  {!bp?<div className="muted">XGBoost best-practice: not configured for this flight</div>:bp.status!=="OK"?<div className="reason missing">{`XGBoost best-practice (${bp.source}) ${bp.status}: ${bp.detail}`}</div>:
   <><div>{`XGBoost best-practice · ${bp.source} · ${bp.latencyMs} ms`}</div>{bp.result.slice(0,4).map(x=><div key={x.action}><div>{x.action} <span className="muted">P(success) {pct(x.probability)}</span></div><Bar value={x.probability}/></div>)}</>}
  {!wm?<div className="muted">Dreamer world model: not configured for this flight</div>:wm.status!=="OK"?<div className="reason missing">{`World model (${wm.source}) ${wm.status}: ${wm.detail}`}</div>:
   <><div>{`Dreamer world model · ${wm.source} · ${wm.latencyMs} ms`}</div>{lastByAction.map(x=><div key={x.action}><div>{x.action} <span className="muted">risk {x.predictedRisk.toFixed(2)} ± {x.uncertainty.toFixed(2)} @{x.horizonSeconds}s</span></div><Bar value={x.predictedRisk}/></div>)}</>}
  {(d.shadows??[]).map(s=><div key={s.provider+s.model}>{s.error?`Shadow ${s.provider}/${s.model}: failed (${s.error})`:`Shadow ${s.provider}/${s.model}: ${s.top??"—"}${s.probability!==undefined?` ${pct(s.probability)}`:""}`}</div>)}
 </>;
}
function WhyPanel({v,panelRef}:{v:DashboardView;panelRef:React.RefObject<HTMLElement|null>}){
 const d=v.selected;
 return <aside className="side" ref={panelRef} aria-label="Why this decision?">
  <div className="muted">WHY THIS DECISION?</div>
  {!d?<><div className="selectedIntent">—</div><div className="muted">Waiting for first decision</div></>:<>
   <div className="selectedIntent" data-testid="why-intent">{d.executed} · {pct(d.confidence)}</div><div className="muted">{d.provider} / {d.model}</div><hr/>
   <div data-testid="reasons">{v.reasons.map((r,i)=><div className="reason" key={i}>{r}</div>)}
    {(()=>{const g=explanationIntegrity(d);return g.complete?null:<div className="reason missing">{`Evidence not recorded: ${g.missing.join(", ")}. No reason is inferred for these.`}</div>})()}</div>
   <h4>Alternatives</h4>{!d.alternatives.length?<div className="muted">Not recorded</div>:<>{d.alternatives.filter(a=>a.probability>0).map(a=><div key={a.intent}><div>{a.intent} <span className="muted">{pct(a.probability)}</span></div><Bar value={a.probability}/></div>)}
    {d.alternatives.some(a=>a.probability<=0)&&<div className="muted">{`+${d.alternatives.filter(a=>a.probability<=0).length} others at 0%`}</div>}</>}
   <h4>Evidence</h4><div><span className="pill">experiences {d.experienceIds.length}</span><span className="pill">disagreement {d.disagreement.toFixed(3)}</span>{d.temporalPatterns.map(t=><span className="pill" key={t}>{t}</span>)}</div>
   <h4>Advisors</h4><Advisors d={d}/>
   <h4>Safety</h4><div data-testid="why-safety">{d.executed!==d.requested?`${d.requested} → ${d.executed}: ${d.safetyReason??"unspecified"}`:"✓ Accepted without override"}</div>
   <h4>Outcome</h4><pre>{Object.keys(d.outcomes).length?JSON.stringify(d.outcomes,null,2):"Not yet attributed"}</pre>
  </>}
  <div className="muted" data-testid="pin">{v.pinned?`Pinned: ${v.pinned}`:"Following latest decision"}</div>
 </aside>;
}
export function App({store}:{store:DashboardStore}){
 const v=useSyncExternalStore(store.subscribe,store.getSnapshot),file=useRef<HTMLInputElement>(null),side=useRef<HTMLElement>(null);
 useEffect(()=>store.attachLive(window),[store]);
 // On narrow (portrait tablet) layouts the Why card sits below the timeline: bring it into view when picking.
 const pick=(id:string)=>{store.pin(id);if(window.matchMedia("(max-width: 1023px)").matches)requestAnimationFrame(()=>side.current?.scrollIntoView({behavior:"smooth",block:"start"}))};
 return <>
  <input ref={file} type="file" accept=".jsonl,application/x-ndjson,application/json,text/plain" hidden data-testid="replay-file" onChange={async e=>{const f=e.target.files?.[0];e.target.value="";if(!f)return;try{store.loadReplay(await f.text())}catch(err){alert(`Could not read replay: ${(err as Error).message}`)}}}/>
  <Header v={v} store={store} fileRef={file}/>
  <div className="notices">{v.alerts.map(a=><div key={a.id} className={`card notice ${a.severity==="CRITICAL"?"bad":"warn"}`}>{`${a.severity}: ${a.message}`}</div>)}{v.findings.map(f=><div key={f.code} className={`card notice ${f.severity==="CRITICAL"?"bad":"warn"}`}>{`${f.code}: ${f.detail}`}</div>)}</div>
  <div className="shell"><main><Metrics v={v}/><DecisionStrip v={v} onPick={pick}/><Tabs v={v} onPick={pick}/></main><WhyPanel v={v} panelRef={side}/></div>
 </>;
}
