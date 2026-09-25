import type {BestPracticeExample,BestPracticePrediction} from "./best-practice.ts";
export interface TrainedModel{version:string;bytes:Uint8Array;format:string;featureCount:number;rows:number;skipped:number}
type Pending={resolve:(x:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
/** Promise API over xgboost.worker.ts. Every call settles: on reply, worker error, timeout, crash or dispose. */
export class XGBoostBestPracticeClient{
 readonly worker:Worker;activeVersion?:string;featureCount?:number;
 #seq=0;#pending=new Map<string,Pending>();#disposed=false;
 constructor(url=new URL("./xgboost.worker.ts",import.meta.url),readonly timeoutMs={train:120_000,load:30_000,predict:5_000}){
  this.worker=new Worker(url,{type:"module"});
  this.worker.onmessage=(e:MessageEvent)=>{const d=e.data,p=d?.requestId&&this.#pending.get(d.requestId);
   if(d?.type==="TRAINED"||d?.type==="LOADED"){this.activeVersion=d.version;if(d.featureCount)this.featureCount=d.featureCount}
   if(!p)return;this.#pending.delete(d.requestId);clearTimeout(p.timer);d.type==="ERROR"?p.reject(new Error(d.message)):p.resolve(d)};
  this.worker.onerror=(e:ErrorEvent)=>this.#failAll(new Error(`best-practice worker crashed: ${e.message}`));
 }
 #call<T>(msg:Record<string,unknown>,timeout:number,transfer:Transferable[]=[]):Promise<T>{
  if(this.#disposed)return Promise.reject(new Error("best-practice client disposed"));
  const requestId=`bp:${++this.#seq}`;
  return new Promise<T>((resolve,reject)=>{
   const timer=setTimeout(()=>{this.#pending.delete(requestId);reject(new Error(`best-practice ${String(msg.type)} timed out after ${timeout}ms`))},timeout);
   this.#pending.set(requestId,{resolve,reject,timer});this.worker.postMessage({...msg,requestId},transfer);
  });
 }
 #failAll(e:Error){for(const p of this.#pending.values()){clearTimeout(p.timer);p.reject(e)}this.#pending.clear()}
 async train(version:string,examples:readonly BestPracticeExample[],rounds?:number):Promise<TrainedModel>{
  const r:any=await this.#call({type:"TRAIN",version,examples,rounds},this.timeoutMs.train);
  return {version:r.version,bytes:r.bytes,format:r.format,featureCount:r.featureCount,rows:r.rows,skipped:r.skipped};
 }
 /** Copies bytes before transfer so the caller's buffer stays usable. */
 async load(model:Pick<TrainedModel,"version"|"bytes"|"featureCount">&{format?:string}):Promise<void>{
  const bytes=model.bytes.slice();await this.#call({type:"LOAD",version:model.version,bytes,featureCount:model.featureCount,format:model.format},this.timeoutMs.load,[bytes.buffer]);
 }
 async predict(features:readonly number[]):Promise<BestPracticePrediction[]>{
  return (await this.#call<any>({type:"PREDICT",features:[...features]},this.timeoutMs.predict)).ranked;
 }
 dispose(){if(this.#disposed)return;this.#disposed=true;this.#failAll(new Error("best-practice client disposed"));this.worker.terminate()}
}
