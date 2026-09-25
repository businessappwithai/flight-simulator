import {Booster,DMatrix,loadXGB} from "@wlearn/xgboost";
import {OUTCOME_MODEL_FORMAT,buildOutcomeDataset,candidateRows,rankOutcomes,type BestPracticeExample} from "./best-practice.ts";
// Protocol: every request carries requestId; every reply echoes it. Requests run strictly in order so a
// PREDICT can never observe a half-trained or half-loaded model.
export type WorkerRequest=
 |{type:"TRAIN";requestId:string;version:string;examples:BestPracticeExample[];rounds?:number}
 |{type:"LOAD";requestId:string;version:string;bytes:Uint8Array;featureCount:number;format?:string}
 |{type:"PREDICT";requestId:string;features:number[]}
 |{type:"DISPOSE";requestId?:string};
const PARAMS={objective:"binary:logistic",eval_metric:"logloss",max_depth:6,eta:.15,subsample:.85,colsample_bytree:.85,min_child_weight:1,seed:0,nthread:1,verbosity:0};
let booster:Booster|undefined,version="none",featureCount=0;
const dispose=()=>{booster?.dispose();booster=undefined;version="none";featureCount=0};
function train(examples:readonly BestPracticeExample[],rounds:number){
 const d=buildOutcomeDataset(examples),dm=new DMatrix(d.data,{nrow:d.rows,ncol:d.cols});
 try{dm.setLabel(d.labels);dm.setWeight(d.weights);const b=new Booster(PARAMS,[dm]);
  try{for(let i=0;i<rounds;i++)b.update(dm,i);return {b,d}}catch(e){b.dispose();throw e}}
 finally{dm.dispose()}
}
async function handle(m:WorkerRequest){
 const requestId=m.requestId;
 try{
  if(m.type==="TRAIN"){
   await loadXGB();const rounds=Math.max(1,Math.min(1000,Math.floor(m.rounds??120)));
   const {b,d}=train(m.examples,rounds),bytes=b.saveModel("ubj");
   dispose();booster=b;version=m.version;featureCount=d.featureCount;
   postMessage({type:"TRAINED",requestId,version,bytes,format:OUTCOME_MODEL_FORMAT,featureCount,rows:d.rows,skipped:d.skipped},{transfer:[bytes.buffer]});return;
  }
  if(m.type==="LOAD"){
   if(m.format&&m.format!==OUTCOME_MODEL_FORMAT)throw new Error(`unsupported model format ${m.format}`);
   if(!Number.isInteger(m.featureCount)||m.featureCount<1)throw new Error("LOAD requires featureCount");
   await loadXGB();const b=Booster.loadModel(m.bytes);dispose();booster=b;version=m.version;featureCount=m.featureCount;
   postMessage({type:"LOADED",requestId,version});return;
  }
  if(m.type==="PREDICT"){
   if(!booster)throw new Error("best-practice model unavailable");
   if(m.features.length!==featureCount)throw new Error(`expected ${featureCount} features, got ${m.features.length}`);
   const c=candidateRows(m.features),dm=new DMatrix(c.data,{nrow:c.rows,ncol:c.cols});
   try{postMessage({type:"PREDICTION",requestId,version,ranked:rankOutcomes(booster.predict(dm))})}finally{dm.dispose()}return;
  }
  dispose();postMessage({type:"DISPOSED",requestId});
 }catch(e){postMessage({type:"ERROR",requestId,message:e instanceof Error?e.message:String(e)})}
}
let queue:Promise<void>=Promise.resolve();
onmessage=({data}:MessageEvent<WorkerRequest>)=>{queue=queue.then(()=>handle(data))};
