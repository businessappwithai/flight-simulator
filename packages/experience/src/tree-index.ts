import type {PilotIntent} from "@flight/protocol";
export interface TreeTrainingRow{features:readonly number[];label:PilotIntent;weight:number}
export interface FastTreeIndex{
 readonly id:string;
 train(rows:readonly TreeTrainingRow[]):Promise<void>;
 rank(features:readonly number[]):Promise<readonly {action:PilotIntent;score:number}[]>;
}
export class InMemoryTreeIndex implements FastTreeIndex{
 readonly id="in-memory-baseline";#rows:TreeTrainingRow[]=[];
 async train(rows:readonly TreeTrainingRow[]){this.#rows=[...rows]}
 async rank(features:readonly number[]){const scores=new Map<PilotIntent,number>();for(const r of this.#rows){let d=0;for(let i=0;i<Math.min(features.length,r.features.length);i++)d+=(features[i]!-r.features[i]!)**2;const s=r.weight/(1+Math.sqrt(d));scores.set(r.label,(scores.get(r.label)??0)+s)}return [...scores].map(([action,score])=>({action,score})).sort((a,b)=>b.score-a.score)}
}
