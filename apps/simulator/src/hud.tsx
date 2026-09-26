import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import type {PilotIntent} from "@flight/protocol";
import {SixPack,MiniMap,flightData} from "./instruments.ts";
import type {SimStore,HudState} from "./sim-store.ts";
import type {CameraMode} from "./cameras.ts";
/* DOM heads-up display. React re-renders at most ~10 Hz from the store; instruments redraw every animation frame. */
export const useHud=(store:SimStore):HudState=>useSyncExternalStore(store.subscribe,store.getSnapshot);
function useAnimationFrame(draw:()=>void){useEffect(()=>{let id=0;const loop=()=>{draw();id=requestAnimationFrame(loop)};id=requestAnimationFrame(loop);return()=>cancelAnimationFrame(id)},[draw])}
export function Instruments({store}:{store:SimStore}){
 const ref=useRef<HTMLCanvasElement>(null),six=useRef<SixPack|null>(null);
 useEffect(()=>{if(ref.current)six.current=new SixPack(ref.current)},[]);
 useAnimationFrame(useRef(()=>{const l=store.latest;if(l&&six.current)six.current.draw(flightData(l.world,store.prevHeading,store.turnDt))}).current);
 return <div className="panel instruments"><canvas ref={ref} aria-label="Flight instruments"/></div>;
}
export function MovingMap({store}:{store:SimStore}){
 const ref=useRef<HTMLCanvasElement>(null),map=useRef<MiniMap|null>(null);
 useEffect(()=>{if(!ref.current)return;map.current=new MiniMap(ref.current);return store.onReset(()=>map.current?.reset())},[store]);
 useAnimationFrame(useRef(()=>{const l=store.latest;if(l&&map.current)map.current.draw(l.world)}).current);
 return <div className="panel map"><canvas ref={ref} aria-label="Moving map"/></div>;
}
export function Readout({hud}:{hud:HudState}){
 if(!hud.world)return <div className="panel readout"/>;
 const d=flightData(hud.world,undefined,0),rows:[string,string][]=[["IAS",`${d.speedKt.toFixed(0)} kt`],["ALT",`${d.altFt.toFixed(0)} ft`],["V/S",`${d.vsFpm>=0?"+":""}${d.vsFpm.toFixed(0)} fpm`],["HDG",`${d.headingDeg.toFixed(0).padStart(3,"0")}°`],["FPS",String(hud.fps)],["SIM",`×${hud.simRate.toFixed(2)}`],["CHK",(hud.checksum??"—").slice(0,10)]];
 return <div className="panel readout">{rows.map(([k,v])=><div key={k}><span className="k">{k}</span>{v}</div>)}</div>;
}
export function TopBar({hud,camera,panel,ai,onCamera,onPanel,onAi,onHelp,store}:{hud:HudState;camera:CameraMode;panel:boolean;ai:boolean;onCamera:()=>void;onPanel:()=>void;onAi:()=>void;onHelp:()=>void;store:SimStore}){
 const phase=hud.world?.objective.phase??"—",ref=useRef<HTMLElement>(null);
 // The bar wraps to one, two or three rows with the width; publish where it ends so the panels below it never cover its buttons.
 useEffect(()=>{const el=ref.current;if(!el)return;const set=()=>document.documentElement.style.setProperty("--top-h",`${Math.ceil(el.getBoundingClientRect().bottom)}px`);
  set();const ro=new ResizeObserver(set);ro.observe(el);return()=>ro.disconnect()},[]);
 return <header className="top" ref={ref}>
  <div className="chips">
   <div className="chip panel opt"><b>FLIGHT WORLD</b></div>
   <div className="chip panel"><span className="k">MISSION</span><b className={`phase ${phase}`} data-testid="phase">{phase}</b></div>
   <div className="chip panel"><span className="k">PILOT</span><b data-testid="pilot">{hud.pilot}</b> <span className="k" data-testid="mode">{hud.pilot==="AUTOPILOT"?hud.autopilotMode:hud.intent}</span></div>
   <div className="chip panel opt"><span className="k">CAM</span><b data-testid="camera">{camera}</b></div>
   <div className="chip panel opt"><span className="k">SCENARIO</span><b data-testid="scenario">{hud.scenarioId}</b></div>
   <div className="chip panel"><span className="k">T</span><b data-testid="time">{hud.world?(Number(hud.world.tick)/120).toFixed(1):"0.0"} s</b> <span className="k">×{hud.rate}</span></div>
  </div>
  <nav className="buttons">
   <button aria-pressed={hud.pilot==="AUTOPILOT"} aria-disabled={!hud.jevKeyHint} className={hud.jevKeyHint?undefined:"locked"} data-testid="autopilot"
    onClick={()=>store.setPilot(hud.pilot==="AUTOPILOT"?"MANUAL":"AUTOPILOT",true)} title={hud.jevKeyHint?"A":"Needs a Jev key"}>Autopilot</button>
   <button aria-pressed={ai} aria-expanded={ai} aria-controls="ai-panel" onClick={onAi} data-testid="ai-toggle">Jev &amp; learning</button>
   <button onClick={onCamera} title="C">Camera</button>
   <button aria-pressed={hud.paused} onClick={()=>store.togglePause()} title="P / Space" data-testid="pause">{hud.paused?"Resume":"Pause"}</button>
   <button onClick={()=>store.changeRate(-1)} aria-label="Slower" title="-">−</button><button onClick={()=>store.changeRate(1)} aria-label="Faster" title="+">+</button>
   <button onClick={()=>store.restart()} title="R">Restart</button>
   <button onClick={()=>store.restart(true)} title="N">New scenario</button>
   <button aria-pressed={panel} onClick={onPanel} title="I">Instruments</button>
   <button onClick={onHelp} title="H" aria-label="Help">?</button>
  </nav>
 </header>;
}
const PAD:[PilotIntent|null,string,string][]=[[null,"",""],["CLIMB","▲","Climb"],[null,"",""],["TURN_LEFT","◀","Turn left"],["SLOW","■","Slow"],["TURN_RIGHT","▶","Turn right"],[null,"",""],["DESCEND","▼","Descend"],[null,"",""]];
/** On-screen yoke for touch devices (iPad): hold a direction, release to hold altitude. */
export function TouchPad({store}:{store:SimStore}){
 return <div className="pad" aria-label="Touch flight controls">{PAD.map(([i,glyph,label],k)=>i?
  <button key={k} aria-label={label} data-intent={i} onPointerDown={e=>{e.preventDefault();store.manual(i);
   // Capture is best-effort: it throws for pointers the browser no longer tracks (interrupted gestures).
   try{e.currentTarget.setPointerCapture(e.pointerId)}catch{/* release still arrives via pointerup/pointercancel on the button */}}} onPointerUp={()=>store.setIntent("HOLD")} onPointerCancel={()=>store.setIntent("HOLD")}>{glyph}</button>:<span key={k}/>)}</div>;
}
/** Shown while the aircraft is parked on the runway: nothing moves until the pilot starts. */
export function StartPanel({hud,store}:{hud:HudState;store:SimStore}){
 if(hud.started||!hud.world)return null;
 return <div className="start panel" role="region" aria-label="Ready for departure" data-testid="start-panel">
  <b>Ready on runway 18</b>
  <p>Engine at idle, brakes set. Start to begin the take-off roll, or use any flight control.</p>
  <div className="start-actions">
   <button className="primary" onClick={()=>{store.setPilot("MANUAL");store.start()}} data-testid="start-manual">Start (manual)</button>
   <button onClick={()=>store.setPilot("AUTOPILOT",true)} aria-disabled={!hud.jevKeyHint} className={hud.jevKeyHint?undefined:"locked"} data-testid="start-autopilot">Start on autopilot</button>
  </div>
  {!hud.jevKeyHint&&<p className="k">The autopilot needs a Jev key. Manual flying always works.</p>}
 </div>;
}
/** Jev key entry/removal and the learning kept in this browser. */
export function AiPanel({hud,store,onClose}:{hud:HudState;store:SimStore;onClose:()=>void}){
 const [key,setKey]=useState(""),[problem,setProblem]=useState<string>(),[confirm,setConfirm]=useState(false);
 useEffect(()=>{if(!confirm)return;const t=setTimeout(()=>setConfirm(false),4000);return()=>clearTimeout(t)},[confirm]);
 const l=hud.learning,on=!!hud.jevKeyHint;
 return <section id="ai-panel" className="ai panel" aria-label="Jev key and learning" data-testid="ai-panel">
  <header><b>Jev &amp; learning</b><button className="close" onClick={onClose} aria-label="Close Jev and learning panel">×</button></header>
  {on?<div className="row" data-testid="jev-saved"><span>Jev key <code>{hud.jevKeyHint}</code></span><button onClick={()=>store.removeJevKey()} data-testid="jev-remove">Remove</button></div>
   :<form className="row" onSubmit={e=>{e.preventDefault();const p=store.saveJevKey(key);setProblem(p);if(!p)setKey("")}}>
    <label htmlFor="jev-key" className="sr">Jev key</label>
    <input id="jev-key" type="password" value={key} onChange={e=>{setKey(e.target.value);setProblem(undefined)}} placeholder="Jev key" autoComplete="off" spellCheck={false} aria-invalid={!!problem} aria-describedby={problem?"jev-problem":undefined} data-testid="jev-input"/>
    <button type="submit" disabled={!key.trim()} data-testid="jev-save">Save</button>
   </form>}
  {problem&&<p id="jev-problem" className="problem" role="alert">{problem}</p>}
  <p className="k">{on?"Autopilot and learning are on. The key is kept only in this browser.":"Add a key to turn on the autopilot and learning. Manual controls work without one."}</p>
  <dl className="stats" data-testid="learning-stats">
   <div><dt>Learning</dt><dd>{on?"on":"off"}</dd></div><div><dt>Flights</dt><dd>{l.flights}</dd></div>
   <div><dt>Landed</dt><dd>{l.landings}</dd></div><div><dt>Crashed</dt><dd>{l.crashes}</dd></div><div><dt>Experiences</dt><dd>{l.experiences}</dd></div>
  </dl>
  <p className="k" data-testid="learning-sources" title="A flight flown by both pilots counts for each">From {l.manualFlights} manual and {l.autopilotFlights} autopilot {l.manualFlights+l.autopilotFlights===1?"flight":"flights"}</p>
  {hud.insight&&<p className="insight" data-testid="insight">Best known here: <b>{hud.insight.action.replaceAll("_"," ").toLowerCase()}</b> · landed {Math.round(hud.insight.successRate*100)}% of {hud.insight.visits}
   <span className="k"> ({[hud.insight.manual&&`${hud.insight.manual} manual`,hud.insight.autopilot&&`${hud.insight.autopilot} autopilot`].filter(Boolean).join(", ")})</span></p>}
  <div className="row traces" data-testid="traces">
   <span title="Recent flights as Control Room telemetry">Traces: <b>{hud.traces.flights}</b> <span className="k">({hud.traces.manual} manual, {hud.traces.autopilot} autopilot)</span></span>
   <button onClick={()=>store.downloadTraces()} disabled={!hud.traces.flights} data-testid="traces-download" title="JSONL for the Control Room replay">Download</button>
  </div>
  <button className={confirm?"danger":undefined} onClick={()=>{if(!confirm){setConfirm(true);return}setConfirm(false);store.clearLearning()}} data-testid="learning-clear">
   {confirm?"Click again to clear learning and traces":"Clear learning & restart"}</button>
 </section>;
}
export function Banner({hud}:{hud:HudState}){if(!hud.banner)return null;return <div className="banner panel" role="status"><div>{hud.banner.title}</div>{hud.banner.detail&&<small>{hud.banner.detail}</small>}</div>}
export function ErrorBox({hud}:{hud:HudState}){if(!hud.error)return null;return <div className="error panel" role="alert">{hud.error}</div>}
export function Help({onClose}:{onClose:()=>void}){
 return <div className="help" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><div className="panel" role="dialog" aria-label="Controls">
  <b>Controls</b>
  <p>Each flight starts parked on runway 18: press <b>Start</b> or any flight control to begin.</p>
  <p><kbd>A</kbd> autopilot on/off — the autopilot takes off, flies through the gate and lands. It needs a Jev key (open <b>Jev &amp; learning</b>), which also turns on learning: every finished flight is remembered in this browser.</p>
  <p>Manual (any flight input disengages the autopilot): <kbd>W</kbd>/<kbd>↑</kbd> climb · <kbd>S</kbd>/<kbd>↓</kbd> descend · <kbd>←</kbd>/<kbd>Q</kbd> left · <kbd>→</kbd>/<kbd>E</kbd> right · <kbd>Shift</kbd> slow · <kbd>X</kbd> abort. On touch screens use the on-screen pad.</p>
  <p><kbd>C</kbd> cycle camera · <kbd>1</kbd>–<kbd>4</kbd> chase / cockpit / orbit (drag) / tower · <kbd>P</kbd> or <kbd>Space</kbd> pause · <kbd>+</kbd>/<kbd>-</kbd> time rate · <kbd>R</kbd> restart · <kbd>N</kbd> new scenario · <kbd>I</kbd> instruments · <kbd>H</kbd> help</p>
  <p className="k">Fly through the orange gate, then land back on runway 18. The balloon is the moving obstacle.</p>
  <button onClick={onClose}>Close</button>
 </div></div>;
}
