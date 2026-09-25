import type {RuntimeEvent} from "@flight/protocol";
import {LiveDashboardModel,type DashboardMetrics,type DecisionWhy} from "./live-dashboard.ts";
import {TelemetryBuffer} from "./telemetry-buffer.ts";
import {ReplayController,type ReplayState} from "./replay-controller.ts";
import {dashboardAlerts,type DashboardAlert} from "./alerts.ts";
import {watchdog,type WatchdogFinding} from "./watchdog.ts";
/**
 * Control Room state outside React: telemetry model, replay and UI flags. React subscribes via
 * useSyncExternalStore; bursts of events are coalesced into one render per animation frame.
 */
export interface DashboardView{metrics:DashboardMetrics;decisions:readonly DecisionWhy[];selected?:DecisionWhy;reasons:readonly string[];alerts:readonly DashboardAlert[];findings:readonly WatchdogFinding[];
 mode:"LIVE"|"REPLAY";replay:ReplayState;replayPosition:{index:number;total:number};pinned?:string;paused:boolean;telemetrySize:number;version:number}
export class DashboardStore{
 #model=new LiveDashboardModel();readonly telemetry=new TelemetryBuffer();
 readonly replay=new ReplayController(e=>this.ingest(e),()=>this.#changed());
 #mode:"LIVE"|"REPLAY"="LIVE";#pinned?:string;#paused=false;#view:DashboardView;#listeners=new Set<()=>void>();#scheduled=false;
 constructor(){this.#view=this.#compute(0)}
 subscribe=(l:()=>void)=>{this.#listeners.add(l);return()=>{this.#listeners.delete(l)}};
 getSnapshot=()=>this.#view;
 get model(){return this.#model}
 #changed(){if(this.#paused||this.#scheduled)return;this.#scheduled=true;const run=()=>{this.#scheduled=false;this.#view=this.#compute(this.#view.version+1);for(const l of this.#listeners)l()};
  typeof requestAnimationFrame==="function"?requestAnimationFrame(run):queueMicrotask(run)}
 #compute(version:number):DashboardView{
  const m=this.#model,metrics=m.metrics(),decisions=m.decisions(),selected=this.#pinned?m.decisions(5000).find(x=>x.decisionId===this.#pinned):m.latest();
  return {metrics,decisions,selected,reasons:selected?m.explain(selected.decisionId)??[]:[],alerts:dashboardAlerts(metrics,selected),findings:watchdog(metrics,m.decisions(25)),
   mode:this.#mode,replay:this.replay.state,replayPosition:this.replay.position,pinned:this.#pinned,paused:this.#paused,telemetrySize:this.telemetry.size,version};
 }
 ingest(e:RuntimeEvent){this.telemetry.push(e);this.#model.ingest(e);this.#changed()}
 /** Loading a recording starts a fresh dashboard; live telemetry is not mixed into a replay. */
 loadReplay(jsonl:string){this.replay.loadJsonl(jsonl);this.#model=new LiveDashboardModel();this.telemetry.clear();this.#pinned=undefined;this.#mode="REPLAY";this.#changed()}
 /** Leave replay and return to an empty live dashboard. */
 goLive(){this.replay.stop();this.#model=new LiveDashboardModel();this.telemetry.clear();this.#pinned=undefined;this.#mode="LIVE";this.#changed()}
 step(){this.replay.step()}
 togglePlay(){if(this.replay.state==="IDLE")return;if(this.replay.state==="DONE"){this.#model=new LiveDashboardModel();this.telemetry.clear();this.#pinned=undefined} // replay again from a clean slate
  this.replay.state==="PLAYING"?this.replay.pause():this.replay.play(100)}
 pin(id:string){this.#pinned=id;this.#changed()}
 follow(){this.#pinned=undefined;this.#changed()}
 togglePause(){this.#paused=!this.#paused;if(!this.#paused){this.#scheduled=false;this.#changed()}else{this.#view={...this.#view,paused:true,version:this.#view.version+1};for(const l of this.#listeners)l()}}
 exportJsonl(){return this.telemetry.toJsonl()}
 /** Live bridge: same-origin FLIGHT_RUNTIME_EVENT messages only. Ignored while a replay is loaded. */
 attachLive(target:Window){const h=(e:MessageEvent)=>{if(e.origin!==target.location.origin||this.#mode==="REPLAY")return;if(e.data?.type==="FLIGHT_RUNTIME_EVENT")this.ingest(e.data.event)};target.addEventListener("message",h);return()=>target.removeEventListener("message",h)}
}
