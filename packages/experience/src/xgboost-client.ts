import type {BestPracticeExample,BestPracticePrediction} from "./best-practice.ts";
export class XGBoostBestPracticeClient{
 readonly worker:Worker;#seq=0;#pending=new Map<string,{resolve:(x:BestPracticePrediction[])=>void;reject:(e:Error)=>void}>();activeVersion?:string;
 constructor(url=new URL("./xgboost.worker.ts",import.meta.url)){
  this.worker=new Worker(url,{type:"module"});
  this.worker.onmessage=(e:any)=>{const d=e.data;if(d.type==="PREDICTION"){this.#pending.get(d.requestId)?.resolve(d.ranked);this.#pending.delete(d.requestId)}if(d.type==="ERROR"&&d.requestId){this.#pending.get(d.requestId)?.reject(new Error(d.message));this.#pending.delete(d.requestId)}if(d.type==="LOADED")this.activeVersion=d.version};
 }
 train(version:string,examples:readonly BestPracticeExample[]){this.worker.postMessage({type:"TRAIN",version,examples})}
 load(version:string,bytes:Uint8Array){this.worker.postMessage({type:"LOAD",version,bytes},[bytes.buffer])}
 predict(features:readonly number[]):Promise<BestPracticePrediction[]>{const requestId=`bp:${++this.#seq}`;return new Promise((resolve,reject)=>{this.#pending.set(requestId,{resolve,reject});this.worker.postMessage({type:"PREDICT",requestId,features:[...features]})})}
 dispose(){this.worker.postMessage({type:"DISPOSE"});this.worker.terminate();for(const p of this.#pending.values())p.reject(new Error("best-practice client disposed"));this.#pending.clear()}
}
