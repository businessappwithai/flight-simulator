import {expect,test} from "bun:test";
import type {Observation,WorldSnapshot} from "@flight/protocol";
import {FlightTraceRecorder,LearningRecorder,MAX_ENTRIES,MAX_TRACE_FRAMES,emptyBook,parseBook,situationOf} from "@flight/learning";
import {autopilotIntent} from "@flight/controller";
import {DeterministicSimulation,defaultScenario} from "@flight/simulation";
const obs=(altitude:number,speed=30):Observation=>({tick:0n,speed,altitude,heading:0,objectivePhase:"OUTBOUND",attitude:{pitch:0,roll:0,verticalSpeed:0}});
const at=(altitude:number,speed=30)=>situationOf(obs(altitude,speed));
test("records nothing while disabled",()=>{const r=new LearningRecorder();r.observe(at(50),"CLIMB","MANUAL");expect(r.finish(true)).toBe(false);expect(r.book).toEqual(emptyBook())});
test("manual and autopilot flying both teach the same book, credited per pilot",()=>{
 const r=new LearningRecorder();r.enabled=true;
 r.observe(at(50),"HOLD","MANUAL");r.observe(at(50),"HOLD","AUTOPILOT");r.observe(at(150),"CLIMB","AUTOPILOT");r.observe(at(150),"CLIMB","AUTOPILOT");
 expect(r.finish(true)).toBe(true);expect(r.finish(true)).toBe(false);
 const b=r.book;expect(b).toMatchObject({flights:1,landings:1,crashes:0,manual:{flights:1,landings:1},autopilot:{flights:1,landings:1}});
 expect(b.entries[`${at(50)}|HOLD`]).toEqual({visits:2,successes:2,failures:0,manual:1,autopilot:1});
 expect(b.entries[`${at(150)}|CLIMB`]).toEqual({visits:1,successes:1,failures:0,manual:0,autopilot:1});
 r.beginEpisode();r.observe(at(50),"HOLD","MANUAL");r.finish(false);
 expect(r.book).toMatchObject({flights:2,crashes:1,manual:{flights:2,crashes:1},autopilot:{flights:1,crashes:0}});
 expect(r.book.entries[`${at(50)}|HOLD`]).toEqual({visits:3,successes:2,failures:1,manual:2,autopilot:1});
});
test("an unfinished flight is discarded when a new one begins",()=>{const r=new LearningRecorder();r.enabled=true;r.observe(at(50),"HOLD","MANUAL");r.beginEpisode();expect(r.finish(true)).toBe(false);expect(r.book.flights).toBe(0)});
test("insight picks the intent that landed most often here, whoever flew it",()=>{
 const r=new LearningRecorder();r.enabled=true;
 for(const [a,p,landed] of [["TURN_LEFT","AUTOPILOT",false],["HOLD","MANUAL",true],["HOLD","AUTOPILOT",true]] as const){r.beginEpisode();r.observe(at(50),a,p);r.finish(landed)}
 expect(r.insight(obs(50))).toMatchObject({action:"HOLD",successRate:1,visits:2,manual:1,autopilot:1});
 expect(r.insight(obs(500,80))).toBeUndefined();
});
test("parseBook round-trips a saved book and rejects tampered, corrupt or retired data",()=>{
 const r=new LearningRecorder();r.enabled=true;r.observe(at(50),"HOLD","MANUAL");r.finish(true);
 const saved=JSON.parse(JSON.stringify(r.book));expect(parseBook(saved)).toEqual(r.book);
 const k=`${at(50)}|HOLD`;
 for(const bad of [null,"x",[],{...saved,version:1},{...saved,flights:-1},{...saved,landings:5},{...saved,entries:[]},{...saved,manual:{flights:9,landings:0,crashes:0}},{...saved,autopilot:undefined},
  {...saved,entries:{"bad key|HOLD":{visits:1,successes:1,failures:0,manual:1,autopilot:0}}},{...saved,entries:{[`${at(50)}|AP_TAKEOFF`]:{visits:1,successes:1,failures:0,manual:0,autopilot:1}}},
  {...saved,entries:{[k]:{visits:2,successes:1,failures:1,manual:1,autopilot:0}}},{...saved,entries:{[k]:{visits:1,successes:1,failures:0}}}])
  expect(parseBook(bad)).toBeUndefined();
});
test("loading a book restores learning; clearing forgets it",()=>{
 const r=new LearningRecorder();r.load({version:2,flights:3,landings:2,crashes:1,manual:{flights:1,landings:1,crashes:0},autopilot:{flights:2,landings:1,crashes:1},entries:{"A|HOLD":{visits:3,successes:2,failures:1,manual:1,autopilot:2}}});
 expect(r.experiences).toBe(1);r.clear();expect(r.book).toEqual(emptyBook());
});
test("storage stays bounded",()=>{
 const entries=Object.fromEntries(Array.from({length:MAX_ENTRIES+1},(_,i)=>[`S${i}|HOLD`,{visits:1,successes:1,failures:0,manual:1,autopilot:0}]));
 const book={version:2,flights:1,landings:1,crashes:0,manual:{flights:1,landings:1,crashes:0},autopilot:{flights:0,landings:0,crashes:0},entries};
 expect(parseBook(book)).toBeUndefined();
 const r=new LearningRecorder();r.load({...book,version:2,entries:Object.fromEntries(Object.entries(entries).slice(0,MAX_ENTRIES))});
 r.enabled=true;r.observe(at(50),"CLIMB","MANUAL");r.finish(true);expect(r.experiences).toBe(MAX_ENTRIES);
});
test("autopilotIntent describes the autopilot in pilot intents",()=>{
 const sim=new DeterministicSimulation();const w=sim.reset(defaultScenario(1n));
 expect(autopilotIntent(w)).toBe("CLIMB"); // take-off roll
 const flying=(heading:number,y:number):WorldSnapshot=>({...w,aircraft:{...w.aircraft,position:{x:0,y,z:100},velocity:{x:0,y:0,z:40},heading}});
 expect(autopilotIntent(flying(0,80))).toBe("HOLD");        // on course at the gate's altitude
 expect(autopilotIntent(flying(0,30))).toBe("CLIMB");
 expect(autopilotIntent(flying(0,140))).toBe("DESCEND");
 expect(autopilotIntent(flying(-.6,80))).toBe("TURN_RIGHT"); // gate is to the right of the nose
 expect(autopilotIntent(flying(.6,80))).toBe("TURN_LEFT");
});
test("flight traces record both pilots as Control Room decision frames",()=>{
 const t=new FlightTraceRecorder();t.begin("f1","moving-obstacle-001");
 t.record(0n,"CLIMB","MANUAL","S1","pilot");t.record(30n,"CLIMB","MANUAL","S1","pilot");t.record(60n,"HOLD","MANUAL","S2","pilot");
 t.record(90n,"HOLD","AUTOPILOT","S2","autopilot:OUTBOUND");t.record(120n,"TURN_LEFT","AUTOPILOT","S3","autopilot:TURN_BACK");
 const trace=t.finish("LANDED",150n,"abc","COMPLETE")!;
 expect(trace).toMatchObject({id:"f1",scenarioId:"moving-obstacle-001",outcome:"LANDED",pilots:["MANUAL","AUTOPILOT"]});
 const frames=trace.events.filter(e=>e.type==="DECISION").map((e:any)=>e.frame);
 expect(frames.map(f=>[f.provider,f.executedIntent,f.startTick,f.endTick])).toEqual([["manual","CLIMB",0n,60n],["manual","HOLD",60n,90n],["autopilot","HOLD",90n,120n],["autopilot","TURN_LEFT",120n,150n]]);
 expect(frames.every(f=>f.requestedIntent===f.executedIntent&&f.probability===1&&f.outcome?.terminal?.objective===1)).toBe(true);
 expect(frames[3].evidence).toMatchObject({model:"autopilot:TURN_BACK",fingerprint:"S3"});
 expect(trace.events.at(-1)).toEqual({type:"EPISODE_END",tick:"150",phase:"COMPLETE",checksum:"abc"});
 expect(t.frames).toBe(0);expect(t.finish("CRASHED",200n,"x","FAILED")).toBeUndefined();
});
test("abandoned traces carry no outcome, and long flights stay bounded",()=>{
 const t=new FlightTraceRecorder();t.begin("f2","s");
 for(let i=0;i<MAX_TRACE_FRAMES+50;i++)t.record(BigInt(i*30),i%2?"HOLD":"CLIMB","MANUAL","S","pilot");
 const trace=t.finish("ABANDONED",99999n,"c","OUTBOUND")!;
 const frames=trace.events.filter(e=>e.type==="DECISION");expect(frames).toHaveLength(MAX_TRACE_FRAMES);
 expect(frames.every((e:any)=>e.frame.outcome===undefined)).toBe(true);
});
