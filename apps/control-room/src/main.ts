import {LiveDashboardModel} from "./live-dashboard.ts";
import {dashboardAlerts} from "./alerts.ts";
import {TelemetryBuffer} from "./telemetry-buffer.ts";
import {ReplayController} from "./replay-controller.ts";
import {watchdog} from "./watchdog.ts";
import {explanationIntegrity} from "./explanation-integrity.ts";
let model=new LiveDashboardModel();const telemetry=new TelemetryBuffer();let paused=false,pinned:string|undefined;
const replay=new ReplayController(e=>showEvent(e),s=>{$("replayPlay").textContent=s==="PLAYING"?"Pause replay":s==="DONE"?"Replay again":"Play";$("mode").textContent=`● REPLAY ${s==="DONE"?"(end)":s.toLowerCase()}`});
const $=(id:string)=>document.getElementById(id)!;
// Telemetry (live or loaded from a replay file) is untrusted: build nodes with textContent, never innerHTML.
const el=(tag:string,cls:string,...kids:(Node|string)[])=>{const x=document.createElement(tag);if(cls)x.className=cls;x.append(...kids);return x};const pct=(x:number)=>(x*100).toFixed(1)+"%";
function selected(){return pinned?model.decisions(1000).find(x=>x.decisionId===pinned):model.latest()}
function render(){
 const m=model.metrics();$("mDecisions").textContent=String(m.decisions);$("mOverrides").textContent=String(m.overrides);$("mRate").textContent=pct(m.overrideRate);$("mConfidence").textContent=pct(m.meanConfidence);$("mDisagreement").textContent=String(m.providerDisagreements);$("status").textContent=m.decisions?`${m.decisions} decisions observed`:"waiting for telemetry";
 $("decisions").replaceChildren(...model.decisions().map(d=>{const x=el("div","decision",el("b","",d.decisionId),el("span","",d.requested+(d.executed!==d.requested?` → ${d.executed}`:"")),el("span","",pct(d.confidence)),el("span","",d.provider));x.onclick=()=>{pinned=d.decisionId;$("follow").textContent="Resume live";render()};return x}));
 const overridden=model.decisions().filter(x=>x.executed!==x.requested);$("safetyBody").replaceChildren(...(overridden.length?overridden.map(x=>el("div","reason",`${x.decisionId}: ${x.requested} → ${x.executed} (${x.safetyReason??"unspecified"})`)):["No safety overrides observed."]));
 const d=selected();const alerts=dashboardAlerts(m,d);const findings=watchdog(m,model.decisions(25));
$("watchdog").replaceChildren(...findings.map(x=>el("div",`card ${x.severity==="CRITICAL"?"bad":"warn"}`,`${x.code}: ${x.detail}`)));$("alerts").replaceChildren(...alerts.map(a=>el("div",`card ${a.severity==="CRITICAL"?"bad":"warn"}`,`${a.severity}: ${a.message}`)));if(!d)return;$("selectedIntent").textContent=`${d.executed} · ${pct(d.confidence)}`;$("provider").textContent=`${d.provider} / ${d.model}`;
 const integrity=explanationIntegrity(d);$("reasons").replaceChildren(...(model.explain(d.decisionId)??[]).map(r=>el("div","reason",r)),...(integrity.complete?[]:[el("div","reason missing",`Evidence not recorded: ${integrity.missing.join(", ")}. No reason is inferred for these.`)]));
 $("alternatives").replaceChildren(...d.alternatives.map(a=>{const bar=el("i","");bar.style.width=`${Math.max(0,Math.min(100,a.probability*100))}%`;return el("div","",el("div","",`${a.intent} `,el("span","muted",pct(a.probability))),el("div","bar",bar))}));
 $("evidence").replaceChildren(el("span","pill",`experiences ${d.experienceIds.length}`),el("span","pill",`disagreement ${d.disagreement.toFixed(3)}`),...d.temporalPatterns.map(x=>el("span","pill",x)));
 const bar=(label:string,value:number,text:string)=>{const i=el("i","");i.style.width=`${Math.max(0,Math.min(100,value*100))}%`;return el("div","",el("div","",`${label} `,el("span","muted",text)),el("div","bar",i))};
 const advisor=(name:string,a:any,body:(r:any)=>Node[])=>!a?[el("div","muted",`${name}: not configured for this flight`)]:a.status!=="OK"?[el("div","reason missing",`${name} (${a.source}) ${a.status}: ${a.detail}`)]:[el("div","",`${name} · ${a.source} · ${a.latencyMs} ms`),...body(a.result)];
 $("advisors").replaceChildren(
  ...advisor("XGBoost best-practice",d.bestPractice,(r:any[])=>r.slice(0,4).map(x=>bar(x.action,x.probability,`P(success) ${pct(x.probability)}`))),
  ...advisor("Dreamer world model",d.worldModel,(r:any[])=>{const last=new Map<string,any>();for(const x of r)if(!last.has(x.action)||last.get(x.action).horizonSeconds<x.horizonSeconds)last.set(x.action,x);return [...last.values()].sort((a,b)=>a.predictedRisk-b.predictedRisk).slice(0,4).map(x=>bar(x.action,x.predictedRisk,`risk ${x.predictedRisk.toFixed(2)} ± ${x.uncertainty.toFixed(2)} @${x.horizonSeconds}s`))}),
  ...(d.shadows??[]).map(s=>el("div","",s.error?`Shadow ${s.provider}/${s.model}: failed (${s.error})`:`Shadow ${s.provider}/${s.model}: ${s.top??"—"}${s.probability!==undefined?` ${pct(s.probability)}`:""}`)));
 $("selectedSafety").textContent=d.executed!==d.requested?`${d.requested} → ${d.executed}: ${d.safetyReason??"unspecified"}`:"✓ Accepted without override";$("outcomes").textContent=JSON.stringify(d.outcomes,null,2);$("rawBody").textContent=JSON.stringify({...d,explanationIntegrity:integrity},null,2);$("pinState").textContent=pinned?`Pinned: ${d.decisionId}`:"Following latest decision";
}
export function showEvent(e:any){telemetry.push(e);model.ingest(e);if(!paused)render()}(globalThis as any).flightInspector={showEvent,get model(){return model}};
$("pause").onclick=()=>{paused=!paused;$("pause").textContent=paused?"Resume UI":"Pause UI";if(!paused)render()};
$("follow").onclick=()=>{pinned=undefined;$("follow").textContent="Following latest";render()};
$("export").onclick=()=>{const blob=new Blob([telemetry.toJsonl()],{type:"application/x-ndjson"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="flight-world-telemetry.jsonl";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.add("hidden"));$(b.dataset.tab!).classList.remove("hidden")});
window.addEventListener("message",e=>{if(e.origin!==location.origin)return;if(e.data?.type==="FLIGHT_RUNTIME_EVENT")showEvent(e.data.event)});

$("loadReplay").onclick=()=>($("replayFile") as HTMLInputElement).click();
($("replayFile") as HTMLInputElement).onchange=async e=>{const f=(e.target as HTMLInputElement).files?.[0];if(f){replay.loadJsonl(await f.text());model=new LiveDashboardModel();telemetry.clear();pinned=undefined;$("follow").textContent="Following latest";render();$("status").textContent=`replay loaded: ${replay.position.total} events`}(e.target as HTMLInputElement).value=""};
$("replayStep").onclick=()=>replay.step();
$("replayPlay").onclick=()=>{if(replay.state==="IDLE")return;if(replay.state==="PLAYING")replay.pause();else replay.play(100)};
