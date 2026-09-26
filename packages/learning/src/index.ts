import type {LearningBook,LearningEntry,LearningInsight,LearningTally,Observation,PilotIntent,SimPilot} from "@flight/protocol";
// Subpath import: the package index also exports the Bun SQLite store, which cannot load in a browser worker.
import {situationFingerprint} from "@flight/experience/fingerprint";
export {FlightTraceRecorder,MAX_TRACE_FRAMES} from "./trace.ts";
/**
 * Browser-side experience learning from manual and autopilot flying alike. While enabled, the recorder samples
 * (situation, intent, pilot) during a flight; when the flight lands or crashes it credits every sampled pair
 * once per pilot that flew it. Autopilot flying is recorded as the intent it is flying (see autopilotIntent),
 * so both pilots build the same book. The book is plain JSON so the page can keep it in localStorage.
 * Learning only observes: it never changes the controls the simulation applies.
 */
export const MAX_ENTRIES=4000;
export const situationOf=situationFingerprint;
const INTENTS:ReadonlySet<string>=new Set<PilotIntent>(["HOLD","TURN_LEFT","TURN_RIGHT","CLIMB","DESCEND","SLOW","REROUTE","ABORT"]);
const SITUATION=/^[A-Z0-9_+]{1,200}$/;
const tally=():LearningTally=>({flights:0,landings:0,crashes:0});
export const emptyBook=():LearningBook=>({version:2,flights:0,landings:0,crashes:0,manual:tally(),autopilot:tally(),entries:{}});
const count=(x:unknown):x is number=>Number.isSafeInteger(x)&&(x as number)>=0;
function parseTally(raw:unknown,flights:number):LearningTally|undefined{
 if(!raw||typeof raw!=="object")return undefined;const t=raw as Record<string,unknown>;
 if(!count(t.flights)||!count(t.landings)||!count(t.crashes)||t.landings+t.crashes>t.flights||t.flights>flights)return undefined;
 return {flights:t.flights,landings:t.landings,crashes:t.crashes};
}
/** Validates untrusted data (e.g. from localStorage); returns undefined when it is not a well-formed book. */
export function parseBook(raw:unknown):LearningBook|undefined{
 if(!raw||typeof raw!=="object")return undefined;
 const b=raw as Record<string,unknown>;
 if(b.version!==2||!count(b.flights)||!count(b.landings)||!count(b.crashes)||b.landings+b.crashes>b.flights)return undefined;
 const manual=parseTally(b.manual,b.flights),autopilot=parseTally(b.autopilot,b.flights);if(!manual||!autopilot)return undefined;
 if(!b.entries||typeof b.entries!=="object"||Array.isArray(b.entries))return undefined;
 const all=Object.entries(b.entries as Record<string,unknown>);if(all.length>MAX_ENTRIES)return undefined;
 const entries:Record<string,LearningEntry>={};
 for(const [k,v] of all){
  const bar=k.lastIndexOf("|");if(bar<0||!SITUATION.test(k.slice(0,bar))||!INTENTS.has(k.slice(bar+1))||!v||typeof v!=="object")return undefined;
  const e=v as Record<string,unknown>;
  if(![e.visits,e.successes,e.failures,e.manual,e.autopilot].every(count))return undefined;
  const x=e as unknown as LearningEntry;if(x.successes+x.failures!==x.visits||x.manual+x.autopilot!==x.visits)return undefined;
  entries[k]={visits:x.visits,successes:x.successes,failures:x.failures,manual:x.manual,autopilot:x.autopilot};
 }
 return {version:2,flights:b.flights,landings:b.landings,crashes:b.crashes,manual,autopilot,entries};
}
export const learningKey=(situation:string,intent:PilotIntent)=>`${situation}|${intent}`;
export class LearningRecorder{
 enabled=false;
 #book:LearningBook=emptyBook();#episode=new Map<string,Set<SimPilot>>();#closed=false;
 get book():LearningBook{return this.#book}
 get experiences(){return Object.keys(this.#book.entries).length}
 load(book:LearningBook){this.#book=structuredClone(book)}
 clear(){this.#book=emptyBook();this.beginEpisode()}
 /** A new flight: anything sampled from an unfinished flight is discarded. */
 beginEpisode(){this.#episode.clear();this.#closed=false}
 observe(situation:string,intent:PilotIntent,pilot:SimPilot){
  if(!this.enabled||this.#closed)return;const k=learningKey(situation,intent);
  const who=this.#episode.get(k);if(who)who.add(pilot);else this.#episode.set(k,new Set([pilot]));
 }
 /** Credits the flight's samples with its outcome, once. Returns false when there was nothing to learn. */
 finish(landed:boolean):boolean{
  if(this.#closed)return false;this.#closed=true;
  if(!this.#episode.size)return false;
  const b=this.#book,flew=new Set<SimPilot>();
  const credit=(t:LearningTally)=>{t.flights++;landed?t.landings++:t.crashes++};
  for(const [k,pilots] of this.#episode){const e=b.entries[k]??={visits:0,successes:0,failures:0,manual:0,autopilot:0};
   for(const p of pilots){flew.add(p);e.visits++;landed?e.successes++:e.failures++;p==="MANUAL"?e.manual++:e.autopilot++}}
  credit(b);if(flew.has("MANUAL"))credit(b.manual);if(flew.has("AUTOPILOT"))credit(b.autopilot);
  this.#episode.clear();this.#prune();return true;
 }
 /** Best-known intent for the current situation (highest landing rate, then most visits), from either pilot. */
 insight(o:Observation):LearningInsight|undefined{
  const situation=situationFingerprint(o),prefix=`${situation}|`;let best:LearningInsight|undefined;
  for(const [k,e] of Object.entries(this.#book.entries)){if(!k.startsWith(prefix)||!e.visits)continue;
   const c={situation,action:k.slice(prefix.length) as PilotIntent,successRate:e.successes/e.visits,visits:e.visits,manual:e.manual,autopilot:e.autopilot};
   if(!best||c.successRate>best.successRate||(c.successRate===best.successRate&&c.visits>best.visits))best=c}
  return best;
 }
 // Keeps localStorage bounded: drop the least-visited pairs first.
 #prune(){const all=Object.entries(this.#book.entries);if(all.length<=MAX_ENTRIES)return;
  all.sort((a,b)=>b[1].visits-a[1].visits);this.#book.entries=Object.fromEntries(all.slice(0,MAX_ENTRIES))}
}
