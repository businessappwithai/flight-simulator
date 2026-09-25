import {XGBModel} from "@wlearn/xgboost";
import {ACTIONS,actionIndex,trainingWeight,type BestPracticeExample} from "./best-practice.ts";
type Train={type:"TRAIN";version:string;examples:BestPracticeExample[]};
type Predict={type:"PREDICT";requestId:string;features:number[]};
type Load={type:"LOAD";version:string;bytes:Uint8Array};
type Msg=Train|Predict|Load|{type:"DISPOSE"};
let model:any,version="none";
const dispose=()=>{if(model){model.dispose();model=undefined}};
onmessage=async({data}:MessageEvent<Msg>)=>{
 try{
  if(data.type==="TRAIN"){
   const next=await XGBModel.create({objective:"multi:softprob",num_class:ACTIONS.length,max_depth:6,eta:.15,numRound:120,subsample:.85,colsample_bytree:.85,verbosity:0});
   const rows=data.examples.filter(x=>actionIndex(x.action)>=0);
   const X=rows.map(x=>[...x.features]),y=rows.map(x=>actionIndex(x.action)),sampleWeight=rows.map(trainingWeight);
   next.fit(X,y,{sampleWeight});const bytes=next.save();dispose();model=next;version=data.version;
   postMessage({type:"TRAINED",version,bytes},{transfer:[bytes.buffer]});return;
  }
  if(data.type==="LOAD"){const next=await XGBModel.load(data.bytes);dispose();model=next;version=data.version;postMessage({type:"LOADED",version});return}
  if(data.type==="PREDICT"){
   if(!model)throw new Error("best-practice model unavailable");
   const p=model.predictProba([data.features]);const ranked=ACTIONS.map((action,i)=>({action,probability:Number(p[i]??0)})).sort((a,b)=>b.probability-a.probability);
   postMessage({type:"PREDICTION",requestId:data.requestId,version,ranked});return;
  }
  dispose();postMessage({type:"DISPOSED"});
 }catch(e){postMessage({type:"ERROR",message:e instanceof Error?e.message:String(e)})}
};
