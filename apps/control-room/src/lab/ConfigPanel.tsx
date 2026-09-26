import {useState} from "react";
import type {LabConfig} from "@flight/protocol";
/* User-configurable lab settings. Every field states what it does in one line; presets set a coherent group at once. */
export const DEFAULT_CONFIG:LabConfig={generations:8,episodesPerGeneration:6,maxSeconds:70,scenario:"seeded",seed:1,decisionIntervalTicks:30,
 provider:{kind:"local-rules",temperature:.6},advisor:{weight:.6,schedule:"fixed",selection:"sample",explorationTemperature:.12},
 model:{maxDepth:4,rounds:60,eta:.2,minChildWeight:1,subsample:.9,colsample:.9,lambda:1},bufferSize:20000,horizon:"1S"};
export const PRESETS:{name:string;hint:string;apply:(c:LabConfig)=>LabConfig}[]=[
 {name:"Quick look",hint:"4 generations × 4 flights, depth 3",apply:c=>({...c,generations:4,episodesPerGeneration:4,maxSeconds:50,model:{...c.model,maxDepth:3,rounds:40}})},
 {name:"Shadow (control)",hint:"XGBoost learns but never steers — the baseline to compare against",apply:c=>({...c,advisor:{...c.advisor,weight:0}})},
 {name:"Shallow stumps",hint:"depth 1: each tree asks one question",apply:c=>({...c,model:{...c.model,maxDepth:1,rounds:80,eta:.3}})},
 {name:"Deep trees",hint:"depth 8, 120 trees, slower learning rate",apply:c=>({...c,model:{...c.model,maxDepth:8,rounds:120,eta:.1}})},
 {name:"XGBoost in charge",hint:"weight 1, no exploration: the model decides",apply:c=>({...c,advisor:{...c.advisor,weight:1,selection:"argmax"}})},
 {name:"Ramp in",hint:"trust grows from 0 to 0.8 over the run",apply:c=>({...c,advisor:{...c.advisor,weight:.8,schedule:"ramp"}})},
];
function Num({label,help,value,min,max,step,onChange,slider}:{label:string;help:string;value:number;min:number;max:number;step:number;onChange:(v:number)=>void;slider?:boolean}){
 return <label className="field"><span className="f-label">{label}<b>{Number.isInteger(step)?value:value.toFixed(step<.1?2:1)}</b></span>
  {slider?<input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} aria-label={label}/>
   :<input type="number" min={min} max={max} step={step} value={value} onChange={e=>{const v=Number(e.target.value);if(Number.isFinite(v))onChange(Math.max(min,Math.min(max,v)))}} aria-label={label}/>}
  <span className="f-help">{help}</span></label>;
}
function Choice<T extends string>({label,help,value,options,onChange}:{label:string;help:string;value:T;options:readonly [T,string][];onChange:(v:T)=>void}){
 return <div className="field" role="radiogroup" aria-label={label}><span className="f-label">{label}</span><div className="seg">{options.map(([v,t])=><button key={v} type="button" role="radio" aria-checked={value===v} className={value===v?"on":""} onClick={()=>onChange(v)}>{t}</button>)}</div><span className="f-help">{help}</span></div>;
}
// Top-level (not nested in ConfigPanel) so inputs keep focus across re-renders.
function Group({id,title,open,toggle,children}:{id:string;title:string;open:boolean;toggle:(id:string)=>void;children:React.ReactNode}){
 return <section className="cfg-group"><button type="button" className="cfg-head" aria-expanded={open} onClick={()=>toggle(id)}>{open?"▾":"▸"} {title}</button>{open&&<div className="cfg-body">{children}</div>}</section>;
}
export function ConfigPanel({config,onChange,running,onRun,onStop}:{config:LabConfig;onChange:(c:LabConfig)=>void;running:boolean;onRun:()=>void;onStop:()=>void}){
 const c=config,set=(p:Partial<LabConfig>)=>onChange({...c,...p}),m=(p:Partial<LabConfig["model"]>)=>set({model:{...c.model,...p}}),a=(p:Partial<LabConfig["advisor"]>)=>set({advisor:{...c.advisor,...p}}),pr=(p:Partial<LabConfig["provider"]>)=>set({provider:{...c.provider,...p}});
 const [open,setOpen]=useState<Record<string,boolean>>({model:true,advisor:true,flights:true,provider:false,data:false});
 const toggle=(id:string)=>setOpen(o=>({...o,[id]:!o[id]}));
 const flights=c.generations*c.episodesPerGeneration;
 return <div className="cfg" aria-label="Learning Lab settings">
  <div className="cfg-actions">{running?<button className="primary" onClick={onStop}>■ Stop</button>:<button className="primary" onClick={onRun}>▶ Run lab</button>}<button onClick={()=>onChange(DEFAULT_CONFIG)} disabled={running}>Reset</button></div>
  <div className="muted cfg-sum">{flights} flights · up to {Math.round(flights*c.maxSeconds/60)} simulated min</div>
  <div className="presets">{PRESETS.map(p=><button key={p.name} type="button" title={p.hint} disabled={running} onClick={()=>onChange(p.apply(c))}>{p.name}</button>)}</div>
  <Group id="model" open={!!open.model} toggle={toggle} title="XGBoost model">
   <Num slider label="Tree depth" help="How many questions each tree may ask. Deeper = more specific rules, more risk of memorising." value={c.model.maxDepth} min={1} max={12} step={1} onChange={v=>m({maxDepth:v})}/>
   <Num slider label="Trees (boosting rounds)" help="Each tree corrects the previous ones' mistakes." value={c.model.rounds} min={5} max={300} step={5} onChange={v=>m({rounds:v})}/>
   <Num slider label="Learning rate (eta)" help="How much each new tree may change the answer. Lower = slower but steadier." value={c.model.eta} min={.01} max={1} step={.01} onChange={v=>m({eta:v})}/>
   <Num label="Min child weight" help="Minimum evidence in a leaf; higher = fewer, safer splits." value={c.model.minChildWeight} min={0} max={50} step={.5} onChange={v=>m({minChildWeight:v})}/>
   <Num label="Row subsample" help="Fraction of decisions each tree sees (adds robustness)." value={c.model.subsample} min={.3} max={1} step={.05} onChange={v=>m({subsample:v})}/>
   <Num label="Feature subsample" help="Fraction of features each tree may use." value={c.model.colsample} min={.3} max={1} step={.05} onChange={v=>m({colsample:v})}/>
   <Num label="L2 regularisation (λ)" help="Shrinks leaf values; higher = more cautious model." value={c.model.lambda} min={0} max={50} step={.5} onChange={v=>m({lambda:v})}/>
  </Group>
  <Group id="advisor" open={!!open.advisor} toggle={toggle} title="How much XGBoost steers">
   <Num slider label="XGBoost weight" help="0 = shadow (advice only). Final score = (1−w)·Jev + w·XGBoost P(success)." value={c.advisor.weight} min={0} max={1} step={.05} onChange={v=>a({weight:v})}/>
   <Choice label="Schedule" help="Ramp grows the weight from 0 to the value above over the run." value={c.advisor.schedule} options={[["fixed","Fixed"],["ramp","Ramp in"]] as const} onChange={v=>a({schedule:v})}/>
   <Choice label="Selection" help="Sample keeps exploring (needed to discover better actions); best-only exploits." value={c.advisor.selection} options={[["sample","Sample"],["argmax","Best only"]] as const} onChange={v=>a({selection:v})}/>
   {c.advisor.selection==="sample"&&<Num label="Exploration temperature" help="Higher = more random choices." value={c.advisor.explorationTemperature} min={.01} max={2} step={.01} onChange={v=>a({explorationTemperature:v})}/>}
  </Group>
  <Group id="flights" open={!!open.flights} toggle={toggle} title="Flights">
   <Num label="Generations" help="Rounds of fly → learn. XGBoost retrains after each." value={c.generations} min={1} max={50} step={1} onChange={v=>set({generations:v})}/>
   <Num label="Flights per generation" help="The same scenarios every generation, so changes come from learning." value={c.episodesPerGeneration} min={1} max={50} step={1} onChange={v=>set({episodesPerGeneration:v})}/>
   <Num label="Max flight time (s)" help="Simulated seconds per flight." value={c.maxSeconds} min={10} max={300} step={5} onChange={v=>set({maxSeconds:v})}/>
   <Choice label="Scenarios" help="Seeded varies gate and balloon per flight." value={c.scenario} options={[["seeded","Seeded variety"],["default","Default only"]] as const} onChange={v=>set({scenario:v})}/>
   <Num label="Seed" help="Same seed + settings = identical run." value={c.seed} min={0} max={1e9} step={1} onChange={v=>set({seed:v})}/>
   <Num label="Decision interval (ticks)" help="120 ticks = 1 s. 30 = four decisions per second." value={c.decisionIntervalTicks} min={6} max={240} step={6} onChange={v=>set({decisionIntervalTicks:v})}/>
  </Group>
  <Group id="provider" open={!!open.provider} toggle={toggle} title="Decision provider (Jev)">
   <Choice label="Provider" help="No Jev service here: the local rule-based pilot stands in. Open-Jev falls back to it on errors." value={c.provider.kind} options={[["local-rules","Local rules"],["open-jev","Open-Jev HTTP"]] as const} onChange={v=>pr({kind:v})}/>
   <Num slider label="Provider temperature" help="Flatter Jev distribution = more mistakes for XGBoost to learn from." value={c.provider.temperature} min={.05} max={2} step={.05} onChange={v=>pr({temperature:v})}/>
   {c.provider.kind==="open-jev"&&<><label className="field"><span className="f-label">Endpoint</span><input value={c.provider.endpoint??""} placeholder="http://localhost:8080" onChange={e=>pr({endpoint:e.target.value})}/><span className="f-help">Calls {"{endpoint}"}/v1/systemone (must allow CORS).</span></label>
    <label className="field"><span className="f-label">Model</span><input value={c.provider.model??""} placeholder="default" onChange={e=>pr({model:e.target.value})}/></label></>}
  </Group>
  <Group id="data" open={!!open.data} toggle={toggle} title="Learning data">
   <Choice label="Outcome horizon" help="When a decision is judged good or bad." value={c.horizon} options={[["1S","1 second"],["3S","3 seconds"]] as const} onChange={v=>set({horizon:v})}/>
   <Num label="Training buffer" help="Most recent labelled decisions kept for training." value={c.bufferSize} min={100} max={200000} step={100} onChange={v=>set({bufferSize:v})}/>
  </Group>
 </div>;
}
