import type {LearningBook,LearningEntry,LearningInsight,Observation} from "@flight/protocol";
// Subpath import: the package index also exports the Bun SQLite store, which cannot load in a browser worker.
import {situationFingerprint} from "@flight/experience/fingerprint";
/**
 * Browser-side experience learning. While enabled, the recorder samples (situation, action) pairs during a
 * flight; when the flight ends it credits every pair with a landing or a crash. The book is plain JSON so the
 * page can keep it in localStorage. Learning only observes: it never changes the controls the simulation applies.
 */
export const MAX_ENTRIES=4000;
const KEY=/^[A-Z0-9_+|]{1,200}$/;
export const emptyBook=():LearningBook=>({version:1,flights:0,landings:0,crashes:0,entries:{}});
const count=(x:unknown):x is number=>Number.isSafeInteger(x)&&(x as number)>=0;
/** Validates untrusted data (e.g. from localStorage); returns undefined when it is not a well-formed book. */
export function parseBook(raw:unknown):LearningBook|undefined{
 if(!raw||typeof raw!=="object")return undefined;
 const b=raw as Record<string,unknown>;
 if(b.version!==1||!count(b.flights)||!count(b.landings)||!count(b.crashes)||b.landings+b.crashes>b.flights)return undefined;
 if(!b.entries||typeof b.entries!=="object"||Array.isArray(b.entries))return undefined;
 const all=Object.entries(b.entries as Record<string,unknown>);if(all.length>MAX_ENTRIES)return undefined;
 const entries:Record<string,LearningEntry>={};
 for(const [k,v] of all){
  if(!KEY.test(k)||!v||typeof v!=="object")return undefined;
  const {visits,successes,failures}=v as Record<string,unknown>;
  if(!count(visits)||!count(successes)||!count(failures)||successes+failures!==visits)return undefined;
  entries[k]={visits,successes,failures};
 }
 return {version:1,flights:b.flights,landings:b.landings,crashes:b.crashes,entries};
}
export const learningKey=(situation:string,action:string)=>`${situation}|${action}`;
export class LearningRecorder{
 enabled=false;
 #book:LearningBook=emptyBook();#episode=new Set<string>();#closed=false;
 get book():LearningBook{return this.#book}
 get experiences(){return Object.keys(this.#book.entries).length}
 load(book:LearningBook){this.#book=structuredClone(book)}
 clear(){this.#book=emptyBook();this.beginEpisode()}
 /** A new flight: anything sampled from an unfinished flight is discarded. */
 beginEpisode(){this.#episode.clear();this.#closed=false}
 observe(o:Observation,action:string){if(this.enabled&&!this.#closed)this.#episode.add(learningKey(situationFingerprint(o),action))}
 /** Credits the flight's samples with its outcome, once. Returns false when there was nothing to learn. */
 finish(landed:boolean):boolean{
  if(this.#closed)return false;this.#closed=true;
  if(!this.#episode.size)return false;
  const b=this.#book;b.flights++;landed?b.landings++:b.crashes++;
  for(const k of this.#episode){const e=b.entries[k]??={visits:0,successes:0,failures:0};e.visits++;landed?e.successes++:e.failures++}
  this.#episode.clear();this.#prune();return true;
 }
 /** Best-known action for the current situation (highest landing rate, then most visits). */
 insight(o:Observation):LearningInsight|undefined{
  const situation=situationFingerprint(o),prefix=`${situation}|`;let best:LearningInsight|undefined;
  for(const [k,e] of Object.entries(this.#book.entries)){if(!k.startsWith(prefix)||!e.visits)continue;
   const c={situation,action:k.slice(prefix.length),successRate:e.successes/e.visits,visits:e.visits};
   if(!best||c.successRate>best.successRate||(c.successRate===best.successRate&&c.visits>best.visits))best=c}
  return best;
 }
 // Keeps localStorage bounded: drop the least-visited pairs first.
 #prune(){const all=Object.entries(this.#book.entries);if(all.length<=MAX_ENTRIES)return;
  all.sort((a,b)=>b[1].visits-a[1].visits);this.#book.entries=Object.fromEntries(all.slice(0,MAX_ENTRIES))}
}
