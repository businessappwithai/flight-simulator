export interface ReplayItem{tick:string;kind:string;payload:unknown}
export class ReplayTimeline{
 #items:ReplayItem[]=[];#cursor=0;
 load(items:readonly ReplayItem[]){this.#items=[...items].sort((a,b)=>BigInt(a.tick)<BigInt(b.tick)?-1:1);this.#cursor=0}
 seek(tick:bigint){const i=this.#items.findIndex(x=>BigInt(x.tick)>=tick);this.#cursor=i<0?this.#items.length: i;return this.current}
 next(){this.#cursor=Math.min(this.#items.length,this.#cursor+1);return this.current}
 previous(){this.#cursor=Math.max(0,this.#cursor-1);return this.current}
 get current(){return this.#items[this.#cursor]}
 get progress(){return this.#items.length?this.#cursor/this.#items.length:0}
}
