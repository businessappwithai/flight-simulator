import type {BestPracticeExample} from "./best-practice.ts";
export class TrainingBuffer{
 #good:BestPracticeExample[]=[];#bad:BestPracticeExample[]=[];
 constructor(readonly maxGood=20000,readonly maxBad=20000){}
 add(x:BestPracticeExample){const a=x.success&&!x.safetyOverride&&!x.catastrophic?this.#good:this.#bad;a.push(x);if(a.length>(a===this.#good?this.maxGood:this.maxBad))a.shift()}
 snapshot(){const rows=[...this.#bad,...this.#good];return rows.sort((a,b)=>Number(b.catastrophic)-Number(a.catastrophic)||Number(b.safetyOverride)-Number(a.safetyOverride))}
 get size(){return this.#good.length+this.#bad.length}
}
