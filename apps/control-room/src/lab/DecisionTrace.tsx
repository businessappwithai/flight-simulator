import {useState} from "react";
import type {LabDecision,LabExplanation,PilotIntent} from "@flight/protocol";
import {Diverging,STATUS,SERIES} from "./charts.tsx";
import {MARK,decisionKind} from "./FlightCapture.tsx";
/*
 * Everything behind one decision: Jev's distribution, XGBoost's P(success) per action, the blend that chose the
 * intent, safety, the measured outcome, and XGBoost's reasoning (additive contributions + the path through each tree).
 */
const pctx=(v:number|undefined)=>v===undefined?"—":`${(v*100).toFixed(v<.1&&v>0?1:0)}%`;
function Bar({v,color}:{v:number|undefined;color:string}){return <span className="tbar"><i style={{width:`${Math.max(0,Math.min(1,v??0))*100}%`,background:color}}/><em>{pctx(v)}</em></span>}
export function DecisionTrace({d,generation,latestModel,explanation,explaining,action,model,onAction,onModel,error,onStep}:{onStep?:(delta:-1|1)=>void;d:LabDecision;generation:number;latestModel:number|null;explanation?:LabExplanation;explaining:boolean;action:PilotIntent;model:"then"|"latest";onAction:(a:PilotIntent)=>void;onModel:(m:"then"|"latest")=>void;error?:string}){
 const [trees,setTrees]=useState(6);const [showInputs,setShowInputs]=useState(false);
 const adv=new Map(d.advisor?.map(a=>[a.action,a.probability])??[]),blend=new Map(d.blended?.map(b=>[b.intent,b.blended])??[]);
 const rows=d.provider.map(p=>({intent:p.intent,provider:p.probability,advisor:adv.get(p.intent),blended:blend.get(p.intent)}));
 const kind=decisionKind(d),noModelThen=generation===0&&model==="then";
 const ex=explanation&&explanation.action===action?explanation:undefined;
 const up=ex?.contributions.filter(c=>c.value>0).slice(0,2)??[],down=ex?.contributions.filter(c=>c.value<0).slice(0,2)??[];
 const fmtIn=(n:string,v:number)=>n.startsWith("action=")?(v?"yes":"no"):Math.abs(v)>=100?v.toFixed(0):v.toFixed(2);
 return <div className="trace">
  <div className="trace-head">
   <div className="trace-nav">{onStep&&<button onClick={()=>onStep(-1)} aria-label="Previous decision" title="Previous decision (←)">◀</button>}<div><b>{d.id}</b> at {d.t.toFixed(2)} s · {d.y.toFixed(0)} m</div>{onStep&&<button onClick={()=>onStep(1)} aria-label="Next decision" title="Next decision (→)">▶</button>}</div>
   <div className="big">{d.requested}{d.executed!==d.requested&&<> → <span style={{color:STATUS.critical}}>{d.executed}</span></>}</div>
   <div className="chips">
    <span className="pill" style={{borderColor:MARK[kind]}}>{kind==="advisor"?"XGBoost changed Jev's choice":kind==="explored"?"exploration pick":kind==="override"?"⚠ safety override":"Jev's top choice"}</span>
    {d.safetyReason&&<span className="pill bad">⚠ {d.safetyReason}</span>}
    {d.label===undefined?<span className="pill">outcome not judged (flight ended)</span>:d.label===1?<span className="pill ok">✓ good outcome</span>:<span className="pill bad">✗ bad outcome</span>}
    {d.progress!==undefined&&d.progress<1000&&<span className="pill">navigation cost {d.progress>=0?"−":"+"}{Math.abs(d.progress).toFixed(0)}</span>}
   </div>
  </div>
  <table className="cmp"><thead><tr><th>Action</th><th><i className="sw" style={{background:SERIES[0]}}/>Jev P</th><th><i className="sw" style={{background:SERIES[2]}}/>XGBoost P(success)</th><th><i className="sw" style={{background:SERIES[3]}}/>Blended</th></tr></thead>
   <tbody>{rows.map(r=><tr key={r.intent} className={`${r.intent===action?"sel":""}`} onClick={()=>onAction(r.intent)} tabIndex={0} onKeyDown={e=>{if(e.key==="Enter")onAction(r.intent)}} title="Trace XGBoost's reasoning for this action">
    <td>{r.intent}{r.intent===d.requested&&<b title="chosen"> ✓</b>}{r.intent===d.providerTop&&r.intent!==d.requested&&<span className="muted" title="Jev's top choice"> ★</span>}</td>
    <td><Bar v={r.provider} color={SERIES[0]}/></td><td><Bar v={r.advisor} color={SERIES[2]}/></td><td><Bar v={r.blended} color={SERIES[3]}/></td></tr>)}</tbody></table>
  {!d.advisor&&<p className="muted">No XGBoost model was flying yet (generation 0 collects the first data). Choose “Latest model” to see how the trained model judges this situation now.</p>}
  <div className="trace-ctl">
   <span className="muted">Explain</span><b>{action}</b><span className="muted">with</span>
   <div className="seg" role="radiogroup" aria-label="Model"><button role="radio" aria-checked={model==="then"} className={model==="then"?"on":""} onClick={()=>onModel("then")}>model that was flying{generation>0?` (gen ${generation-1})`:""}</button>
    <button role="radio" aria-checked={model==="latest"} className={model==="latest"?"on":""} onClick={()=>onModel("latest")} disabled={latestModel===null}>latest model{latestModel!==null?` (gen ${latestModel})`:""}</button></div>
  </div>
  {noModelThen?<p className="muted">Generation 0 flew without a model — nothing to trace “then”.</p>:error?<p className="error-text">{error}</p>:explaining||!ex?<p className="muted">Tracing through the trees…</p>:<>
   <p className="summary">XGBoost (model from generation {ex.modelFrom}) gives <b>{action}</b> a <b>{pctx(ex.probability)}</b> chance of a good outcome here.
    {up.length>0&&<> Pushing it up: {up.map(c=>`${c.name} = ${fmtIn(c.name,c.input)}`).join(", ")}.</>}{down.length>0&&<> Pulling it down: {down.map(c=>`${c.name} = ${fmtIn(c.name,c.input)}`).join(", ")}.</>}</p>
   <div className="muted small">Log-odds: start {ex.baseMargin.toFixed(2)} + contributions {ex.contributions.reduce((a,c)=>a+c.value,0).toFixed(2)} = {ex.margin.toFixed(3)} → P = {pctx(ex.probability)}. Blue raises, red lowers.</div>
   <Diverging rows={ex.contributions.slice(0,10).map(c=>({name:`${c.name} = ${fmtIn(c.name,c.input)}`,value:c.value}))}/>
   <div className="tree-head"><b>Paths through the trees</b><span className="muted">{ex.trees.length} trees · deepest path {ex.maxDepth} questions · sorted by influence</span>
    <select value={trees} onChange={e=>setTrees(Number(e.target.value))} aria-label="Trees to show"><option value={3}>3</option><option value={6}>6</option><option value={12}>12</option><option value={1000}>all</option></select></div>
   <div className="trees">{[...ex.trees].sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution)).slice(0,trees).map(t=><div key={t.tree} className="tree">
    <div className="tree-title"><b>Tree {t.tree+1}</b><span style={{color:t.contribution>=0?SERIES[0]:"#e66767"}}>{t.contribution>=0?"+":""}{t.contribution.toFixed(3)}</span></div>
    <ol>{t.steps.map((s,i)=><li key={i}><span className="q">{s.feature} {s.missing?"(missing)":`= ${fmtIn(s.feature,s.value)}`}</span> <span className="muted">{s.missing?"default":s.wentLeft?`< ${s.threshold.toFixed(2)}`:`≥ ${s.threshold.toFixed(2)}`}</span> <span className="arrow">{s.wentLeft?"↙":"↘"}</span></li>)}
     <li className="leaf">leaf {t.leafValue>=0?"+":""}{t.leafValue.toFixed(3)}</li></ol></div>)}</div>
   <button className="linkish" onClick={()=>setShowInputs(v=>!v)} aria-expanded={showInputs}>{showInputs?"Hide":"Show"} all inputs XGBoost saw</button>
   {showInputs&&<table className="inputs"><tbody>{ex.contributions.length===0?<tr><td className="muted">No feature changed the prediction.</td></tr>:
    [...ex.contributions].sort((a,b)=>a.name.localeCompare(b.name)).map(c=><tr key={c.name}><td>{c.name}</td><td>{fmtIn(c.name,c.input)}</td><td style={{color:c.value>=0?SERIES[0]:"#e66767"}}>{c.value>=0?"+":""}{c.value.toFixed(3)}</td></tr>)}</tbody></table>}
  </>}
 </div>;
}
