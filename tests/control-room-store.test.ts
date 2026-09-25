import {expect,test} from "bun:test";
import {DashboardStore} from "../apps/control-room/src/dashboard-store.ts";
const lines=[{type:"DECISION",frame:{id:"d-1",startTick:"0n",requestedIntent:"DESCEND",executedIntent:"CLIMB",provider:"scripted",probability:1}},{type:"SAFETY_OVERRIDE",decisionId:"d-1",requested:"DESCEND",executed:"CLIMB",reason:"TERRAIN_CLEARANCE"},{type:"DECISION",frame:{id:"d-2",startTick:"30n",requestedIntent:"HOLD",executedIntent:"HOLD",provider:"scripted",probability:1}}].map(x=>JSON.stringify(x)).join("\n");
const flush=()=>new Promise(r=>setTimeout(r,0));
test("replay loads fresh, steps, finishes and replays without double counting",async()=>{
 const s=new DashboardStore();s.ingest({type:"DECISION",frame:{id:"live-1",startTick:1n,requestedIntent:"HOLD",executedIntent:"HOLD",provider:"live",probability:1}});
 s.loadReplay(lines);await flush();expect(s.getSnapshot().mode).toBe("REPLAY");expect(s.getSnapshot().metrics.decisions).toBe(0);
 for(let i=0;i<4;i++)s.step();await flush();let v=s.getSnapshot();expect(v.replay).toBe("DONE");expect(v.metrics).toMatchObject({decisions:2,overrides:1});
 s.togglePlay();for(let i=0;i<4;i++)s.step();s.replay.pause();await flush();v=s.getSnapshot();expect(v.metrics).toMatchObject({decisions:2,overrides:1});
 s.pin("d-1");await flush();expect(s.getSnapshot().selected?.decisionId).toBe("d-1");expect(s.getSnapshot().reasons.join(" ")).toContain("Safety changed DESCEND to CLIMB");
 s.goLive();await flush();expect(s.getSnapshot()).toMatchObject({mode:"LIVE",pinned:undefined});expect(s.getSnapshot().metrics.decisions).toBe(0);
});
test("pausing the UI freezes the view while telemetry keeps flowing",async()=>{const s=new DashboardStore();s.togglePause();s.ingest({type:"EPISODE_END",tick:"1",phase:"COMPLETE",checksum:"c"});await flush();expect(s.getSnapshot().metrics.episodes).toBe(0);s.togglePause();await flush();expect(s.getSnapshot().metrics.episodes).toBe(1)});
