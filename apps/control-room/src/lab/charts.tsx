import {useId,useMemo,useRef,useState,type ReactNode} from "react";
/*
 * Small SVG chart kit for the Learning Lab (dark theme). Palette: the validated dark categorical steps, assigned to runs
 * in fixed order (never cycled); status colours are reserved for good/critical and always paired with a label or icon.
 */
export const SERIES=["#3987e5","#d95926","#199e70","#c98500"] as const;
export const INK={primary:"#eaf0ff",secondary:"#c3c2b7",muted:"#898781",grid:"#2c2c2a",axis:"#383835"};
export const STATUS={good:"#0ca30c",warning:"#fab219",serious:"#ec835a",critical:"#d03b3b"};
export const DIVERGING={pos:"#3987e5",neg:"#e66767",mid:"#383835"};
export interface Series{name:string;color:string;points:readonly {x:number;y:number|null}[]}
const nice=(v:number)=>Math.abs(v)>=100?v.toFixed(0):Math.abs(v)>=10?v.toFixed(1):v.toFixed(2);
/** Line chart with a snapping crosshair and one tooltip listing every series at that x. */
export function LineChart({title,series,format=nice,yMin,yMax,height=150,xLabel="generation",note}:{title:string;series:readonly Series[];format?:(v:number)=>string;yMin?:number;yMax?:number;height?:number;xLabel?:string;note?:ReactNode}){
 const [hover,setHover]=useState<number|null>(null);const ref=useRef<SVGSVGElement>(null);const id=useId();
 const W=320,H=height,pl=38,pr=10,pt=10,pb=22;
 const xs=[...new Set(series.flatMap(s=>s.points.map(p=>p.x)))].sort((a,b)=>a-b);
 const ys=series.flatMap(s=>s.points.map(p=>p.y).filter((y):y is number=>y!==null&&Number.isFinite(y)));
 let lo=yMin??Math.min(0,...ys),hi=yMax??Math.max(...ys,lo+1e-9);if(!(hi>lo))hi=lo+1;
 const xMax=Math.max(1,xs.at(-1)??1),X=(x:number)=>pl+(W-pl-pr)*(x/xMax),Y=(y:number)=>pt+(H-pt-pb)*(1-(y-lo)/(hi-lo));
 const ticks=[lo,(lo+hi)/2,hi];
 const onMove=(e:React.PointerEvent)=>{const r=ref.current!.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*W;let best=xs[0]??0;for(const x of xs)if(Math.abs(X(x)-px)<Math.abs(X(best)-px))best=x;setHover(best)};
 return <figure className="chart" aria-labelledby={id}>
  <figcaption id={id}>{title}{note&&<span className="muted"> · {note}</span>}</figcaption>
  {!ys.length?<div className="chart-empty muted">No data yet</div>:
  <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onPointerMove={onMove} onPointerLeave={()=>setHover(null)}>
   {ticks.map((t,i)=><g key={i}><line x1={pl} x2={W-pr} y1={Y(t)} y2={Y(t)} stroke={INK.grid} strokeWidth={1}/><text x={pl-6} y={Y(t)+4} textAnchor="end" className="tick">{format(t)}</text></g>)}
   <line x1={pl} x2={W-pr} y1={H-pb} y2={H-pb} stroke={INK.axis}/>
   {xs.map(x=><text key={x} x={X(x)} y={H-6} textAnchor="middle" className="tick">{x}</text>)}
   {series.map(s=>{const pts=s.points.filter(p=>p.y!==null&&Number.isFinite(p.y));return <g key={s.name}>
    <polyline fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={pts.map(p=>`${X(p.x)},${Y(p.y!)}`).join(" ")}/>
    {pts.map(p=><circle key={p.x} cx={X(p.x)} cy={Y(p.y!)} r={hover===p.x?4.5:3} fill={s.color} stroke="#111a2b" strokeWidth={2}/>)}</g>})}
   {hover!==null&&<line x1={X(hover)} x2={X(hover)} y1={pt} y2={H-pb} stroke={INK.secondary} strokeWidth={1} strokeDasharray="3 3"/>}
  </svg>}
  {hover!==null&&<div className="tooltip" role="status"><div className="muted">{xLabel} {hover}</div>{series.map(s=>{const p=s.points.find(q=>q.x===hover);return <div key={s.name} className="tt-row"><i style={{background:s.color}}/><b>{p?.y===null||p===undefined?"—":format(p.y)}</b><span className="muted">{s.name}</span></div>})}</div>}
 </figure>;
}
/** Horizontal bars (e.g. feature importance), optional ghost bars for a comparison value. */
export function HBars({rows,format=nice,color=SERIES[0],ghostLabel,valueLabel}:{rows:readonly {name:string;value:number;ghost?:number;detail?:string}[];format?:(v:number)=>string;color?:string;ghostLabel?:string;valueLabel?:string}){
 const max=Math.max(1e-9,...rows.flatMap(r=>[r.value,r.ghost??0]));
 return <div className="hbars" role="table">{(ghostLabel||valueLabel)&&<div className="hb-legend muted">{valueLabel&&<span><i style={{background:color}}/>{valueLabel}</span>}{ghostLabel&&<span><i className="ghost"/>{ghostLabel}</span>}</div>}
  {rows.map(r=><div className="hb-row" role="row" key={r.name} title={r.detail}>
  <span className="hb-name" role="cell">{r.name}</span>
  <span className="hb-track" role="cell">{r.ghost!==undefined&&<i className="ghost" style={{width:`${r.ghost/max*100}%`}}/>}<i style={{width:`${Math.max(0,r.value)/max*100}%`,background:color}}/></span>
  <span className="hb-val" role="cell">{format(r.value)}</span></div>)}</div>;
}
/** Diverging bar around zero (contributions): blue raises P(success), red lowers it. */
export function Diverging({rows,format=(v:number)=>(v>0?"+":"")+v.toFixed(3)}:{rows:readonly {name:string;value:number;detail?:string}[];format?:(v:number)=>string}){
 const max=Math.max(1e-9,...rows.map(r=>Math.abs(r.value)));
 return <div className="div-bars" role="table">{rows.map(r=><div className="dv-row" role="row" key={r.name} title={r.detail}>
  <span className="hb-name" role="cell">{r.name}</span>
  <span className="dv-track" role="cell"><span className="dv-neg">{r.value<0&&<i style={{width:`${-r.value/max*100}%`,background:DIVERGING.neg}}/>}</span><span className="dv-pos">{r.value>0&&<i style={{width:`${r.value/max*100}%`,background:DIVERGING.pos}}/>}</span></span>
  <span className="hb-val" role="cell">{format(r.value)}</span></div>)}</div>;
}
export const pct=(v:number)=>`${(v*100).toFixed(0)}%`;
export function useMemoStable<T>(f:()=>T,deps:unknown[]){return useMemo(f,deps)} // eslint-disable-line react-hooks/exhaustive-deps
