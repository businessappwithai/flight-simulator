import {expect,test} from "bun:test";
import type {Observation} from "@flight/protocol";
import {LearningRecorder,MAX_ENTRIES,emptyBook,parseBook} from "@flight/learning";
const obs=(altitude:number,speed=30):Observation=>({tick:0n,speed,altitude,heading:0,objectivePhase:"OUTBOUND",attitude:{pitch:0,roll:0,verticalSpeed:0}});
test("records nothing while disabled",()=>{const r=new LearningRecorder();r.observe(obs(50),"CLIMB");expect(r.finish(true)).toBe(false);expect(r.book).toEqual(emptyBook())});
test("credits every sampled situation/action once per flight with the outcome",()=>{
 const r=new LearningRecorder();r.enabled=true;
 r.observe(obs(50),"AP_OUTBOUND");r.observe(obs(50),"AP_OUTBOUND");r.observe(obs(150),"CLIMB");
 expect(r.finish(true)).toBe(true);expect(r.finish(true)).toBe(false);
 expect(r.book.flights).toBe(1);expect(r.book.landings).toBe(1);expect(r.experiences).toBe(2);
 const e=Object.values(r.book.entries);expect(e.every(x=>x.visits===1&&x.successes===1)).toBe(true);
 r.beginEpisode();r.observe(obs(50),"AP_OUTBOUND");r.finish(false);
 expect(r.book.crashes).toBe(1);expect(Object.values(r.book.entries).find(x=>x.visits===2)).toEqual({visits:2,successes:1,failures:1});
});
test("an unfinished flight is discarded when a new one begins",()=>{const r=new LearningRecorder();r.enabled=true;r.observe(obs(50),"HOLD");r.beginEpisode();expect(r.finish(true)).toBe(false);expect(r.book.flights).toBe(0)});
test("insight picks the action that landed most often in the current situation",()=>{
 const r=new LearningRecorder();r.enabled=true;
 for(const [a,landed] of [["TURN_LEFT",false],["HOLD",true],["HOLD",true]] as const){r.beginEpisode();r.observe(obs(50),a);r.finish(landed)}
 expect(r.insight(obs(50))).toMatchObject({action:"HOLD",successRate:1,visits:2});
 expect(r.insight(obs(500,80))).toBeUndefined();
});
test("parseBook round-trips a saved book and rejects tampered or corrupt data",()=>{
 const r=new LearningRecorder();r.enabled=true;r.observe(obs(50),"HOLD");r.finish(true);
 const saved=JSON.parse(JSON.stringify(r.book));expect(parseBook(saved)).toEqual(r.book);
 for(const bad of [null,"x",[],{...saved,version:2},{...saved,flights:-1},{...saved,landings:5},{...saved,entries:[]},
  {...saved,entries:{"bad key":{visits:1,successes:1,failures:0}}},{...saved,entries:{HOLD:{visits:2,successes:1,failures:0}}},{...saved,entries:{HOLD:{visits:1.5,successes:1.5,failures:0}}}])
  expect(parseBook(bad)).toBeUndefined();
});
test("loading a book restores learning; clearing forgets it",()=>{
 const r=new LearningRecorder();r.load({version:1,flights:3,landings:2,crashes:1,entries:{"A|HOLD":{visits:3,successes:2,failures:1}}});
 expect(r.experiences).toBe(1);r.clear();expect(r.book).toEqual(emptyBook());
});
test("storage stays bounded",()=>{
 const entries=Object.fromEntries(Array.from({length:MAX_ENTRIES+1},(_,i)=>[`S${i}|HOLD`,{visits:1,successes:1,failures:0}]));
 expect(parseBook({version:1,flights:1,landings:1,crashes:0,entries})).toBeUndefined();
 const r=new LearningRecorder();r.load({version:1,flights:1,landings:1,crashes:0,entries:Object.fromEntries(Object.entries(entries).slice(0,MAX_ENTRIES))});
 r.enabled=true;r.observe(obs(50),"CLIMB");r.finish(true);expect(r.experiences).toBe(MAX_ENTRIES);
});
