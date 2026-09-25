import {useEffect,useRef,useSyncExternalStore} from "react";
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
export function TopBar({hud,camera,panel,onCamera,onPanel,onHelp,store}:{hud:HudState;camera:CameraMode;panel:boolean;onCamera:()=>void;onPanel:()=>void;onHelp:()=>void;store:SimStore}){
 const phase=hud.world?.objective.phase??"—";
 return <header className="top">
  <div className="chips">
   <div className="chip panel opt"><b>FLIGHT WORLD</b></div>
   <div className="chip panel"><span className="k">MISSION</span><b className={`phase ${phase}`} data-testid="phase">{phase}</b></div>
   <div className="chip panel"><span className="k">PILOT</span><b data-testid="pilot">{hud.pilot}</b> <span className="k" data-testid="mode">{hud.pilot==="AUTOPILOT"?hud.autopilotMode:hud.intent}</span></div>
   <div className="chip panel opt"><span className="k">CAM</span><b data-testid="camera">{camera}</b></div>
   <div className="chip panel opt"><span className="k">SCENARIO</span><b data-testid="scenario">{hud.scenarioId}</b></div>
   <div className="chip panel"><span className="k">T</span><b data-testid="time">{hud.world?(Number(hud.world.tick)/120).toFixed(1):"0.0"} s</b> <span className="k">×{hud.rate}</span></div>
  </div>
  <nav className="buttons">
   <button aria-pressed={hud.pilot==="AUTOPILOT"} onClick={()=>store.setPilot(hud.pilot==="AUTOPILOT"?"MANUAL":"AUTOPILOT",true)} title="A">Autopilot</button>
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
export function Banner({hud}:{hud:HudState}){if(!hud.banner)return null;return <div className="banner panel" role="status"><div>{hud.banner.title}</div>{hud.banner.detail&&<small>{hud.banner.detail}</small>}</div>}
export function ErrorBox({hud}:{hud:HudState}){if(!hud.error)return null;return <div className="error panel" role="alert">{hud.error}</div>}
export function Help({onClose}:{onClose:()=>void}){
 return <div className="help" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><div className="panel" role="dialog" aria-label="Controls">
  <b>Controls</b>
  <p><kbd>A</kbd> autopilot on/off — the autopilot takes off, flies through the gate and lands.</p>
  <p>Manual (any flight input disengages the autopilot): <kbd>W</kbd>/<kbd>↑</kbd> climb · <kbd>S</kbd>/<kbd>↓</kbd> descend · <kbd>←</kbd>/<kbd>Q</kbd> left · <kbd>→</kbd>/<kbd>E</kbd> right · <kbd>Shift</kbd> slow · <kbd>X</kbd> abort. On touch screens use the on-screen pad.</p>
  <p><kbd>C</kbd> cycle camera · <kbd>1</kbd>–<kbd>4</kbd> chase / cockpit / orbit (drag) / tower · <kbd>P</kbd> or <kbd>Space</kbd> pause · <kbd>+</kbd>/<kbd>-</kbd> time rate · <kbd>R</kbd> restart · <kbd>N</kbd> new scenario · <kbd>I</kbd> instruments · <kbd>H</kbd> help</p>
  <p className="k">Fly through the orange gate, then land back on runway 18. The balloon is the moving obstacle.</p>
  <button onClick={onClose}>Close</button>
 </div></div>;
}
